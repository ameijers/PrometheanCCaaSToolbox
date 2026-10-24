// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { environmentLabel, isDataverseAvailable, recordUrl } from "../../shared/src/xrm";
import { loadGraph } from "../../environment-3d-explorer/src/dataverse";
import { demoRaw } from "../../environment-3d-explorer/src/demoData";
import { useFullscreen } from "../../environment-3d-explorer/src/fullscreen";
import { buildGraph } from "../../environment-3d-explorer/src/graph";
import { findIssues, SEVERITY_LABELS, worstByKey } from "../../environment-3d-explorer/src/health";
import { EDGE_LABELS, Graph, GraphEdge, KINDS } from "../../environment-3d-explorer/src/model";
import { CameraGoal, Mode, SceneHandle } from "../../environment-3d-explorer/src/Scene";
import { readUrlOptions } from "../../environment-3d-explorer/src/urlOptions";
import { CampusScene, SEVERITY_COLORS } from "./CampusScene";
import { CENTER_COLORS, combine, Grouping, moveWorkstream, recolor, reconcile, rename, split } from "./centers";
import { buildPlan, UNROUTED_CENTER, Vec3 } from "./floorplan";
import { browserStore } from "./store";

type Tab = "centers" | "health" | "help";
const TABS: { id: Tab; label: string }[] = [{ id: "centers", label: "Customer centers" }, { id: "health", label: "Health" }, { id: "help", label: "Help" }];
const MAX_LISTED = 40;

