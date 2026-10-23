// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { environmentLabel, isDataverseAvailable, recordUrl } from "../../shared/src/xrm";
import { loadGraph } from "./dataverse";
import { demoRaw } from "./demoData";
import { buildGraph, chainOf } from "./graph";
import { findIssues, SEVERITY_LABELS, worstByKey } from "./health";
import { computeLayout, connectionScales } from "./layout";
import { EDGE_LABELS, Graph, GraphEdge, GraphNode, KIND_ORDER, KINDS, NodeKind } from "./model";
import { CameraGoal, Mode, SEVERITY_COLORS, START_POSITION, Scene, SceneHandle } from "./Scene";
import { buildTour, TourStop, tourCaption } from "./tour";
import { readUrlOptions } from "./urlOptions";
import { loadViews, nextViewName, SavedView, storeViews } from "./views";

// How long the fly-through stays at each layer.
const TOUR_STOP_MS = 4500;

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
  const [hiddenKinds, setHiddenKinds] = useState<Set<NodeKind>>(new Set());
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
  const [tour, setTour] = useState<{ stops: TourStop[]; index: number; playing: boolean } | undefined>(undefined);
  const [views, setViews] = useState<SavedView[]>(() => loadViews(environment));
  const [viewName, setViewName] = useState("");
  const sceneHandle = useRef<SceneHandle | null>(null);

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
  const nodeByKey = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.key, n])), [graph]);
  const scales = useMemo(() => (graph && sizeByConnections ? connectionScales(graph) : undefined), [graph, sizeByConnections]);
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

  const visibleNodes = useMemo(
    () => (graph?.nodes ?? []).filter((n) => !hiddenKinds.has(n.kind) && (!chainOnly || !lit || lit.has(n.key)) && (!showHealth || !problemsOnly || issueContext.has(n.key))),
    [graph, hiddenKinds, chainOnly, lit, showHealth, problemsOnly, issueContext]
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

  // The fly-through: the focused chain, or everything that's shown.
  const startTour = () => {
    const stops = buildTour(visibleNodes, positions, lit);
    if (!stops.length) return;
    setMode("orbit");
    setTour({ stops, index: 0, playing: true });
  };
  const stopTour = useCallback(() => setTour(undefined), []);
  // ?tour=1 starts the fly-through once the environment is read (and focused, with ?focus=).
  const tourStarted = useRef(false);
  useEffect(() => {
    if (tourStarted.current || !urlOptions.tour || !graph || (urlOptions.focus && !lit)) return;
    tourStarted.current = true;
    startTour();
  }, [graph, lit]); // eslint-disable-line react-hooks/exhaustive-deps
  const stepTour = (by: number) => setTour((t) => (t ? { ...t, index: Math.max(0, Math.min(t.stops.length - 1, t.index + by)), playing: false } : t));
  useEffect(() => {
    const stop = tour?.stops[tour.index];
    if (stop) flyTo(stop.position, stop.target);
  }, [tour?.stops, tour?.index]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tour?.playing) return;
    const timer = setTimeout(() => setTour((t) => (t ? (t.index + 1 < t.stops.length ? { ...t, index: t.index + 1 } : { ...t, playing: false }) : t)), TOUR_STOP_MS);
    return () => clearTimeout(timer);
  }, [tour]);

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
      if (e.key === "Escape") { clear(); stopTour(); }
      if (e.key === "m" || e.key === "M") { setMode((m) => (m === "orbit" ? "walk" : "orbit")); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [clear, stopTour]);

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
          nodes={visibleNodes} edges={visibleEdges} positions={positions} lit={lit}
          selected={selected} hovered={hovered} mode={mode} goal={goal} issues={showHealth ? worst : undefined}
          scales={scales} handle={sceneHandle} onHover={setHovered} onSelect={select}
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
            <button className="wide" onClick={startTour} disabled={!visibleNodes.length}>▶ Fly through {selected ? "this chain" : "the environment"}</button>
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
              {selectedNode.details.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value || "—"}</dd></React.Fragment>)}
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

      {tour && (
        <div className="tour">
          <span className="step">{tour.index + 1} / {tour.stops.length}</span>
          <span className="caption"><span className="dot" style={{ background: KINDS[tour.stops[tour.index].kind].color }} />{tourCaption(tour.stops[tour.index])}</span>
          <button onClick={() => stepTour(-1)} disabled={tour.index === 0} aria-label="Previous stop">◀</button>
          <button onClick={() => setTour((t) => (t ? { ...t, playing: !t.playing, index: !t.playing && t.index + 1 >= t.stops.length ? 0 : t.index } : t))} aria-label={tour.playing ? "Pause" : "Play"}>{tour.playing ? "❚❚" : "▶"}</button>
          <button onClick={() => stepTour(1)} disabled={tour.index + 1 >= tour.stops.length} aria-label="Next stop">▶▶</button>
          <button onClick={stopTour} aria-label="Stop the fly-through">✕</button>
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
