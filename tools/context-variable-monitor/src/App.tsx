import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadCapturedValues, loadDefinitions, loadRecentWorkItems, loadWorkstreams } from "./dataverse";
import { buildSnapshot } from "./contextValues";
import { CapturedValue, ContextVariableDefinition, MonitorSnapshot, WorkItemSummary, Workstream } from "./model";

const POLL_INTERVAL_MS = 4000;

// A few preset snapshots that "advance" each time Refresh/Live ticks in demo mode, so the tool
// demonstrates its core value (watching values fill in over a call) without a live connection.
const DEMO_DEFINITIONS: ContextVariableDefinition[] = [
  { id: "d1", name: "PreferredLanguage", displayName: "Preferred language", type: "text" },
  { id: "d2", name: "IsIdentified", displayName: "Caller identified", type: "boolean" },
  { id: "d3", name: "CallReason", displayName: "Call reason", type: "text" },
  { id: "d4", name: "ContactName", displayName: "Contact name", type: "text" }
];
const DEMO_STAGES: { matched: Record<string, string>; extra: Record<string, string> }[] = [
  { matched: {}, extra: { va_BotId: "c9246be2-d50e-7534-5939-9ff2050d8739", va_Scope: "bot" } },
  { matched: { PreferredLanguage: "Dutch" }, extra: { va_BotId: "c9246be2-d50e-7534-5939-9ff2050d8739", va_Scope: "bot" } },
  { matched: { PreferredLanguage: "Dutch", IsIdentified: "true" }, extra: { va_BotId: "c9246be2-d50e-7534-5939-9ff2050d8739", va_Scope: "bot", va_ConversationId: "0ac8a36f-54aa-41a3-a6fe-6fe8ffb071f8" } },
  { matched: { PreferredLanguage: "Dutch", IsIdentified: "true", CallReason: "Sales", ContactName: "Alexander Meijers" }, extra: { va_BotId: "c9246be2-d50e-7534-5939-9ff2050d8739", va_Scope: "bot", va_ConversationId: "0ac8a36f-54aa-41a3-a6fe-6fe8ffb071f8" } }
];
const DEMO_WORK_ITEM: WorkItemSummary = { id: "demo-call", title: "Demo caller: Inbound voice · Customer Care", createdOn: new Date().toISOString(), active: true };