// What each record is in the building, for the details panel.
const IN_THE_BUILDING: Record<string, string> = {
  phone: "Phone line", channel: "Entrance", bot: "Automated reception", workstream: "Lobby and reception", rule: "Signpost",
  queue: "Room", agent: "Desk", hours: "Opening hours", overflow: "At the door"
};

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const environment = live ? environmentLabel() : "the sample environment";
  const store = useMemo(() => browserStore(), []);

  const [graph, setGraph] = useState<Graph | undefined>(undefined);
  const [grouping, setGrouping] = useState<Grouping | undefined>(undefined);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<Mode>("orbit");
  const [goal, setGoal] = useState<CameraGoal | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("centers");
  const [search, setSearch] = useState("");
  const [showHealth, setShowHealth] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [combineName, setCombineName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | undefined>(undefined);
  const { fullscreen, error: fullscreenError, toggle: toggleFullscreen } = useFullscreen();
  const sceneHandle = useRef<SceneHandle | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setSelected(undefined);
    try {
      const g = live ? await loadGraph() : buildGraph(demoRaw());
      setGraph(g);
      setGrouping(reconcile(await store.load(environment), g));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [live, store, environment]);
  useEffect(() => { void load(); }, [load]);

  // Every change to the centers is remembered straight away.
  const change = (next: Grouping) => { setGrouping(next); void store.save(environment, next); };

  const plan = useMemo(() => (graph && grouping ? buildPlan(graph, grouping) : undefined), [graph, grouping]);
  const nodeByKey = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.key, n])), [graph]);
  const issues = useMemo(() => (graph ? findIssues(graph) : []), [graph]);
  const worst = useMemo(() => worstByKey(issues), [issues]);
  const problemCount = issues.filter((i) => i.severity === "problem").length;

  const flyTo = (position: Vec3, target: Vec3) => setGoal((g) => ({ position, target, serial: (g?.serial ?? 0) + 1 }));
  const overview = useCallback(() => {
    if (!plan) return;
    const size = Math.max(plan.bounds.w, plan.bounds.d, 60);
    setGoal((g) => ({ position: [plan.bounds.x, size * 0.75, plan.bounds.z + size * 0.85], target: [plan.bounds.x, 0, plan.bounds.z], serial: (g?.serial ?? 0) + 1 }));
  }, [plan]);

  const centerOfKey = (key: string): string | undefined => {
    if (key.startsWith("center:")) return key.slice(7);
    const at = plan?.anchors.get(key);
    return at ? plan?.buildings.find((b) => at[0] >= b.x && at[0] <= b.x + b.w && at[2] <= b.z && at[2] >= b.z - b.d)?.centerId : undefined;
  };
  const select = useCallback((key: string) => {
    setSelected(key);
    const at = plan?.anchors.get(key);
    if (!at || !plan) return;
    if (key.startsWith("center:")) {
      const b = plan.buildings.find((x) => `center:${x.centerId}` === key)!;
      const size = Math.max(b.w, b.d);
      flyTo([at[0], size * 0.95, at[2] + size * 0.9], [at[0], 0, at[2]]);
    } else {
      flyTo([at[0] + 7, at[1] + 13, at[2] + 15], at);
    }
  }, [plan]);

  // Start above the whole campus once it's there, or at the center or record in ?focus=<name> (as in the explorer).
  const started = useRef(false);
  useEffect(() => {
    if (!plan || !grouping || started.current) return;
    started.current = true;
    const wanted = (readUrlOptions(window.location.search).focus ?? "").toLowerCase();
    const center = wanted ? grouping.centers.find((c) => c.name.toLowerCase().includes(wanted)) : undefined;
    const record = wanted && !center ? (graph?.nodes ?? []).find((n) => plan.anchors.has(n.key) && n.name.toLowerCase() === wanted) ?? (graph?.nodes ?? []).find((n) => plan.anchors.has(n.key) && n.name.toLowerCase().includes(wanted)) : undefined;
    if (center) select(`center:${center.id}`); else if (record) select(record.key); else overview();
  }, [plan, overview]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") setSelected(undefined);
      if (e.key === "m" || e.key === "M") setMode((m) => (m === "orbit" ? "walk" : "orbit"));
      if (e.key === "f" || e.key === "F") void toggleFullscreen();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [toggleFullscreen]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !graph || !plan) return [];
    return graph.nodes.filter((n) => plan.anchors.has(n.key) && n.name.toLowerCase().includes(q)).slice(0, 12);
  }, [graph, plan, search]);

  if (!graph || !grouping || !plan) {
    return (
      <div className="campus">
        <div className="overlay">{loading ? <p>Reading {environment}…</p> : <div><p>Couldn't read the environment: {error}</p><button onClick={() => void load()}>Try again</button></div>}</div>
      </div>
    );
  }

  const selectedNode = selected ? nodeByKey.get(selected) : undefined;
  const selectedCenter = selected?.startsWith("center:") ? grouping.centers.find((c) => `center:${c.id}` === selected) ?? (selected === `center:${UNROUTED_CENTER}` ? { id: UNROUTED_CENTER, name: "Not routed", color: "#64748b", workstreams: [] } : undefined) : undefined;
  const focusCenter = selected ? centerOfKey(selected) : undefined;
  const openUrl = live && selectedNode?.recordId && KINDS[selectedNode.kind].table ? recordUrl(KINDS[selectedNode.kind].table!, selectedNode.recordId) : undefined;
  const linked = (edges: GraphEdge[], side: "from" | "to") => edges.map((e) => ({ e, n: nodeByKey.get(e[side]) })).filter((x) => x.n);
  const upstream = selectedNode ? linked(graph.edges.filter((e) => e.to === selectedNode.key), "from") : [];
  const downstream = selectedNode ? linked(graph.edges.filter((e) => e.from === selectedNode.key), "to") : [];
  const workstreamName = (id: string) => nodeByKey.get(`workstream:${id}`)?.name ?? id;

  return (
    <div className="campus">
      <CampusScene plan={plan} mode={mode} goal={goal} selected={selected} focusCenter={focusCenter} issues={showHealth ? worst : undefined} handle={sceneHandle} onSelect={select} onHover={() => undefined} />

      <aside className="panel left">
        <header>
          <div className="brand-mark">PCT</div>
          <div>
            <p className="eyebrow">Promethean CCaaS Toolbox</p>
            <h1>3D Contact Center</h1>
          </div>
        </header>
        <p className="target"><span className={`status-dot${live ? " live" : ""}`} />{environment}</p>

        <div className="search">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a room, desk, lobby…" aria-label="Search" />
          {results.length > 0 && (
            <ul className="results">
              {results.map((n) => (
                <li key={n.key}><button onClick={() => { select(n.key); setSearch(""); }}><span className="dot" style={{ background: KINDS[n.kind].color }} /><span className="name">{n.name}</span><span className="relation">{IN_THE_BUILDING[n.kind] ?? KINDS[n.kind].label}</span></button></li>
              ))}
            </ul>
          )}
        </div>

        <div className="mode">
          <button className={mode === "orbit" ? "on" : ""} onClick={() => setMode("orbit")}>Orbit</button>
          <button className={mode === "walk" ? "on" : ""} onClick={() => setMode("walk")}>Walk</button>
          <button onClick={overview}>Campus</button>
          <button className={fullscreen ? "on" : ""} onClick={() => void toggleFullscreen()} title="Full screen (F)">{fullscreen ? "Exit full screen" : "Full screen"}</button>
        </div>
        {fullscreenError && <p className="muted small error-text">{fullscreenError}</p>}

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}{t.id === "health" && problemCount > 0 && <span className="badge problem">{problemCount}</span>}
            </button>
          ))}
        </nav>

        <div className="tab-body" role="tabpanel">
          {tab === "centers" && (
            <>
              <p className="muted small">Each workstream starts as a customer center of its own. Tick two or more and combine them into one building. {store.where}.</p>
              <ul className="center-list">
                {grouping.centers.map((c) => (
                  <li key={c.id}>
                    <div className="center-row">
                      <input type="checkbox" checked={checked.has(c.id)} onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} aria-label={`Select ${c.name}`} />
                      <label className="swatch" style={{ background: c.color }} title="Colour">
                        <select value={c.color} onChange={(e) => change(recolor(grouping, c.id, e.target.value))} aria-label={`Colour of ${c.name}`}>
                          {CENTER_COLORS.map((col) => <option key={col} value={col}>{col}</option>)}
                        </select>
                      </label>
                      {renaming?.id === c.id ? (
                        <input className="rename" autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") { change(rename(grouping, c.id, renaming.name)); setRenaming(undefined); } if (e.key === "Escape") setRenaming(undefined); }}
                          onBlur={() => { change(rename(grouping, c.id, renaming.name)); setRenaming(undefined); }} />
                      ) : (
                        <button className="name link-like" onClick={() => select(`center:${c.id}`)} onDoubleClick={() => setRenaming({ id: c.id, name: c.name })} title="Click to go there, double-click to rename">{c.name}</button>
                      )}
                      <button className="small" onClick={() => setRenaming({ id: c.id, name: c.name })} title="Rename">✎</button>
                      {c.workstreams.length > 1 && <button className="small" onClick={() => change(split(grouping, c.id, graph))} title="Give every workstream its own center again">Split</button>}
                    </div>
                    {c.workstreams.length > 1 && (
                      <ul className="ws-list">
                        {c.workstreams.map((id) => (
                          <li key={id}>
                            <span className="name">{workstreamName(id)}</span>
                            <select value="" onChange={(e) => change(moveWorkstream(grouping, id, e.target.value, graph))} aria-label={`Move ${workstreamName(id)}`}>
                              <option value="">Move to…</option>
                              <option value="new">A center of its own</option>
                              {grouping.centers.filter((o) => o.id !== c.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
              <div className="combine">
                <input value={combineName} onChange={(e) => setCombineName(e.target.value)} placeholder="Name of the combined center" aria-label="Name of the combined center" />
                <button disabled={checked.size < 2} onClick={() => { change(combine(grouping, [...checked], combineName)); setChecked(new Set()); setCombineName(""); }}>Combine {checked.size > 1 ? checked.size : ""}</button>
              </div>
              <button className="link" onClick={() => change(reconcile(undefined, graph))}>Start again: one center per workstream</button>
            </>
          )}

          {tab === "health" && (
            <div className="health">
              <label className="toggle">
                <input type="checkbox" checked={showHealth} onChange={(e) => setShowHealth(e.target.checked)} />
                <span>Show problems</span>
                <span className="badge problem">{problemCount}</span>
                <span className="badge warning">{issues.length - problemCount}</span>
              </label>
              {showHealth && (
                <ul className="issue-list">
                  {issues.filter((i) => plan.anchors.has(i.key)).slice(0, MAX_LISTED).map((i) => (
                    <li key={`${i.key}:${i.check}`}><button onClick={() => select(i.key)}><span className="dot" style={{ background: SEVERITY_COLORS[i.severity] }} /><span className="name">{nodeByKey.get(i.key)?.name}</span><span className="relation">{i.title}</span></button></li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "help" && (
            <>
              <dl className="help">
                <dt>Drag</dt><dd>{mode === "orbit" ? "rotate" : "look around"}</dd>
                {mode === "orbit" && <><dt>Scroll</dt><dd>zoom</dd><dt>Right-drag</dt><dd>pan</dd></>}
                <dt>W A S D</dt><dd>move (Shift: faster)</dd>
                <dt>E / Q</dt><dd>up / down</dd>
                <dt>Click</dt><dd>go to a building, room or desk</dd>
                <dt>M</dt><dd>switch orbit / walk</dd>
                <dt>F</dt><dd>full screen</dd>
                <dt>Esc</dt><dd>clear the selection</dd>
              </dl>
              <p className="muted small">Entrance doors are voice channels, with their phone numbers above them. Each lobby is a workstream with its reception (and the bot's kiosk in front of it); signposts are routing rules, and the lines on the floor lead to their rooms. Rooms are queues, desks are agents. Outside a room's door: a mailbox for voicemail, a phone booth for a callback, an exit for ending the conversation, a purple door for a transfer. Blue skybridges go to a room in another center.</p>
              {graph.warnings.length > 0 && <ul className="warnings-list">{graph.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              <button className="link" onClick={() => void load()} disabled={loading}>Read the environment again</button>
            </>
          )}
        </div>
      </aside>

      {(selectedNode || selectedCenter) && (
        <aside className="panel right">
          {selectedCenter ? (
            <>
              <div className="kind" style={{ color: selectedCenter.color }}>Customer center</div>
              <h2>{selectedCenter.name}</h2>
              <dl className="details">
                <dt>Workstreams</dt><dd>{selectedCenter.workstreams.length}</dd>
                <dt>Rooms</dt><dd>{plan.areas.filter((a) => a.kind === "room" && a.centerId === selectedCenter.id).length}</dd>
                <dt>Desks</dt><dd>{plan.fixtures.filter((f) => f.kind === "desk" && centerOfKey(f.key ?? "") === selectedCenter.id).length}</dd>
              </dl>
              <ul className="link-list">
                {selectedCenter.workstreams.map((id) => <li key={id}><button onClick={() => select(`workstream:${id}`)}>{workstreamName(id)}<small>lobby</small></button></li>)}
              </ul>
            </>
          ) : selectedNode && (
            <>
              <div className="kind" style={{ color: KINDS[selectedNode.kind].color }}>{IN_THE_BUILDING[selectedNode.kind] ?? KINDS[selectedNode.kind].label} · {KINDS[selectedNode.kind].label}</div>
              <h2>{selectedNode.name}</h2>
              <dl className="details">
                {selectedNode.details.map(([l, v]) => <React.Fragment key={l}><dt>{l}</dt><dd>{v || "—"}</dd></React.Fragment>)}
                {selectedNode.kind === "queue" && (plan.elsewhere.get(selectedNode.key) ?? 0) > 0 && <><dt>Desk in another room</dt><dd>{plan.elsewhere.get(selectedNode.key)}</dd></>}
              </dl>
              {issues.filter((i) => i.key === selectedNode.key).map((i) => (
                <div key={i.check} className={`finding ${i.severity}`}><strong>{SEVERITY_LABELS[i.severity]}: {i.title}</strong><p>{i.detail}</p><p className="fix">{i.fix}</p></div>
              ))}
              <div className="actions">
                {openUrl && <a href={openUrl} target="_blank" rel="noreferrer">Open record ↗</a>}
                <button className="link" onClick={() => setSelected(undefined)}>Close</button>
              </div>
              {[["Comes from", upstream], ["Goes to", downstream]].map(([title, list]) => (list as typeof upstream).length > 0 && (
                <div key={title as string} className="connections">
                  <h3>{title as string}</h3>
                  <ul className="link-list">
                    {(list as typeof upstream).slice(0, MAX_LISTED).map(({ e, n }) => (
                      <li key={`${e.from}>${e.to}:${e.kind}`}><button onClick={() => plan.anchors.has(n!.key) && select(n!.key)}><span className="dot" style={{ background: KINDS[n!.kind].color }} />{n!.name}<small>{e.label ? `${EDGE_LABELS[e.kind]} · ${e.label}` : EDGE_LABELS[e.kind]}</small></button></li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </aside>
      )}
    </div>
  );
}
