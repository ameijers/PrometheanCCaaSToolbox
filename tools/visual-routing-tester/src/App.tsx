import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ruleSummary, simulate, validateValues } from "./evaluator";
import { loadRoutingModel, queueStateVariables, resolveLocalTime } from "./dataverse";
import { isWithinOperatingHours } from "./operatingHours";
import { Condition, ContextVariable, EnrichmentRule, Outcome, OverflowRule, Queue, QueueRoutingRule, RoutingModel, SimulationResult, Workstream } from "./model";

const emptyResult: SimulationResult = { steps: [], warnings: [] };
const OUTCOME_TYPES: Outcome[] = ["Agent", "Voicemail", "Callback", "Scheduled Callback", "Transfer to Phone", "Queue Transfer", "Remain In Queue", "End Call"];
// Bumped from the v1 key ("ccaas-routing-scenarios") because the shape changed materially (added
// workstreamId/queueValues/simulationTime) — old entries would otherwise show up with those fields
// missing rather than cleanly.
const SCENARIO_STORAGE_KEY = "ccaas-routing-scenarios-v2";
interface SavedScenario { name: string; workstreamId: string; values: Record<string, unknown>; queueValues: Record<string, Record<string, unknown>>; simulationTime: string; outcome?: string; }
interface DetailField { label: string; value: string; }
interface DetailPayload { kind: string; title: string; summary: string; conditions?: Condition[]; fields?: DetailField[]; }

function DemoModel(): RoutingModel {
  const variables: ContextVariable[] = [
    { id: "PreferredLanguage", name: "Preferred language", type: "text", required: true, origin: "ivr", usedByRuleIds: ["r-dutch"] },
    { id: "IsIdentified", name: "Caller identified", type: "boolean", origin: "ivr", usedByRuleIds: ["e-vip"] }
  ];
  const workstream: Workstream = {
    id: "demo-stream", name: "Inbound voice · Customer Care", active: true, variables,
    // Real "Work classification" — sets attributes, does not pick a queue.
    classificationRules: [
      { id: "e-vip", name: "Flag identified callers as priority", order: 0, hitPolicy: "first", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "IsIdentified", operator: "equals", value: true }], sets: [{ attribute: "PriorityScore", value: 10 }] }
    ],
    // Real "Route to Queue" — picks the destination queue; can condition on what classification just set.
    queueRoutingRules: [
      { id: "r-dutch", name: "Dutch callers", order: 0, hitPolicy: "all", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "PreferredLanguage", operator: "equals", value: "Dutch" }], targets: [{ queueId: "nl-queue" }] },
      { id: "r-priority", name: "Priority callers", order: 1, hitPolicy: "all", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "PriorityScore", operator: "greaterOrEqual", value: 10 }], targets: [{ queueId: "vip-queue" }] }
    ],
    fallbackQueueId: "general-queue"
  };
  return { workstreams: [workstream], queues: [
    {
      id: "nl-queue", name: "Netherlands priority", assignmentMethod: "Longest Idle",
      preQueueOverflowRules: [{ id: "pq1", name: "Rule1", order: 0, hitPolicy: "all", conditionLogic: "AND", trigger: "Current queue size", conditions: [{ variableId: "queue_prequeue.currentqueuesize", operator: "greaterOrEqual", value: 5 }], outcome: "Queue Transfer", targetQueueId: "general-queue" }],
      inQueueOverflowRules: [{ id: "o1", name: "Rule1", order: 0, hitPolicy: "all", conditionLogic: "AND", trigger: "Lapsed wait time", conditions: [{ variableId: "queue_inqueue.lapsedwaittime", operator: "greaterOrEqual", value: 90 }], outcome: "Voicemail" }]
    },
    { id: "vip-queue", name: "VIP desk", assignmentMethod: "Round Robin", preQueueOverflowRules: [], inQueueOverflowRules: [{ id: "o2", name: "Rule1", order: 0, hitPolicy: "all", conditionLogic: "AND", trigger: "Always", conditions: [], outcome: "Callback" }] },
    { id: "general-queue", name: "General customer care", assignmentMethod: "Omnichannel Assignment", preQueueOverflowRules: [], inQueueOverflowRules: [{ id: "o3", name: "Rule1", order: 0, hitPolicy: "all", conditionLogic: "AND", trigger: "Unsupported language", conditions: [{ variableId: "PreferredLanguage", operator: "equals", value: "French" }], outcome: "End Call" }] }
  ], warnings: [] };
}