function demoSnapshotAt(stageIndex: number): MonitorSnapshot {
  const stage = DEMO_STAGES[stageIndex % DEMO_STAGES.length];
  const matched = DEMO_DEFINITIONS.map((definition) => {
    const raw = stage.matched[definition.name];
    return { definition, value: raw === undefined ? undefined : ({ name: definition.name, rawValue: raw, displayValue: raw, type: definition.type, capturedOn: new Date().toISOString() } as CapturedValue) };
  });
  const extra: CapturedValue[] = Object.entries(stage.extra).map(([name, raw]) => ({ name, rawValue: raw, displayValue: raw, type: "text", capturedOn: new Date().toISOString() }));
  return { matched, extra };
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

function valueRowKey(name: string): string { return name.toLowerCase(); }

export function App(): React.ReactElement {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Demo data is shown until a Dataverse connection is available.");
  const [warnings, setWarnings] = useState<string[]>([]);

  const [workstreams, setWorkstreams] = useState<Workstream[]>([{ id: "demo-stream", name: "Inbound voice · Customer Care", active: true }]);
  const [selectedId, setSelectedId] = useState("demo-stream");
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [definitions, setDefinitions] = useState<ContextVariableDefinition[]>(DEMO_DEFINITIONS);
  const [recentItems, setRecentItems] = useState<WorkItemSummary[]>([DEMO_WORK_ITEM]);
  const [selectionMode, setSelectionMode] = useState<"latest" | "pinned">("latest");
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | undefined>(DEMO_WORK_ITEM.id);
  const [snapshot, setSnapshot] = useState<MonitorSnapshot>(() => demoSnapshotAt(0));
  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | undefined>(undefined);
  const [live, setLive] = useState(false);

  const demoStageRef = useRef(0);
  const previousValuesRef = useRef<Map<string, string>>(new Map());
  const timerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(timerRef.current), []);

  const workstream = workstreams.find((candidate) => candidate.id === selectedId);
  const selectedWorkItem = recentItems.find((item) => item.id === selectedWorkItemId);

  function applySnapshot(next: MonitorSnapshot) {
    const nextValues = new Map<string, string>();
    next.matched.forEach((m) => { if (m.value) nextValues.set(valueRowKey(m.definition.name), m.value.displayValue); });
    next.extra.forEach((v) => nextValues.set(valueRowKey(v.name), v.displayValue));

    const changed = new Set<string>();
    nextValues.forEach((value, key) => { if (previousValuesRef.current.get(key) !== value) changed.add(key); });
    previousValuesRef.current = nextValues;

    setSnapshot(next);
    setChangedKeys(changed);
    setLastUpdated(new Date());
    if (changed.size) window.setTimeout(() => setChangedKeys(new Set()), 2500);
  }

  async function refreshDemo() {
    demoStageRef.current += 1;
    applySnapshot(demoSnapshotAt(demoStageRef.current));
  }

  async function refreshLive(workstreamId: string, pinnedWorkItemId: string | undefined) {
    try {
      const items = await loadRecentWorkItems(workstreamId);
      setRecentItems(items);
      const targetId = pinnedWorkItemId ?? items[0]?.id;
      setSelectedWorkItemId(targetId);
      if (!targetId) { applySnapshot({ matched: definitions.map((definition) => ({ definition })), extra: [] }); return; }
      const captured = await loadCapturedValues(targetId);
      applySnapshot(buildSnapshot(definitions, captured));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to refresh call data.");
    }
  }

  function refresh() {
    if (!connected) { refreshDemo(); return; }
    if (!workstream) return;
    refreshLive(workstream.id, selectionMode === "pinned" ? selectedWorkItemId : undefined);
  }

  async function connect() {
    setLoading(true); setMessage("Connecting to the current Dataverse session…");
    try {
      const loaded = await loadWorkstreams();
      setConnected(true);
      setWorkstreams(loaded);
      setWarnings(loaded.length ? [] : ["No inbound voice workstreams were found in this environment."]);
      const first = loaded[0];
      setSelectedId(first?.id ?? "");
      if (first) await selectWorkstream(first.id, true);
      setMessage(loaded.length ? "Connected. Reading is read-only; no data is modified." : "Connected, but no inbound voice workstreams were found.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read this Dataverse environment.");
    } finally { setLoading(false); }
  }

  async function selectWorkstream(id: string, alreadyConnected = connected) {
    setSelectedId(id);
    setSelectionMode("latest");
    setSelectedWorkItemId(undefined);
    previousValuesRef.current = new Map();
    if (!alreadyConnected) return;
    setLoading(true);
    try {
      const defs = await loadDefinitions(id);
      setDefinitions(defs);
      const items = await loadRecentWorkItems(id);
      setRecentItems(items);
      const latest = items[0];
      setSelectedWorkItemId(latest?.id);
      const captured = latest ? await loadCapturedValues(latest.id) : [];
      applySnapshot(buildSnapshot(defs, captured));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load this workstream's context variables.");
    } finally { setLoading(false); }
  }

  function pinWorkItem(item: WorkItemSummary) {
    setSelectionMode("pinned");
    setSelectedWorkItemId(item.id);
    previousValuesRef.current = new Map();
    if (!connected) { applySnapshot(demoSnapshotAt(demoStageRef.current)); return; }
    (async () => {
      try {
        const captured = await loadCapturedValues(item.id);
        applySnapshot(buildSnapshot(definitions, captured));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to load this call's captured values.");
      }
    })();
  }

  function backToLatest() {
    setSelectionMode("latest");
    previousValuesRef.current = new Map();
    refresh();
  }

  function toggleLive() {
    setLive((wasLive) => {
      const nowLive = !wasLive;
      window.clearInterval(timerRef.current);
      if (nowLive) timerRef.current = window.setInterval(refresh, POLL_INTERVAL_MS);
      return nowLive;
    });
  }
  // Keep the running interval's closure fresh when the selection changes while Live is on.
  useEffect(() => {
    if (!live) return;
    window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(timerRef.current);
  }, [live, selectedId, selectionMode, selectedWorkItemId, connected]);

  const filteredWorkstreams = useMemo(() => workstreams.filter((candidate) => candidate.name.toLowerCase().includes(sidebarQuery.toLowerCase())), [workstreams, sidebarQuery]);

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">CVM</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Context Variable Monitor</h1></div>
      <div className="topbar-actions">
        <span className="read-only"><span className="status-dot" />Read-only mode</span>
        <button className="button secondary" onClick={connect} disabled={loading}>{loading ? "Connecting…" : "Connect environment"}</button>
      </div>
    </header>
    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}
    {warnings.length > 0 && <div className="config-warnings"><strong>Configuration warnings</strong><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
    <section className="workspace">
      <aside className="sidebar">
        <div className="section-heading"><div><p className="eyebrow">Configuration</p><h2>Workstreams</h2></div><span className="count">{workstreams.length}</span></div>
        <label className="search"><span>⌕</span><input placeholder="Search workstreams" value={sidebarQuery} onChange={(event) => setSidebarQuery(event.target.value)} /></label>
        <div className="workstream-list">{filteredWorkstreams.map((candidate) => <button className={`workstream-item ${candidate.id === selectedId ? "selected" : ""}`} key={candidate.id} onClick={() => selectWorkstream(candidate.id)}><span className="voice-icon">◒</span><span><strong>{candidate.name}</strong><small>{candidate.active ? "Active" : "Inactive"} · Inbound voice</small></span><span className={`status-pill ${candidate.active ? "active" : "inactive"}`}>{candidate.active ? "Live" : "Off"}</span></button>)}</div>
        <div className="sidebar-footer"><span className="shield">◇</span><span>Read-only — this tool never modifies a call or its context variables.</span></div>
      </aside>
      <section className="content">
        <div className="content-header">
          <div><p className="eyebrow">Live call context</p><h2>{workstream?.name ?? "No workstream selected"}</h2><p className="muted">Watch real context-variable values as they're captured on an actual call going through the IVR and unified routing.</p></div>
          <div className="view-actions">
            <button className={`button ${live ? "primary" : "secondary"}`} onClick={toggleLive}>{live ? "◉ Live" : "▷ Go live"}</button>
            <button className="button secondary" onClick={refresh}>Refresh</button>
          </div>
        </div>
        <div className="tracking-row">
          {selectionMode === "latest"
            ? <span className="tracking-badge latest">Tracking latest call{selectedWorkItem ? `: ${selectedWorkItem.title}` : " — none yet"}</span>
            : <span className="tracking-badge pinned">Viewing {selectedWorkItem?.title ?? "a call"} <button className="link-button" onClick={backToLatest}>Back to latest</button></span>}
          {lastUpdated && <span className="muted last-updated">Updated {relativeTime(lastUpdated.toISOString())}</span>}
        </div>
        <div className="variable-table">
          <div className="variable-table-heading"><span>DEFINED CONTEXT VARIABLES</span><span>{definitions.length}</span></div>
          {snapshot.matched.length ? snapshot.matched.map(({ definition, value }) => <div className={`variable-row ${changedKeys.has(valueRowKey(definition.name)) ? "changed" : ""}`} key={definition.id}>
            <div className="variable-name"><strong>{definition.displayName}</strong><small>{definition.name} · {definition.type}</small></div>
            <div className={`variable-value ${value ? "" : "unset"}`}>{value ? value.displayValue : "Not set yet"}</div>
          </div>) : <p className="sub-empty">This workstream has no defined context variables.</p>}
        </div>
        {snapshot.extra.length > 0 && <div className="variable-table">
          <div className="variable-table-heading"><span>ADDITIONAL CAPTURED VALUES</span><span>{snapshot.extra.length}</span></div>
          <p className="muted">Set on this call but not declared as a workstream context variable — often bot/IVR-internal values, useful for debugging.</p>
          {snapshot.extra.map((value) => <div className={`variable-row ${changedKeys.has(valueRowKey(value.name)) ? "changed" : ""}`} key={value.name}>
            <div className="variable-name"><strong>{value.name}</strong><small>{value.type}</small></div>
            <div className="variable-value">{value.displayValue}</div>
          </div>)}
        </div>}
      </section>
      <aside className="inspector">
        <div className="section-heading"><div><p className="eyebrow">Recent activity</p><h2>Recent calls</h2></div><span className="variable-count">{recentItems.length}</span></div>
        <p className="muted">Pick a call to inspect its captured values instead of always tracking the latest one.</p>
        <div className="fields">{recentItems.length ? recentItems.map((item) => <button className={`call-item ${item.id === selectedWorkItemId ? "selected" : ""}`} key={item.id} onClick={() => pinWorkItem(item)}>
          <strong>{item.title}</strong>
          <small>{relativeTime(item.createdOn)}{item.active ? " · In progress" : ""}</small>
        </button>) : <div className="scenario-empty"><span>◔</span><p>No recent calls found</p><small>Place a test call on this workstream, then hit Refresh.</small></div>}</div>
      </aside>
    </section>
  </main>;
}
