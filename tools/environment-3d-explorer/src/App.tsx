// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { environmentLabel, isDataverseAvailable, recordUrl } from "../../shared/src/xrm";
import { loadGraph, loadLiveRows } from "./dataverse";
import { demoRaw } from "./demoData";
import { demoLiveSource } from "./demoLive";
import { buildLive, CONVERSATION_COLORS, CONVERSATION_LABELS, Live, LiveRows, liveDetails, newArrivals, Presence, PRESENCE_COLORS, PRESENCE_LABELS, waitingByQueue } from "./live";
import { buildGraph, chainOf } from "./graph";
import { findIssues, SEVERITY_LABELS, worstByKey } from "./health";
import { computeLayout, connectionScales } from "./layout";
import { EDGE_LABELS, Graph, GraphEdge, GraphNode, KIND_ORDER, KINDS, NodeKind } from "./model";
import { CameraGoal, Mode, Ride, SEVERITY_COLORS, START_POSITION, Scene, SceneHandle } from "./Scene";
import { defaultRideStart, extendRide, RideOption } from "./ride";
import { readUrlOptions } from "./urlOptions";
import { loadViews, nextViewName, SavedView, storeViews } from "./views";

// Live activity is read again this often; the demo moves faster so there's something to see.
const LIVE_REFRESH_MS = 15000;
const DEMO_REFRESH_MS = 5000;
const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

// Choices shown at a fork in the ride; the rest are counted.
const MAX_RIDE_CHOICES = 8;

const MAX_ISSUES_LISTED = 60;

// Checks that were skipped because a table couldn't be read.
const SKIPPED_CHECKS: Record<string, string> = {
  phoneNumbers: "voice channels without a number",
  channels: "voice workstreams without a channel, and unused numbers",
  resources: "agents without a bookable resource",
  skills: ""
};

const MAX_CONNECTIONS = 40;