function outcomeDescription(outcome: Outcome): string {
  switch (outcome) {
    case "Agent": return "The call is offered to an agent using the queue's assignment method.";
    case "Voicemail": return "The caller is sent to voicemail instead of waiting for an agent.";
    case "Callback": return "The caller is offered an immediate callback instead of waiting live.";
    case "Scheduled Callback": return "The caller is offered a callback at a scheduled future time.";
    case "End Call": return "The call ends without reaching an agent, voicemail, or callback.";
    case "Transfer to Phone": return "The call is transferred to an external phone number.";
    case "Queue Transfer": return "The call is redirected to a different queue and re-evaluated there.";
    case "Remain In Queue": return "The call keeps waiting in the queue; no terminal action is taken.";
  }
}

function Field({ variable, value, onChange }: { variable: ContextVariable; value: unknown; onChange: (value: unknown) => void }) {
  const common = { className: "field-control", value: value === undefined ? "" : String(value), onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(event.target.value) };
  if (variable.type === "boolean") return <label className="toggle-field"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span className="toggle" /><span>{variable.name}</span></label>;
  if (variable.type === "number") return <input {...common} type="number" step="any" />;
  return <input {...common} type="text" placeholder={variable.type === "entityReference" ? "Enter a record ID or name" : "Enter a value"} />;
}

function statusOf(steps: SimulationResult["steps"], id: string): string {
  return steps.find((step) => step.id === id)?.status ?? "pending";
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function matches(query: string, ...text: string[]): boolean {
  if (!query.trim()) return false;
  return text.some((value) => value.toLowerCase().includes(query.trim().toLowerCase()));
}

export function App(): React.ReactElement {
  const [model, setModel] = useState<RoutingModel>(() => DemoModel());
  const [selectedId, setSelectedId] = useState("demo-stream");
  const [values, setValues] = useState<Record<string, unknown>>({ PreferredLanguage: "Dutch", IsIdentified: false });
  const [queueValues, setQueueValues] = useState<Record<string, Record<string, unknown>>>({});
  const [simulationTime, setSimulationTime] = useState<Date>(() => new Date());
  const [result, setResult] = useState<SimulationResult>(emptyResult);
  const [revealCount, setRevealCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [diagramQuery, setDiagramQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Demo data is shown until a Dataverse connection is available.");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [zoom, setZoom] = useState(1);
  const [scenarios, setScenarios] = useState<SavedScenario[]>(() => {
    try { return JSON.parse(localStorage.getItem(SCENARIO_STORAGE_KEY) ?? "[]") as SavedScenario[]; }
    catch { return []; }
  });
  const [scenarioName, setScenarioName] = useState("");

  const timerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(timerRef.current), []);

  const workstream = model.workstreams.find((candidate) => candidate.id === selectedId) ?? model.workstreams[0];
  const ivrVariables = useMemo(() => (workstream?.variables ?? []).filter((variable) => variable.origin === "ivr"), [workstream]);
  const enrichmentRules = useMemo(() => [...(workstream?.classificationRules ?? [])].sort((a, b) => a.order - b.order), [workstream]);
  const queueRoutingRules = useMemo(() => [...(workstream?.queueRoutingRules ?? [])].sort((a, b) => a.order - b.order), [workstream]);
  // Includes queues only reachable via a Queue Transfer overflow (a queue overflowing into another
  // queue, e.g. an "outside operating hours" fallback) — not just direct routing-rule/fallback targets.
  const reachableQueues = useMemo(() => {
    if (!workstream) return [] as Queue[];
    const queueById = new Map(model.queues.map((queue) => [queue.id, queue]));
    const ids = new Set([workstream.fallbackQueueId, ...queueRoutingRules.flatMap((rule) => rule.targets.map((t) => t.queueId))].filter(Boolean) as string[]);
    const frontier = [...ids];
    while (frontier.length) {
      const queue = queueById.get(frontier.pop()!);
      if (!queue) continue;
      [...queue.preQueueOverflowRules, ...queue.inQueueOverflowRules].forEach((rule) => {
        if (rule.targetQueueId && !ids.has(rule.targetQueueId)) { ids.add(rule.targetQueueId); frontier.push(rule.targetQueueId); }
      });
    }
    return model.queues.filter((queue) => ids.has(queue.id));
  }, [workstream, queueRoutingRules, model.queues]);
  const queueVariableDefs = useMemo(() => new Map(reachableQueues.map((queue) => [queue.id, queueStateVariables(queue)])), [reachableQueues]);
  const variableNames = useMemo(() => {
    const names = Object.fromEntries((workstream?.variables ?? []).map((variable) => [variable.id, variable.name]));
    queueVariableDefs.forEach((variables) => variables.forEach((variable) => { names[variable.id] = variable.name; }));
    return names;
  }, [workstream, queueVariableDefs]);
  const reachableOutcomes = useMemo(() => {
    const set = new Set<Outcome>(["Agent"]);
    reachableQueues.forEach((queue) => {
      [...queue.preQueueOverflowRules, ...queue.inQueueOverflowRules].forEach((rule) => rule.outcome && set.add(rule.outcome));
    });
    return set;
  }, [reachableQueues]);
  const workstreamScenarios = useMemo(() => scenarios.filter((scenario) => scenario.workstreamId === workstream?.id), [scenarios, workstream]);
  const visibleSteps = useMemo(() => result.steps.slice(0, revealCount), [result.steps, revealCount]);
  const outcomeHit = visibleSteps.find((step) => step.kind === "outcome")?.label;
  const fallbackQueue = workstream?.fallbackQueueId ? model.queues.find((queue) => queue.id === workstream.fallbackQueueId) : undefined;

  // Whenever the simulation time (or the set of reachable queues) changes, recompute "within
  // operating hours" for any queue whose overflow rules actually condition on it, using the
  // queue's real configured calendar. Left editable afterward like any other simulated value —
  // this just supplies the starting point that answers "what if the call comes in at time X".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updates: Record<string, Record<string, unknown>> = {};
      for (const queue of reachableQueues) {
        if (!queue.operatingHours?.length) continue;
        const opHoursVariableIds = (queueVariableDefs.get(queue.id) ?? []).map((v) => v.id).filter((id) => /iswithinoperatinghour/i.test(id));
        if (!opHoursVariableIds.length) continue;
        const localTime = await resolveLocalTime(queue.operatingHours[0].timeZoneCode, simulationTime);
        if (!localTime) continue;
        const within = isWithinOperatingHours(queue.operatingHours, localTime);
        if (within === undefined) continue;
        updates[queue.id] = Object.fromEntries(opHoursVariableIds.map((id) => [id, within]));
      }
      if (cancelled || !Object.keys(updates).length) return;
      setQueueValues((previous) => {
        const next = { ...previous };
        for (const [queueId, vars] of Object.entries(updates)) next[queueId] = { ...next[queueId], ...vars };
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [simulationTime, reachableQueues, queueVariableDefs]);

  async function connect() {
    setLoading(true); setMessage("Connecting to the current Dataverse session…");
    try {
      const loaded = await loadRoutingModel();
      setModel(loaded);
      setSelectedId(loaded.workstreams[0]?.id ?? "");
      setResult(emptyResult); setRevealCount(0); setExpanded(new Set()); setQueueValues({});
      setMessage(loaded.warnings.length ? loaded.warnings.join(" ") : "Connected. Routing configuration is read-only.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read this Dataverse environment.");
    } finally { setLoading(false); }
  }

  function run() {
    if (!workstream) return;
    window.clearInterval(timerRef.current); setPlaying(false);
    const errors = validateValues(workstream, values);
    if (errors.length) { setResult({ steps: [], warnings: errors }); setRevealCount(0); return; }
    const normalized = Object.fromEntries(workstream.variables.map((variable) => [variable.id, variable.type === "number" ? Number(values[variable.id]) : values[variable.id]]));
    const normalizedQueueValues = Object.fromEntries(reachableQueues.map((queue) => {
      const raw = queueValues[queue.id] ?? {};
      const vars = queueVariableDefs.get(queue.id) ?? [];
      return [queue.id, Object.fromEntries(vars.map((variable) => [variable.id, variable.type === "number" ? Number(raw[variable.id]) : raw[variable.id]]))];
    }));
    const outcome = simulate(workstream, model, normalized, normalizedQueueValues);
    setResult(outcome);
    setRevealCount(outcome.steps.length);
  }

  function play() {
    if (!result.steps.length) return;
    window.clearInterval(timerRef.current);
    setPlaying(true);
    setRevealCount(0);
    let index = 0;
    timerRef.current = window.setInterval(() => {
      index += 1;
      setRevealCount(index);
      if (index >= result.steps.length) { window.clearInterval(timerRef.current); setPlaying(false); }
    }, 650);
  }

  function stepBy(delta: number) {
    window.clearInterval(timerRef.current); setPlaying(false);
    setRevealCount((count) => Math.min(Math.max(count + delta, 0), result.steps.length));
  }

  function toggleExpand(id: string) {
    setExpanded((previous) => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function zoomBy(factor: number) { setZoom((z) => Math.min(1.8, Math.max(0.5, Number((z * factor).toFixed(2))))); }
  function resetView() { setZoom(1); }
  function onWheelZoom(event: React.WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.08 : 0.93);
  }

  function persistScenarios(next: SavedScenario[]) {
    setScenarios(next);
    localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(next));
  }

  function saveScenario() {
    const name = scenarioName.trim();
    if (!name || !workstream) return;
    const entry: SavedScenario = { name, workstreamId: workstream.id, values, queueValues, simulationTime: simulationTime.toISOString(), outcome: result.outcome };
    persistScenarios([...scenarios.filter((scenario) => !(scenario.workstreamId === workstream.id && scenario.name === name)), entry]);
    setScenarioName("");
    setMessage(`Saved scenario "${name}".`);
  }

  function loadScenario(scenario: SavedScenario) {
    setValues(scenario.values);
    setQueueValues(scenario.queueValues ?? {});
    setSimulationTime(scenario.simulationTime ? new Date(scenario.simulationTime) : new Date());
    setMessage(`Loaded scenario "${scenario.name}". Click Run simulation to see its trace.`);
  }

  function deleteScenario(workstreamId: string, name: string) {
    persistScenarios(scenarios.filter((scenario) => !(scenario.workstreamId === workstreamId && scenario.name === name)));
  }

  function exportTrace() {
    const lines = result.steps.map((step) => `${step.kind.toUpperCase()}: ${step.label} - ${step.detail}`);
    const content = [`Visual Routing Tester`, workstream?.name ?? "No workstream", "", ...(lines.length ? lines : ["No simulation run yet."]), ...(result.warnings.length ? ["", "Warnings:", ...result.warnings] : [])].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    link.download = "routing-trace.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark">VR</div><div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Visual Routing Tester</h1></div><div className="topbar-actions"><span className="read-only"><span className="status-dot" />Read-only mode</span><button className="button secondary" onClick={connect} disabled={loading}>{loading ? "Connecting…" : "Connect environment"}</button></div></header>
    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}
    {model.warnings.length > 0 && <div className="config-warnings"><strong>Configuration warnings</strong><ul>{model.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
    <section className="workspace">
      <aside className="sidebar">
        <div className="section-heading"><div><p className="eyebrow">Configuration</p><h2>Workstreams</h2></div><span className="count">{model.workstreams.length}</span></div>
        <label className="search"><span>⌕</span><input placeholder="Search workstreams" value={sidebarQuery} onChange={(event) => setSidebarQuery(event.target.value)} /></label>
        <div className="workstream-list">{model.workstreams.filter((candidate) => candidate.name.toLowerCase().includes(sidebarQuery.toLowerCase())).map((candidate) => <button className={`workstream-item ${candidate.id === selectedId ? "selected" : ""}`} key={candidate.id} onClick={() => { setSelectedId(candidate.id); setResult(emptyResult); setRevealCount(0); setExpanded(new Set()); setQueueValues({}); }}><span className="voice-icon">◒</span><span><strong>{candidate.name}</strong><small>{candidate.active ? "Active" : "Inactive"} · Inbound voice</small></span><span className={`status-pill ${candidate.active ? "active" : "inactive"}`}>{candidate.active ? "Live" : "Off"}</span></button>)}</div>
        <div className="sidebar-footer"><span className="shield">◇</span><span>Configuration is never changed by this tool.</span></div>
      </aside>
      <section className="content">
        <div className="content-header"><div><p className="eyebrow">Routing map</p><h2>{workstream?.name ?? "No workstream selected"}</h2><p className="muted">Trace classification, queue routing, and overflow behavior before a call reaches an agent.</p></div><div className="view-actions"><button className="icon-button" title="Zoom out" onClick={() => zoomBy(0.9)}>−</button><button className="zoom-readout" title="Reset view" onClick={resetView}>{Math.round(zoom * 100)}%</button><button className="icon-button" title="Zoom in" onClick={() => zoomBy(1.1)}>+</button><button className="button secondary" onClick={exportTrace}>Export trace</button></div></div>
        {!workstream && <div className="empty-trace"><span className="pulse">◉</span><div><strong>No inbound voice workstream is available</strong><p>Connect to an environment with a configured inbound voice workstream to see its routing map.</p></div></div>}
        {workstream && !workstream.active && <div className="config-warnings inactive"><strong>This workstream is inactive.</strong> The routing map reflects its saved configuration, not live traffic.</div>}
        {workstream && <>
          <div className="diagram">
            <div className="diagram-toolbar"><span><strong>Route overview</strong><span className="toolbar-muted"> · {enrichmentRules.length} classification rules · {queueRoutingRules.length} queue-routing rules · {reachableQueues.length} queues</span></span><span className="legend"><i className="legend-dot rule" />Rule <i className="legend-dot queue" />Queue <i className="legend-dot outcome" />Outcome</span></div>
            <label className="search diagram-search"><span>⌕</span><input placeholder="Search rule or queue by name" value={diagramQuery} onChange={(event) => setDiagramQuery(event.target.value)} /></label>
            <p className="pan-hint">Scroll to pan · Ctrl/Cmd + scroll or the zoom buttons to zoom</p>
            <div className="route-canvas-wrapper" onWheel={onWheelZoom}>
              <div className="route-canvas" style={{ transform: `scale(${zoom})` }}>
                <div className="route-column entry">
                  <div className="route-node start"><span className="node-kicker">ENTRY</span><strong>{workstream.name}</strong><small>Inbound voice</small></div>
                  <div className="connector vertical" />
                </div>
                <div className="route-column classification">
                  <span className="column-label">CLASSIFICATION</span>
                  {enrichmentRules.length ? enrichmentRules.map((rule, index) => <React.Fragment key={rule.id}>
                    <article className={`route-node enrichment-node ${statusOf(visibleSteps, rule.id)} ${matches(diagramQuery, rule.name) ? "highlighted" : ""}`} onClick={() => setDetail(enrichmentDetail(rule, variableNames))}>
                      <span className="node-kicker">ENRICH {String(index + 1).padStart(2, "0")}</span><strong>{rule.name}</strong><small>{ruleSummary(rule.conditions, variableNames, rule.conditionLogic)}</small><small>Sets {rule.sets.map((s) => variableNames[s.attribute] ?? s.attribute).join(", ") || "nothing"}</small>{!rule.enabled && <small className="disabled-tag">Disabled</small>}<span className="node-arrow">→</span>
                    </article>
                    <div className="connector vertical" />
                  </React.Fragment>) : <p className="sub-empty">No classification (enrichment) rules configured.</p>}
                </div>
                <div className="route-column rules">
                  <span className="column-label">ROUTE TO QUEUE</span>
                  {queueRoutingRules.map((rule, index) => <React.Fragment key={rule.id}>
                    <article className={`route-node rule-node ${statusOf(visibleSteps, rule.id)} ${matches(diagramQuery, rule.name) ? "highlighted" : ""}`} onClick={() => setDetail(queueRoutingDetail(rule, index, variableNames))}>
                      <span className="node-kicker">RULE {String(index + 1).padStart(2, "0")}</span><strong>{rule.name}</strong><small>{ruleSummary(rule.conditions, variableNames, rule.conditionLogic)}</small>{rule.targets.length > 1 && <small className="disabled-tag">Weighted across {rule.targets.length} queues</small>}{rule.targets.some((t) => t.agentId) && <small className="disabled-tag">Assigns directly to an agent</small>}{!rule.enabled && <small className="disabled-tag">Disabled</small>}<span className="node-arrow">→</span>
                    </article>
                    <div className="connector vertical" />
                  </React.Fragment>)}
                  <article className={`route-node rule-node fallback-node ${fallbackQueue ? "" : "missing"}`} onClick={() => setDetail({ kind: "Fallback", title: "No rule matched", summary: fallbackQueue ? `Routes to ${fallbackQueue.name} when no queue-routing rule matches.` : "No fallback queue is configured; unmatched calls produce a warning." })}>
                    <span className="node-kicker">FALLBACK</span><strong>{fallbackQueue ? `Routes to ${fallbackQueue.name}` : "No fallback configured"}</strong><small>{fallbackQueue ? "Used when no rule above matches" : "Unmatched calls will show a configuration warning"}</small>
                  </article>
                </div>
                <div className="route-column queues">
                  <span className="column-label">QUEUES</span>
                  {reachableQueues.map((queue) => {
                    const isExpanded = expanded.has(queue.id);
                    return <article className={`route-node queue-node ${result.queue?.id === queue.id && outcomeHit ? "matched" : ""} ${matches(diagramQuery, queue.name) ? "highlighted" : ""}`} key={queue.id}>
                      <div onClick={() => setDetail(queueDetail(queue))}>
                        <span className="node-kicker">QUEUE</span><strong>{queue.name}</strong><small>{queue.assignmentMethod} assignment</small>
                        <div className="queue-meta"><span>{queue.preQueueOverflowRules.length} pre-queue overflow</span><span>{queue.inQueueOverflowRules.length} in-queue overflow</span></div>
                      </div>
                      <button className="expand-toggle" onClick={() => toggleExpand(queue.id)}>{isExpanded ? "Collapse ▲" : "Expand ▼"}</button>
                      {isExpanded && <div className="queue-detail">
                        <p className="queue-detail-heading">Pre-queue overflow</p>
                        {queue.preQueueOverflowRules.length ? queue.preQueueOverflowRules.sort((a, b) => a.order - b.order).map((rule) => <div className={`sub-row ${statusOf(visibleSteps, rule.id)}`} key={rule.id} onClick={() => setDetail(overflowDetail(rule, variableNames))}><strong>{rule.name}</strong><small>{rule.trigger}: {ruleSummary(rule.conditions, variableNames, rule.conditionLogic)} → {rule.outcome ?? "Agent"}</small></div>) : <p className="sub-empty">No pre-queue overflow rules configured.</p>}
                        <p className="queue-detail-heading">In-queue overflow</p>
                        {queue.inQueueOverflowRules.length ? queue.inQueueOverflowRules.sort((a, b) => a.order - b.order).map((rule) => <div className={`sub-row ${statusOf(visibleSteps, rule.id)}`} key={rule.id} onClick={() => setDetail(overflowDetail(rule, variableNames))}><strong>{rule.name}</strong><small>{rule.trigger}: {ruleSummary(rule.conditions, variableNames, rule.conditionLogic)} → {rule.outcome ?? "Agent"}</small></div>) : <p className="sub-empty">No in-queue overflow rules configured.</p>}
                        <p className="sub-empty">If no overflow rule fires, the call proceeds to normal Agent assignment.</p>
                        {(queueVariableDefs.get(queue.id) ?? []).length > 0 ? <>
                          <p className="queue-detail-heading">Simulated conditions for this queue</p>
                          <div className="fields">{(queueVariableDefs.get(queue.id) ?? []).map((variable) => <label className="field" key={variable.id}><span className="field-label"><strong>{variable.name}</strong>{/iswithinoperatinghour/i.test(variable.id) && <em>From queue calendar</em>}</span><Field variable={variable} value={queueValues[queue.id]?.[variable.id]} onChange={(value) => setQueueValues((previous) => ({ ...previous, [queue.id]: { ...previous[queue.id], [variable.id]: value } }))} /></label>)}</div>
                        </> : <p className="sub-empty">Nothing to simulate for this queue — its overflow rules above either don't exist or have no conditions to vary.</p>}
                      </div>}
                    </article>;
                  })}
                </div>
                <div className="route-column outcomes">
                  <span className="column-label">OUTCOME</span>
                  {OUTCOME_TYPES.map((type) => <article key={type} className={`route-node outcome-node ${reachableOutcomes.has(type) ? "reachable" : "unreachable"} ${outcomeHit === type ? "matched" : ""}`} onClick={() => setDetail({ kind: "Outcome", title: type, summary: outcomeDescription(type) })}>
                    <span className="node-kicker">OUTCOME</span><strong>{type}</strong>
                  </article>)}
                </div>
              </div>
            </div>
          </div>
          <div className="trace-panel">
            <div className="trace-header"><div><p className="eyebrow">Simulation trace</p><h3>{outcomeHit ? `Outcome: ${outcomeHit}` : "Ready to simulate"}</h3></div><div className="trace-actions">
              {result.steps.length > 0 && <span className="playback-progress">Step {revealCount}/{result.steps.length}</span>}
              <button className="button secondary" onClick={() => stepBy(-1)} disabled={!result.steps.length || revealCount === 0}>◀ Back</button>
              <button className="button secondary" onClick={() => stepBy(1)} disabled={!result.steps.length || revealCount >= result.steps.length}>Step ▶</button>
              <button className="button secondary" onClick={play} disabled={!result.steps.length || playing}>{playing ? "Playing…" : "▶ Play"}</button>
              <button className="button primary" onClick={run}>Run simulation</button>
            </div></div>
            {visibleSteps.length ? <div className="trace-list">{visibleSteps.map((step) => <div className={`trace-row ${step.status}`} key={`${step.id}-${step.kind}`}><span className="trace-marker" /><div><strong>{step.label}</strong><p>{step.detail}</p></div><span className="trace-type">{step.kind}</span></div>)}</div> : <div className="empty-trace"><span className="pulse">◉</span><div><strong>Enter context values, then run a simulation</strong><p>The evaluator runs entirely in your browser. No call or Dataverse record is created.</p></div></div>}
            {result.warnings.map((warning) => <div className="warning" key={warning}>⚠ {warning}</div>)}
          </div>
        </>}
      </section>
      <aside className="inspector">
        <div className="section-heading"><div><p className="eyebrow">Simulation time</p><h2>When the call arrives</h2></div></div>
        <p className="muted">Drives any operating-hours overflow rules below; change it to see behavior at different times.</p>
        <div className="fields">
          <label className="field"><span className="field-label"><strong>Date &amp; time</strong></span><input className="field-control" type="datetime-local" value={toDatetimeLocalValue(simulationTime)} onChange={(event) => event.target.value && setSimulationTime(new Date(event.target.value))} /></label>
          <button className="button secondary" onClick={() => setSimulationTime(new Date())}>Now</button>
        </div>
        <div className="inspector-divider" />
        <div className="section-heading"><div><p className="eyebrow">IVR simulation</p><h2>Context values</h2></div><span className="variable-count">{ivrVariables.length} vars</span></div>
        <p className="muted">Represent what the caller would have entered through the IVR.</p>
        <div className="fields">{ivrVariables.map((variable) => <label className="field" key={variable.id}><span className="field-label"><strong>{variable.name}</strong>{variable.usedByRuleIds.length ? <em>Used by rules</em> : <em className="unused">Unused</em>}</span><Field variable={variable} value={values[variable.id]} onChange={(value) => setValues((previous) => ({ ...previous, [variable.id]: value }))} /></label>)}</div>
        <p className="muted">Overflow simulation values (wait time, queue size, operating hours) live on each queue itself — expand a queue in the QUEUES column to set them.</p>
        <div className="inspector-divider" />
        <div className="scenario-heading"><h3>Saved scenarios</h3></div>
        <p className="muted">Captures the IVR values, every queue's simulated overflow inputs, and the simulation time — scoped to “{workstream?.name ?? "this workstream"}”.</p>
        <div className="scenario-save-row">
          <input className="field-control" placeholder="Scenario name" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveScenario()} />
          <button className="button primary" onClick={saveScenario} disabled={!scenarioName.trim() || !workstream}>Save</button>
        </div>
        {workstreamScenarios.length ? workstreamScenarios.map((scenario) => <div className="scenario-item" key={scenario.name}>
          <div className="scenario-info"><strong>{scenario.name}</strong><small>{scenario.outcome ?? "Not run"}</small></div>
          <button className="button secondary" onClick={() => loadScenario(scenario)}>Load</button>
          <button className="icon-button" title="Delete scenario" onClick={() => deleteScenario(scenario.workstreamId, scenario.name)}>×</button>
        </div>) : <div className="scenario-empty"><span>＋</span><p>No saved scenarios yet</p><small>Save the current settings to rerun after a configuration change.</small></div>}
      </aside>
    </section>
    {detail && <div className="detail-backdrop" onClick={() => setDetail(null)}>
      <div className="detail-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="detail-header"><span className="detail-kind">{detail.kind}</span><button className="icon-button" onClick={() => setDetail(null)}>×</button></div>
        <h3>{detail.title}</h3>
        <p className="muted">{detail.summary}</p>
        {detail.fields && <dl className="detail-fields">{detail.fields.map((field) => <React.Fragment key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></React.Fragment>)}</dl>}
        {detail.conditions && detail.conditions.length > 0 && <><p className="queue-detail-heading">Conditions (raw)</p><table className="detail-table"><tbody>{detail.conditions.map((condition, index) => <tr key={index}><td>{condition.variableId}</td><td>{condition.operator}</td><td>{JSON.stringify(condition.value)}</td></tr>)}</tbody></table></>}
      </div>
    </div>}
  </main>;
}

function enrichmentDetail(rule: EnrichmentRule, variableNames: Record<string, string>): DetailPayload {
  return { kind: "Classification rule", title: rule.name, summary: ruleSummary(rule.conditions, variableNames, rule.conditionLogic), conditions: rule.conditions, fields: [
    { label: "Evaluation order", value: String(rule.order + 1) },
    { label: "Hit policy", value: rule.hitPolicy === "first" ? "First match wins" : "All matches apply" },
    { label: "Enabled", value: rule.enabled ? "Yes" : "No" },
    { label: "Sets", value: rule.sets.length ? rule.sets.map((s) => `${variableNames[s.attribute] ?? s.attribute} = ${JSON.stringify(s.value)}`).join(", ") : "Nothing" }
  ] };
}

function queueRoutingDetail(rule: QueueRoutingRule, index: number, variableNames: Record<string, string>): DetailPayload {
  return { kind: "Queue-routing rule", title: rule.name, summary: ruleSummary(rule.conditions, variableNames, rule.conditionLogic), conditions: rule.conditions, fields: [
    { label: "Evaluation order", value: String(index + 1) },
    { label: "Hit policy", value: rule.hitPolicy === "first" ? "First match wins" : "All matches apply (last match wins)" },
    { label: "Enabled", value: rule.enabled ? "Yes" : "No" },
    { label: "Target", value: rule.targets.length
      ? rule.targets.map((t) => t.agentId ? `Agent ${t.agentId}` : `${t.queueId ?? rule.targetLabel ?? "Not set"}${t.weightPercent !== undefined ? ` (${t.weightPercent}%)` : ""}`).join(", ")
      : "Not set" }
  ] };
}

function overflowDetail(rule: OverflowRule, variableNames: Record<string, string>): DetailPayload {
  return { kind: "Overflow rule", title: rule.name, summary: `${rule.trigger}: ${ruleSummary(rule.conditions, variableNames, rule.conditionLogic)}`, conditions: rule.conditions, fields: [
    { label: "Trigger", value: rule.trigger },
    { label: "Order", value: String(rule.order) },
    { label: "Outcome", value: rule.outcome ?? "Agent (queue default)" },
    ...(rule.targetQueueId ? [{ label: "Transfers to queue", value: rule.targetQueueId }] : [])
  ] };
}

function queueDetail(queue: Queue): DetailPayload {
  return { kind: "Queue", title: queue.name, summary: `${queue.assignmentMethod} assignment with ${queue.preQueueOverflowRules.length} pre-queue and ${queue.inQueueOverflowRules.length} in-queue overflow rule(s).`, fields: [
    { label: "Assignment method", value: queue.assignmentMethod },
    { label: "Queue ID", value: queue.id }
  ] };
}