function Connections({ title, edges, side, nodeByKey, onSelect }: {
  title: string; edges: GraphEdge[]; side: "from" | "to"; nodeByKey: Map<string, GraphNode>; onSelect(key: string): void;
}) {
  if (!edges.length) return null;
  return (
    <div className="connections">
      <h3>{title} <span className="count">{edges.length}</span></h3>
      <ul>
        {edges.slice(0, MAX_CONNECTIONS).map((e) => {
          const other = nodeByKey.get(e[side]);
          if (!other) return null;
          return (
            <li key={`${e.from}>${e.to}:${e.kind}`}>
              <button onClick={() => onSelect(other.key)}>
                <span className="dot" style={{ background: KINDS[other.kind].color }} />
                <span className="name">{other.name}</span>
                <span className="relation">{e.label ? `${EDGE_LABELS[e.kind]} · ${e.label}` : EDGE_LABELS[e.kind]}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {edges.length > MAX_CONNECTIONS && <p className="muted">and {edges.length - MAX_CONNECTIONS} more</p>}
    </div>
  );
}

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const environment = live ? environmentLabel() : "the sample environment";

  const [graph, setGraph] = useState<Graph | undefined>(undefined);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hiddenKinds, setHiddenKinds] = useState<Set<NodeKind>>(() => new Set(KIND_ORDER.filter((k) => KINDS[k].hiddenAtFirst)));
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const [chainOnly, setChainOnly] = useState(false);
  const [mode, setMode] = useState<Mode>("orbit");
  const [goal, setGoal] = useState<CameraGoal | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [showWarnings, setShowWarnings] = useState(false);
  const urlOptions = useMemo(() => readUrlOptions(window.location.search), []);
  const [showHealth, setShowHealth] = useState(urlOptions.health);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [sizeByConnections, setSizeByConnections] = useState(false);
  const [ride, setRide] = useState<{ id: number; path: string[]; options: RideOption[]; playing: boolean; routeOnly: boolean } | undefined>(undefined);
  const [views, setViews] = useState<SavedView[]>(() => loadViews(environment));
  const [viewName, setViewName] = useState("");
  const sceneHandle = useRef<SceneHandle | null>(null);
  const [liveOn, setLiveOn] = useState(urlOptions.live);
  const [activity, setActivity] = useState<Live | undefined>(undefined);
  const [liveError, setLiveError] = useState("");
  const [arrivals, setArrivals] = useState<{ id: string; from: CameraGoal["position"]; to: CameraGoal["position"] }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setSelected(undefined);
    try {
      setGraph(live ? await loadGraph() : buildGraph(demoRaw()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [live]);
  useEffect(() => { void load(); }, [load]);

  const positions = useMemo(() => (graph ? computeLayout(graph) : new Map()), [graph]);

  // Live activity: read now and then every so often while it's on. A failed read keeps the last picture.
  useEffect(() => {
    if (!liveOn || !graph) { setActivity(undefined); setArrivals([]); return; }
    let cancelled = false;
    let previous: Live | undefined;
    const demo = !isDataverseAvailable() ? demoLiveSource(graph) : undefined;
    const readRows = (since: string): Promise<LiveRows> => (demo ? Promise.resolve(demo(since)) : loadLiveRows(graph, since));
    const read = async () => {
      try {
        const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
        const next = buildLive(graph, await readRows(since), new Date().toISOString());
        if (cancelled) return;
        const arriving = newArrivals(previous, next)
          .map((c) => ({ id: `${c.id}:${next.readAt}`, from: positions.get(c.workstreamKey ?? ""), to: positions.get(c.queueKey ?? c.agentKey ?? "") }))
          .filter((a): a is { id: string; from: CameraGoal["position"]; to: CameraGoal["position"] } => !!a.from && !!a.to);
        previous = next;
        setActivity(next);
        setArrivals(arriving);
        setLiveError("");
      } catch (e) {
        if (!cancelled) setLiveError(e instanceof Error ? e.message : String(e));
      }
    };
    void read();
    const timer = setInterval(() => void read(), demo ? DEMO_REFRESH_MS : LIVE_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [liveOn, graph, positions]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveColors = useMemo(() => (activity ? new Map([...activity.presence.entries()].map(([k, p]) => [k, PRESENCE_COLORS[p.presence]])) : undefined), [activity]);
  const waiting = useMemo(() => (activity ? waitingByQueue(activity) : new Map<string, number>()), [activity]);
  const liveSuffix = useMemo(() => (activity ? new Map([...waiting.entries()].map(([k, n]) => [k, `${n} waiting`])) : undefined), [activity, waiting]);
  const liveConversations = useMemo(() => (activity ? activity.open
    .map((c) => ({ id: c.id, status: c.status, anchor: (c.status === "waiting" ? c.queueKey : c.agentKey ?? c.queueKey) ?? "" }))
    .filter((c) => positions.has(c.anchor)) : undefined), [activity, positions]);
  const presenceCounts = useMemo(() => {
    const counts = new Map<Presence, number>();
    activity?.presence.forEach((p) => counts.set(p.presence, (counts.get(p.presence) ?? 0) + 1));
    return counts;
  }, [activity]);
  const nodeByKey = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.key, n])), [graph]);
  const connectionSizes = useMemo(() => (graph && sizeByConnections ? connectionScales(graph) : undefined), [graph, sizeByConnections]);
  const scales = useMemo(() => {
    if (!waiting.size) return connectionSizes;
    const merged = new Map(connectionSizes ?? []);
    waiting.forEach((n, k) => merged.set(k, (connectionSizes?.get(k) ?? 1) * (1 + Math.min(1.5, Math.sqrt(n) * 0.35))));
    return merged;
  }, [connectionSizes, waiting]);
  const lit = useMemo(() => (graph && selected ? chainOf(graph, selected) : undefined), [graph, selected]);

  const issues = useMemo(() => (graph ? findIssues(graph) : []), [graph]);
  const worst = useMemo(() => worstByKey(issues), [issues]);
  // "Only records with an issue" keeps their direct links too, so you still see where they sit.
  const issueContext = useMemo(() => {
    const keys = new Set(worst.keys());
    (graph?.edges ?? []).forEach((e) => { if (worst.has(e.from)) keys.add(e.to); if (worst.has(e.to)) keys.add(e.from); });
    return keys;
  }, [graph, worst]);
  const problemCount = issues.filter((i) => i.severity === "problem").length;
  const skipped = (graph?.unread ?? []).map((u) => SKIPPED_CHECKS[u]).filter(Boolean);

  const rideKeys = useMemo(() => (ride ? new Set([...ride.path, ...ride.options.map((o) => o.key)]) : undefined), [ride]);
  const visibleNodes = useMemo(
    () => (graph?.nodes ?? []).filter((n) => rideKeys && ride?.routeOnly
      ? rideKeys.has(n.key)
      : !hiddenKinds.has(n.kind) && (!chainOnly || !lit || lit.has(n.key)) && (!showHealth || !problemsOnly || issueContext.has(n.key))),
    [graph, hiddenKinds, chainOnly, lit, showHealth, problemsOnly, issueContext, rideKeys, ride?.routeOnly]
  );
  const visibleEdges = useMemo(() => {
    const visible = new Set(visibleNodes.map((n) => n.key));
    return (graph?.edges ?? []).filter((e) => visible.has(e.from) && visible.has(e.to));
  }, [graph, visibleNodes]);

  const counts = useMemo(() => {
    const c = new Map<NodeKind, number>();
    (graph?.nodes ?? []).forEach((n) => c.set(n.kind, (c.get(n.kind) ?? 0) + 1));
    return c;
  }, [graph]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return (graph?.nodes ?? []).filter((n) => n.name.toLowerCase().includes(q)).slice(0, 12);
  }, [graph, search]);

  // Selecting flies there: from a little in front and to the side, so what comes before the
  // record (in front) and after it (behind) are both in view.
  const select = useCallback((key: string) => {
    setSelected(key);
    const p = positions.get(key);
    if (p) setGoal((g) => ({ position: [p[0] + 26, p[1] + 14, p[2] + 42], target: p, serial: (g?.serial ?? 0) + 1 }));
  }, [positions]);

  // ?focus=<name> (see urlOptions.ts) opens the explorer focused on that record.
  useEffect(() => {
    if (!graph) return;
    const wanted = (urlOptions.focus ?? "").toLowerCase();
    const match = wanted ? graph.nodes.find((n) => n.name.toLowerCase() === wanted) ?? graph.nodes.find((n) => n.name.toLowerCase().includes(wanted)) : undefined;
    if (match) select(match.key);
  }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = useCallback(() => { setSelected(undefined); setChainOnly(false); }, []);
  const flyTo = (position: CameraGoal["position"], target: CameraGoal["target"]) => setGoal((g) => ({ position, target, serial: (g?.serial ?? 0) + 1 }));
  const resetView = () => flyTo(START_POSITION, [0, 0, 0]);

  // "Follow the call": ride from the selected record (or the first phone number) along the route.
  const startRide = (from?: string) => {
    const start = from ?? selected ?? (graph ? defaultRideStart(graph) : undefined);
    if (!graph || !start) return;
    setHovered(undefined);
    setRide({ id: Date.now(), ...extendRide(graph, [start]), playing: true, routeOnly: false });
  };
  const stopRide = useCallback(() => setRide(undefined), []);
  const choose = (option: RideOption) => {
    if (graph) setRide((r) => (r ? { ...r, ...extendRide(graph, [...r.path, option.key]), playing: true } : r));
  };
  const scenePositions = positions;
  const sceneRide = useMemo<Ride | undefined>(
    () => (ride ? { id: ride.id, playing: ride.playing, points: ride.path.map((k) => scenePositions.get(k)).filter((p): p is CameraGoal["position"] => !!p) } : undefined),
    [ride, scenePositions]
  );
  // ?ride=1 starts following the call once the environment is read (from the record in ?focus=, if any).
  const rideStarted = useRef(false);
  useEffect(() => {
    if (rideStarted.current || !urlOptions.ride || !graph || (urlOptions.focus && !selected)) return;
    rideStarted.current = true;
    startRide(selected);
  }, [graph, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveView = () => {
    const view = sceneHandle.current?.view();
    if (!view) return;
    const name = viewName.trim() || nextViewName(views);
    const next = [...views.filter((v) => v.name !== name), { name, ...view }];
    setViews(next);
    storeViews(environment, next);
    setViewName("");
  };
  const deleteView = (name: string) => {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    storeViews(environment, next);
  };
  const screenshot = () => {
    const url = sceneHandle.current?.capture();
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `3d-explorer-${environment.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) { if (e.key === "Escape") (e.target as HTMLInputElement).blur(); return; }
      if (e.key === "Escape") { clear(); stopRide(); }
      if (e.key === "m" || e.key === "M") { setMode((m) => (m === "orbit" ? "walk" : "orbit")); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [clear, stopRide]);

  const selectedNode = selected ? nodeByKey.get(selected) : undefined;
  const hoveredNode = hovered ? nodeByKey.get(hovered) : undefined;
  const selectedIssues = selectedNode ? issues.filter((i) => i.key === selectedNode.key) : [];
  const hoveredIssue = hoveredNode ? issues.find((i) => i.key === hoveredNode.key) : undefined;
  const upstream = selectedNode ? (graph?.edges ?? []).filter((e) => e.to === selectedNode.key) : [];
  const downstream = selectedNode ? (graph?.edges ?? []).filter((e) => e.from === selectedNode.key) : [];
  const openUrl = live && selectedNode?.recordId && KINDS[selectedNode.kind].table ? recordUrl(KINDS[selectedNode.kind].table!, selectedNode.recordId) : undefined;

  return (
    <div className="explorer">
      {graph && !error && (
        <Scene
          nodes={visibleNodes} edges={visibleEdges} positions={positions} lit={rideKeys ?? lit}
          selected={selected} hovered={hovered} mode={mode} goal={goal} issues={showHealth ? worst : undefined}
          scales={scales} handle={sceneHandle} ride={sceneRide} labelKeys={rideKeys ? [...rideKeys] : undefined}
          colors={liveColors} labelSuffix={liveSuffix} conversations={liveConversations} arrivals={arrivals}
          onHover={setHovered} onSelect={select}
        />
      )}

      <aside className="panel left">
        <header>
          <div className="brand-mark">PCT</div>
          <div>
            <p className="eyebrow">Promethean CCaaS Toolbox</p>
            <h1>Environment 3D Explorer</h1>
          </div>
        </header>
        <p className="target"><span className={`status-dot${live ? " live" : ""}`} />{environment}</p>

        <div className="search">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a workstream, queue, agent…" aria-label="Search" />
          {results.length > 0 && (
            <ul className="results">
              {results.map((n) => (
                <li key={n.key}>
                  <button onClick={() => { select(n.key); setSearch(""); }}>
                    <span className="dot" style={{ background: KINDS[n.kind].color }} />
                    <span className="name">{n.name}</span>
                    <span className="relation">{KINDS[n.kind].label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ul className="legend">
          {KIND_ORDER.map((kind) => (
            <li key={kind}>
              <label className={hiddenKinds.has(kind) ? "off" : ""}>
                <input
                  type="checkbox" checked={!hiddenKinds.has(kind)}
                  onChange={() => setHiddenKinds((h) => { const next = new Set(h); if (next.has(kind)) next.delete(kind); else next.add(kind); return next; })}
                />
                <span className="dot" style={{ background: KINDS[kind].color }} />
                <span className="name">{KINDS[kind].plural}</span>
                <span className="count">{counts.get(kind) ?? 0}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="muted small">Front to back: how a conversation travels. Phone numbers are in front, skills at the back.</p>

        <div className="mode">
          <button className={mode === "orbit" ? "on" : ""} onClick={() => setMode("orbit")}>Orbit</button>
          <button className={mode === "walk" ? "on" : ""} onClick={() => setMode("walk")}>Walk</button>
          <button onClick={resetView}>Reset view</button>
        </div>
        <dl className="help">
          {mode === "orbit" ? (
            <><dt>Drag</dt><dd>rotate</dd><dt>Scroll</dt><dd>zoom</dd><dt>Right-drag</dt><dd>pan</dd></>
          ) : (
            <><dt>Drag</dt><dd>look around</dd></>
          )}
          <dt>W A S D</dt><dd>move (Shift: faster)</dd>
          <dt>E / Q</dt><dd>up / down</dd>
          <dt>Click</dt><dd>focus a record</dd>
          <dt>M</dt><dd>switch orbit / walk</dd>
          <dt>Esc</dt><dd>clear focus</dd>
        </dl>

        {graph && (
          <div className="views">
            <button className="wide" onClick={() => startRide()} disabled={!graph.nodes.length}>▶ Follow the call {selectedNode ? `from ${selectedNode.name}` : "from a phone number"}</button>
            <label className="toggle"><input type="checkbox" checked={sizeByConnections} onChange={(e) => setSizeByConnections(e.target.checked)} /> Size by connections</label>
            <div className="save-view">
              <input value={viewName} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveView(); }} placeholder={nextViewName(views)} aria-label="View name" />
              <button onClick={saveView}>Save view</button>
              <button onClick={screenshot} title="Download the current view as a PNG">Screenshot</button>
            </div>
            {views.length > 0 && (
              <ul className="view-list">
                {views.map((v) => (
                  <li key={v.name}>
                    <button className="name" onClick={() => flyTo(v.position, v.target)}>{v.name}</button>
                    <button className="remove" onClick={() => deleteView(v.name)} aria-label={`Delete view ${v.name}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {graph && (
          <div className="live">
            <label className="toggle">
              <input type="checkbox" checked={liveOn} onChange={(e) => setLiveOn(e.target.checked)} />
              <span>Live activity</span>
              {liveOn && <span className={`pulse${liveError ? " error" : ""}`} />}
            </label>
            {liveOn && (
              <>
                {activity ? (
                  <>
                    <p className="muted small">
                      Updated {new Date(activity.readAt).toLocaleTimeString()}, every {(isDataverseAvailable() ? LIVE_REFRESH_MS : DEMO_REFRESH_MS) / 1000} seconds.
                    </p>
                    <ul className="live-counts">
                      {(["waiting", "with-agent", "wrap-up"] as const).map((status) => (
                        <li key={status}><span className="dot" style={{ background: CONVERSATION_COLORS[status] }} />{activity.open.filter((c) => c.status === status).length} {CONVERSATION_LABELS[status]}</li>
                      ))}
                      <li className="muted">{[...activity.recent.entries()].filter(([k]) => k.startsWith("workstream:")).reduce((n, [, c]) => n + c, 0)} in the last 24 hours</li>
                    </ul>
                    <ul className="live-counts">
                      {(Object.keys(PRESENCE_LABELS) as Presence[]).map((p) => (
                        <li key={p}><span className="dot" style={{ background: PRESENCE_COLORS[p] }} />{presenceCounts.get(p) ?? 0} {PRESENCE_LABELS[p].toLowerCase()}</li>
                      ))}
                    </ul>
                  </>
                ) : !liveError && <p className="muted small">Reading live activity…</p>}
                {liveError && <p className="muted small error-text">Couldn't read live activity: {liveError}</p>}
              </>
            )}
          </div>
        )}

        {graph && (
          <div className="health">
            <label className="toggle">
              <input type="checkbox" checked={showHealth} onChange={(e) => setShowHealth(e.target.checked)} />
              <span>Show problems</span>
              <span className="badge problem" title="Problems">{problemCount}</span>
              <span className="badge warning" title="Warnings">{issues.length - problemCount}</span>
            </label>
            {showHealth && (
              <>
                <label className="toggle"><input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} /> Only records with an issue</label>
                {issues.length === 0 ? <p className="muted small">No problems found.</p> : (
                  <ul className="issue-list">
                    {issues.slice(0, MAX_ISSUES_LISTED).map((i) => (
                      <li key={`${i.key}:${i.check}`}>
                        <button onClick={() => select(i.key)}>
                          <span className="dot" style={{ background: SEVERITY_COLORS[i.severity] }} />
                          <span className="name">{nodeByKey.get(i.key)?.name}</span>
                          <span className="relation">{i.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {issues.length > MAX_ISSUES_LISTED && <p className="muted small">and {issues.length - MAX_ISSUES_LISTED} more</p>}
                {skipped.length > 0 && <p className="muted small">Not checked, because a table couldn't be read: {skipped.join("; ")}.</p>}
              </>
            )}
          </div>
        )}

        {graph && graph.warnings.length > 0 && (
          <div className="warnings">
            <button onClick={() => setShowWarnings((s) => !s)}>{graph.warnings.length} thing{graph.warnings.length === 1 ? "" : "s"} couldn't be read</button>
            {showWarnings && <ul>{graph.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </div>
        )}
        <button className="link" onClick={() => void load()} disabled={loading}>Read the environment again</button>
      </aside>

      {selectedNode && (
        <aside className="panel right">
          <div className="kind" style={{ color: KINDS[selectedNode.kind].color }}>{KINDS[selectedNode.kind].label}</div>
          <h2>{selectedNode.name}</h2>
          {selectedNode.details.length > 0 && (
            <dl className="details">
              {[...selectedNode.details, ...(activity ? liveDetails(selectedNode.key, activity) : [])].map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value || "—"}</dd></React.Fragment>)}
            </dl>
          )}
          {selectedIssues.map((i) => (
            <div key={i.check} className={`finding ${i.severity}`}>
              <strong>{SEVERITY_LABELS[i.severity]}: {i.title}</strong>
              <p>{i.detail}</p>
              <p className="fix">{i.fix}</p>
            </div>
          ))}
          <div className="actions">
            <label className="toggle"><input type="checkbox" checked={chainOnly} onChange={(e) => setChainOnly(e.target.checked)} /> Show only this chain</label>
            {openUrl && <a href={openUrl} target="_blank" rel="noreferrer">Open record ↗</a>}
            <button className="link" onClick={clear}>Clear focus</button>
          </div>
          <Connections title="In front (comes from)" edges={upstream} side="from" nodeByKey={nodeByKey} onSelect={select} />
          <Connections title="Behind (goes to)" edges={downstream} side="to" nodeByKey={nodeByKey} onSelect={select} />
        </aside>
      )}

      {ride && (
        <div className="ride">
          <div className="ride-route">
            {ride.path.map((k, i) => {
              const n = nodeByKey.get(k);
              return n ? (
                <React.Fragment key={k}>
                  {i > 0 && <span className="arrow">›</span>}
                  <span className="stop"><span className="dot" style={{ background: KINDS[n.kind].color }} />{n.name}</span>
                </React.Fragment>
              ) : null;
            })}
          </div>
          {ride.options.length > 0 ? (
            <div className="ride-choices">
              <span className="question">Where does the call go next?</span>
              {ride.options.slice(0, MAX_RIDE_CHOICES).map((o) => (
                <button key={o.key} onClick={() => choose(o)}>
                  <span className="dot" style={{ background: KINDS[o.kind].color }} />{o.name}<small>{o.relation}</small>
                </button>
              ))}
              {ride.options.length > MAX_RIDE_CHOICES && <span className="muted small">and {ride.options.length - MAX_RIDE_CHOICES} more</span>}
            </div>
          ) : (
            <div className="ride-choices"><span className="question">End of the line.</span></div>
          )}
          <div className="ride-controls">
            <button onClick={() => setRide((r) => (r ? { ...r, playing: !r.playing } : r))}>{ride.playing ? "❚❚ Pause" : "▶ Go on"}</button>
            <button onClick={() => startRide(ride.path[0])}>↺ Start again</button>
            <label className="toggle"><input type="checkbox" checked={ride.routeOnly} onChange={(e) => setRide((r) => (r ? { ...r, routeOnly: e.target.checked } : r))} /> Show only the route</label>
            <button onClick={stopRide} aria-label="Stop following the call">✕</button>
          </div>
        </div>
      )}

      {hoveredNode && hoveredNode.key !== selected && (
        <div className="hover-hint"><span className="dot" style={{ background: KINDS[hoveredNode.kind].color }} />{KINDS[hoveredNode.kind].label}: <strong>{hoveredNode.name}</strong>{hoveredIssue && <span style={{ color: SEVERITY_COLORS[hoveredIssue.severity] }}> · {hoveredIssue.title}</span>}</div>
      )}

      {(loading || error) && (
        <div className="overlay">
          {loading ? <p>Reading {environment}…</p> : (
            <div>
              <p>Couldn't read the environment: {error}</p>
              <button onClick={() => void load()}>Try again</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
