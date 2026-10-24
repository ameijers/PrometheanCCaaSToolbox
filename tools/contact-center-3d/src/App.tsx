// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { environmentLabel, isDataverseAvailable, recordUrl } from "../../shared/src/xrm";
import { loadGraph, loadLiveRows } from "../../environment-3d-explorer/src/dataverse";
import { demoRaw } from "../../environment-3d-explorer/src/demoData";
import { demoLiveSource } from "../../environment-3d-explorer/src/demoLive";
import { useFullscreen } from "../../environment-3d-explorer/src/fullscreen";
import { buildGraph } from "../../environment-3d-explorer/src/graph";
import { findIssues, SEVERITY_LABELS, worstByKey } from "../../environment-3d-explorer/src/health";
import { buildLive, CONVERSATION_COLORS, CONVERSATION_LABELS, Live, LiveRows, newArrivals, Presence, PRESENCE_COLORS, PRESENCE_LABELS, waitingByQueue } from "../../environment-3d-explorer/src/live";
import { EDGE_LABELS, Graph, GraphEdge, KINDS } from "../../environment-3d-explorer/src/model";
import { defaultRideStart, extendRide, RideOption } from "../../environment-3d-explorer/src/ride";
import { CameraGoal, Mode, Ride, SceneHandle } from "../../environment-3d-explorer/src/Scene";
import { readUrlOptions } from "../../environment-3d-explorer/src/urlOptions";
import { Caller, CampusScene, colorFor, SEVERITY_COLORS, Walker } from "./CampusScene";
import { Center, CENTER_COLORS, createCenter, deleteCenter, Grouping, moveWorkstream, recolor, reconcile, rename, setHidden } from "./centers";
import { buildPlan, UNROUTED_CENTER, Vec3, Wing, WING_COLORS, WING_LABELS, WING_ORDER } from "./floorplan";
import { browserStore } from "./store";

type Tab = "centers" | "explore" | "live" | "health" | "help";
const TABS: { id: Tab; label: string }[] = [
  { id: "centers", label: "Centers" }, { id: "explore", label: "Explore" }, { id: "live", label: "Live" }, { id: "health", label: "Health" }, { id: "help", label: "Help" }
];
const MAX_LISTED = 40;
const MAX_RIDE_CHOICES = 8;
const LIVE_REFRESH_MS = 15000, DEMO_REFRESH_MS = 5000, LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

// What each record is in the building, for the details panel.
const IN_THE_BUILDING: Record<string, string> = {
  phone: "Phone line", channel: "Entrance", bot: "Automated reception", workstream: "Counter at the front desk", rule: "Signpost",
  queue: "Room", agent: "Desk", hours: "Opening hours", overflow: "At the door", variable: "On the counter's clipboard", skill: "Badge on the desk", businessunit: "Carpet"
};

// Show / hide, as an eye (struck through when hidden).
function Eye({ off }: { off: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

const asked = (name: string) => {
  const params = new URLSearchParams(window.location.search);
  return params.get(name) ?? new URLSearchParams(params.get("data") ?? "").get(name);
};
const isOn = (v: string | null) => v !== null && !/^(0|false|no|off)$/i.test(v);

export function App(): React.ReactElement {
  // Inside Dataverse the tool reads the environment, unless you ask for the sample (button or ?demo=1),
  // which is handy to demonstrate or test. Outside Dataverse it's always the sample.
  const inDataverse = isDataverseAvailable();
  const [useSample, setUseSample] = useState(() => isOn(asked("demo")));
  const live = inDataverse && !useSample;
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
  const [showUnits, setShowUnits] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | undefined>(undefined);
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  // ?wing=voice (or messaging, records; floor= from before still works) shows one wing.
  const [wing, setWing] = useState<Wing | undefined>(() => WING_ORDER.find((k) => k === (asked("wing") ?? asked("floor"))));
  const [liveOn, setLiveOn] = useState(() => isOn(asked("live")));
  const [activity, setActivity] = useState<Live | undefined>(undefined);
  const [liveError, setLiveError] = useState("");
  const [walkers, setWalkers] = useState<Walker[]>([]);
  const [ride, setRide] = useState<{ id: number; path: string[]; options: RideOption[]; playing: boolean } | undefined>(undefined);
  const { fullscreen, error: fullscreenError, toggle: toggleFullscreen } = useFullscreen();
  const sceneHandle = useRef<SceneHandle | null>(null);
  const started = useRef(false);

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
  const switchSource = (sample: boolean) => { started.current = false; setGraph(undefined); setGrouping(undefined); setActivity(undefined); setRide(undefined); setUseSample(sample); };

  // Every change to the centers is remembered straight away.
  const change = (next: Grouping) => { setGrouping(next); void store.save(environment, next); };

  const plan = useMemo(() => (graph && grouping ? buildPlan(graph, grouping) : undefined), [graph, grouping]);
  const nodeByKey = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.key, n])), [graph]);
  const issues = useMemo(() => (graph ? findIssues(graph) : []), [graph]);
  const worst = useMemo(() => worstByKey(issues), [issues]);
  const problemCount = issues.filter((i) => i.severity === "problem").length;
  const hidden = useMemo(() => new Set(grouping?.hidden ?? []), [grouping]);

  // Live activity, read now and then every so often while it's on.
  const planRef = useRef(plan);
  planRef.current = plan;
  useEffect(() => {
    if (!liveOn || !graph) { setActivity(undefined); setWalkers([]); return; }
    let cancelled = false;
    let previous: Live | undefined;
    const demo = live ? undefined : demoLiveSource(graph);
    const readRows = (since: string): Promise<LiveRows> => (demo ? Promise.resolve(demo(since)) : loadLiveRows(graph, since));
    const read = async () => {
      try {
        const next = buildLive(graph, await readRows(new Date(Date.now() - LIVE_WINDOW_MS).toISOString()), new Date().toISOString());
        if (cancelled) return;
        // New callers walk in: from their way in, past the front desk, to the room's door.
        const p = planRef.current;
        const arriving = newArrivals(previous, next).flatMap((c): Walker[] => {
          const from = c.workstreamKey ? p?.entrances.get(c.workstreamKey) : undefined;
          const counter = c.workstreamKey ? p?.anchors.get(c.workstreamKey) : undefined;
          const room = c.queueKey ? p?.chairs.get(c.queueKey)?.[0] : undefined;
          return from && counter && room ? [{ id: `${c.id}:${next.readAt}`, color: CONVERSATION_COLORS.waiting, points: [from, [counter[0], 0, counter[2] + 2], [room[0], 0, room[2] + 3], room] }] : [];
        });
        previous = next;
        setActivity(next);
        setWalkers(arriving);
        setLiveError("");
      } catch (e) {
        if (!cancelled) setLiveError(e instanceof Error ? e.message : String(e));
      }
    };
    void read();
    const timer = setInterval(() => void read(), demo ? DEMO_REFRESH_MS : LIVE_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [liveOn, graph, live]);

  // What live activity looks like in the building.
  const screens = useMemo(() => (activity ? new Map([...activity.presence.entries()].map(([k, p]) => [k, PRESENCE_COLORS[p.presence]])) : undefined), [activity]);
  const waiting = useMemo(() => (activity ? waitingByQueue(activity) : new Map<string, number>()), [activity]);
  const labelSuffix = useMemo(() => (activity ? new Map([...waiting.entries()].map(([k, n]) => [k, `${n} waiting`])) : undefined), [activity, waiting]);
  // The room an agent's desk is in (a caller with that agent shows with that room's wing).
  const homeRoom = (agentKey: string) => plan?.areas.find((a) => a.kind === "room" && plan.fixtures.some((f) => f.key === agentKey && f.kind === "desk" && Math.abs(f.x - a.x) <= a.w / 2 && Math.abs(f.z - a.z) <= a.d / 2))?.key;
  const callers = useMemo((): Caller[] | undefined => {
    if (!activity || !plan) return undefined;
    const seated = new Map<string, number>();
    return activity.open.flatMap((c): Caller[] => {
      if (c.status === "waiting" && c.queueKey) {
        const chairs = plan.chairs.get(c.queueKey);
        if (!chairs) return [];
        const n = seated.get(c.queueKey) ?? 0;
        seated.set(c.queueKey, n + 1);
        // Four chairs; anyone after that stands in line at the door.
        const at: Vec3 = n < chairs.length ? chairs[n] : [chairs[0][0] + (n - chairs.length) * 0.8 - 1.5, 0, chairs[0][2] + 2.2];
        return [{ key: c.queueKey, at, color: CONVERSATION_COLORS.waiting, standing: n >= chairs.length }];
      }
      if (c.status === "with-agent" && c.agentKey) {
        const desk = plan.fixtures.find((f) => f.kind === "desk" && f.key === c.agentKey);
        return desk ? [{ key: homeRoom(c.agentKey) ?? "", at: [desk.x, 0, desk.z - 1.1], color: CONVERSATION_COLORS["with-agent"], standing: true }] : [];
      }
      return [];
    });
  }, [activity, plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const presenceCounts = useMemo(() => {
    const counts = new Map<Presence, number>();
    activity?.presence.forEach((p) => counts.set(p.presence, (counts.get(p.presence) ?? 0) + 1));
    return counts;
  }, [activity]);

  // Follow the call: walking along the route from the entrance to a desk.
  const startRide = (from?: string) => {
    if (!graph || !plan) return;
    const start = from ?? selected ?? defaultRideStart(graph);
    if (!start || !plan.anchors.has(start)) return;
    setRide({ id: Date.now(), ...shownRide(extendRide(graph, [start])), playing: true });
  };
  const shownRide = (r: { path: string[]; options: RideOption[] }) => ({ path: r.path.filter((k) => plan?.anchors.has(k)), options: r.options.filter((o) => plan?.anchors.has(o.key)) });
  const choose = (o: RideOption) => { if (graph) setRide((r) => (r ? { ...r, ...shownRide(extendRide(graph, [...r.path, o.key])), playing: true } : r)); };
  const sceneRide = useMemo<Ride | undefined>(() => (ride && plan ? { id: ride.id, playing: ride.playing, points: ride.path.map((k) => plan.anchors.get(k)).filter((p): p is Vec3 => !!p).map((p) => [p[0], 1.2, p[2]] as Vec3) } : undefined), [ride, plan]);

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

  // Start above the whole campus, or at the center or record in ?focus=<name>; ?ride=1 follows a call from there.
  useEffect(() => {
    if (!plan || !grouping || !graph || started.current) return;
    started.current = true;
    const wanted = (readUrlOptions(window.location.search).focus ?? "").toLowerCase();
    const center = wanted ? grouping.centers.find((c) => c.name.toLowerCase().includes(wanted)) : undefined;
    const record = wanted && !center ? graph.nodes.find((n) => plan.anchors.has(n.key) && n.name.toLowerCase() === wanted) ?? graph.nodes.find((n) => plan.anchors.has(n.key) && n.name.toLowerCase().includes(wanted)) : undefined;
    if (center) select(`center:${center.id}`); else if (record) select(record.key); else overview();
    if (isOn(asked("ride"))) { setTab("explore"); startRide(record?.key); }
  }, [plan, overview]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") { setSelected(undefined); setRide(undefined); }
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
  const selectedCenter: Center | undefined = selected?.startsWith("center:")
    ? grouping.centers.find((c) => `center:${c.id}` === selected) ?? (selected === `center:${UNROUTED_CENTER}` ? { id: UNROUTED_CENTER, name: "Not routed", color: "#64748b", workstreams: [] } : undefined)
    : undefined;
  const focusCenter = selected ? centerOfKey(selected) : undefined;
  const openUrl = live && selectedNode?.recordId && KINDS[selectedNode.kind].table ? recordUrl(KINDS[selectedNode.kind].table!, selectedNode.recordId) : undefined;
  const linked = (edges: GraphEdge[], side: "from" | "to") => edges.map((e) => ({ e, n: nodeByKey.get(e[side]) })).filter((x) => x.n);
  const upstream = selectedNode ? linked(graph.edges.filter((e) => e.to === selectedNode.key), "from") : [];
  const downstream = selectedNode ? linked(graph.edges.filter((e) => e.from === selectedNode.key), "to") : [];
  const workstreamName = (id: string) => nodeByKey.get(`workstream:${id}`)?.name ?? id;
  const ownCenters = grouping.centers.filter((c) => c.custom);
  const loose = grouping.centers.filter((c) => !c.custom);

  // A workstream row: drag it onto a center, or pick one from Move to.
  const workstreamRow = (id: string, inCenter: Center) => (
    <li key={id} className={`${hidden.has(id) ? "hidden" : ""} draggable`} draggable onDragStart={(e) => { setDragging(id); e.dataTransfer.setData("text/plain", id); }} onDragEnd={() => setDragging(undefined)}>
      <span className="grip" aria-hidden="true">⠿</span>
      <button className="eye" onClick={() => change(setHidden(grouping, id, !hidden.has(id)))} title={hidden.has(id) ? "Show" : "Hide"} aria-label={`${hidden.has(id) ? "Show" : "Hide"} ${workstreamName(id)}`}><Eye off={hidden.has(id)} /></button>
      <button className="name link-like" onClick={() => select(`workstream:${id}`)}>{workstreamName(id)}</button>
      <select value="" onChange={(e) => change(moveWorkstream(grouping, id, e.target.value, graph))} aria-label={`Move ${workstreamName(id)}`}>
        <option value="">Move to…</option>
        {ownCenters.filter((c) => c.id !== inCenter.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        {inCenter.custom && <option value="own">Out of this center</option>}
      </select>
    </li>
  );
  const dropOn = (centerId: string) => ({
    onDragOver: (e: React.DragEvent) => { if (dragging) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain") || dragging; if (id) change(moveWorkstream(grouping, id, centerId, graph)); setDragging(undefined); }
  });

  return (
    <div className="campus">
      <CampusScene plan={plan} mode={mode} goal={goal} selected={selected} focusCenter={focusCenter} wing={wing} showUnits={showUnits}
        issues={showHealth ? worst : undefined} screens={screens} callers={callers} walkers={walkers} labelSuffix={labelSuffix} ride={sceneRide} handle={sceneHandle} onSelect={select} />

      <aside className="panel left">
        <header>
          <div className="brand-mark">PCT</div>
          <div>
            <p className="eyebrow">Promethean CCaaS Toolbox</p>
            <h1>3D Contact Center</h1>
          </div>
        </header>
        <p className="target">
          <span className={`status-dot${live ? " live" : ""}`} />{environment}
          {inDataverse && <button className="link source" onClick={() => switchSource(live)}>{live ? "Use sample data" : "Back to live data"}</button>}
        </p>

        <div className="search">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a room, desk, counter…" aria-label="Search" />
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
        <div className="floors" role="group" aria-label="Wings">
          <span>Wings</span>
          <button className={!wing ? "on" : ""} onClick={() => setWing(undefined)}>All</button>
          {WING_ORDER.map((k) => <button key={k} className={wing === k ? "on" : ""} onClick={() => setWing(k)} style={wing === k ? { background: WING_COLORS[k], borderColor: WING_COLORS[k] } : undefined}>{WING_LABELS[k]}</button>)}
        </div>

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "live" && liveOn && <span className={`pulse${liveError ? " error" : ""}`} />}
              {t.id === "health" && problemCount > 0 && <span className="badge problem">{problemCount}</span>}
            </button>
          ))}
        </nav>

        <div className="tab-body" role="tabpanel">
          {tab === "centers" && (
            <>
              <div className="combine">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { change(createCenter(grouping, newName)); setNewName(""); } }} placeholder="Name of a new customer center" aria-label="Name of a new customer center" />
                <button disabled={!newName.trim()} onClick={() => { change(createCenter(grouping, newName)); setNewName(""); }}>Create</button>
              </div>

              {ownCenters.length > 0 && <h3>Customer centers</h3>}
              <ul className="center-list">
                {ownCenters.map((c) => (
                  <li key={c.id} className={`${c.workstreams.length && c.workstreams.every((id) => hidden.has(id)) ? "all-hidden" : ""}${dragging ? " drop-target" : ""}`} {...dropOn(c.id)}>
                    <div className="center-row">
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
                        <button className="name link-like" onClick={() => c.workstreams.length && select(`center:${c.id}`)} onDoubleClick={() => setRenaming({ id: c.id, name: c.name })} title="Click to go there, double-click to rename">{c.name}</button>
                      )}
                      <button className="small" onClick={() => setRenaming({ id: c.id, name: c.name })} title="Rename">✎</button>
                      <button className="small" onClick={() => change(deleteCenter(grouping, c.id, graph))} title="Delete this center (its workstreams stay)">×</button>
                    </div>
                    <ul className="ws-list">
                      {c.workstreams.map((id) => workstreamRow(id, c))}
                      {!c.workstreams.length && <li className="muted small empty">Drag workstreams here, or use Move to…</li>}
                    </ul>
                  </li>
                ))}
              </ul>

              <h3>Workstreams not in a customer center</h3>
              <p className="muted small">Each stands as a building of its own. Hide what you don't need with the eye; workstreams linked to nothing start hidden. {store.where}.</p>
              <ul className="ws-list loose">
                {loose.flatMap((c) => c.workstreams.map((id) => workstreamRow(id, c)))}
              </ul>
              {hidden.size > 0 && <button className="link" onClick={() => change({ ...grouping, hidden: [] })}>Show all {hidden.size} hidden workstream{hidden.size === 1 ? "" : "s"}</button>}
              <button className="link" onClick={() => change(reconcile(undefined, graph))}>Start again: no customer centers</button>
            </>
          )}

          {tab === "explore" && (
            <div className="views">
              <button className="wide" onClick={() => startRide()}>▶ Follow a call {selectedNode && plan.anchors.has(selectedNode.key) ? `from ${selectedNode.name}` : "from a phone number"}</button>
              <p className="muted small">Walks the route a call takes: through the entrance, past the front desk and the signposts, into a room, to a desk. At a fork you choose where it goes.</p>
              <label className="toggle"><input type="checkbox" checked={showUnits} onChange={(e) => setShowUnits(e.target.checked)} /> Business units as carpet under the desks</label>
              <p className="muted small">Desks carry small badges for their agent's skills; a counter with a clipboard has context variables.</p>
            </div>
          )}

          {tab === "live" && (
            <div className="live">
              <label className="toggle">
                <input type="checkbox" checked={liveOn} onChange={(e) => setLiveOn(e.target.checked)} />
                <span>Live activity</span>
                {liveOn && <span className={`pulse${liveError ? " error" : ""}`} />}
              </label>
              {liveOn && (activity ? (
                <>
                  <p className="muted small">Updated {new Date(activity.readAt).toLocaleTimeString()}, every {(live ? LIVE_REFRESH_MS : DEMO_REFRESH_MS) / 1000} seconds. Waiting callers sit by a room's door, callers with an agent stand at the desk, new ones walk in. Desk screens show the agent's presence.</p>
                  <ul className="live-counts">
                    {(["waiting", "with-agent", "wrap-up"] as const).map((s) => <li key={s}><span className="dot" style={{ background: CONVERSATION_COLORS[s] }} />{activity.open.filter((c) => c.status === s).length} {CONVERSATION_LABELS[s]}</li>)}
                  </ul>
                  <ul className="live-counts">
                    {(Object.keys(PRESENCE_LABELS) as Presence[]).map((p) => <li key={p}><span className="dot" style={{ background: PRESENCE_COLORS[p] }} />{presenceCounts.get(p) ?? 0} {PRESENCE_LABELS[p].toLowerCase()}</li>)}
                  </ul>
                </>
              ) : !liveError && <p className="muted small">Reading live activity…</p>)}
              {liveError && <p className="muted small error-text">Couldn't read live activity: {liveError}</p>}
            </div>
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
                <dt>Esc</dt><dd>clear the selection, stop following</dd>
              </dl>
              <p className="muted small">Entrance doors are voice channels, with their phone numbers above them; the screen is the digital channels. The front desk has a counter per workstream (with the bot's kiosk in front of it). Signposts are routing rules; the red lines lead to their rooms. Behind the corridor, a wing per kind of work: phone, chat & messaging, email & records. Rooms are queues, desks are agents. Outside a room's door: a mailbox for voicemail, a phone booth for a callback, an exit for ending the conversation, a purple door for a transfer. Blue skybridges go to a room in another center.</p>
              {graph.warnings.length > 0 && <ul className="warnings-list">{graph.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              <button className="link" onClick={() => void load()} disabled={loading}>Read the environment again</button>
            </>
          )}
        </div>
      </aside>

      {(selectedNode || selectedCenter) && !ride && (
        <aside className="panel right">
          {selectedCenter ? (
            <>
              <div className="kind" style={{ color: selectedCenter.color }}>Customer center</div>
              <h2>{selectedCenter.name}</h2>
              <dl className="details">
                <dt>Workstreams</dt><dd>{selectedCenter.workstreams.length}</dd>
                <dt>Wings</dt><dd>{plan.buildings.find((b) => b.centerId === selectedCenter.id)?.wings.map((w) => WING_LABELS[w.kind]).join(", ") || "—"}</dd>
                <dt>Rooms</dt><dd>{plan.areas.filter((a) => a.kind === "room" && a.centerId === selectedCenter.id).length}</dd>
                <dt>Desks</dt><dd>{plan.fixtures.filter((f) => f.kind === "desk" && centerOfKey(f.key ?? "") === selectedCenter.id).length}</dd>
              </dl>
              <ul className="link-list">
                {selectedCenter.workstreams.map((id) => <li key={id}><button onClick={() => select(`workstream:${id}`)}>{workstreamName(id)}<small>counter</small></button></li>)}
              </ul>
            </>
          ) : selectedNode && (
            <>
              <div className="kind" style={{ color: KINDS[selectedNode.kind].color }}>{IN_THE_BUILDING[selectedNode.kind] ?? KINDS[selectedNode.kind].label} · {KINDS[selectedNode.kind].label}</div>
              <h2>{selectedNode.name}</h2>
              <dl className="details">
                {selectedNode.details.map(([l, v]) => <React.Fragment key={l}><dt>{l}</dt><dd>{v || "—"}</dd></React.Fragment>)}
                {selectedNode.kind === "queue" && (plan.elsewhere.get(selectedNode.key) ?? 0) > 0 && <><dt>Desk in another room</dt><dd>{plan.elsewhere.get(selectedNode.key)}</dd></>}
                {activity && selectedNode.kind === "queue" && <><dt>Waiting now</dt><dd>{waiting.get(selectedNode.key) ?? 0}</dd></>}
                {activity && selectedNode.kind === "agent" && <><dt>Presence</dt><dd>{activity.presence.get(selectedNode.key)?.name ?? "Unknown"}</dd></>}
              </dl>
              {selectedNode.kind === "agent" && (
                <p className="badges">{graph.edges.filter((e) => e.from === selectedNode.key && e.kind === "skill").map((e) => {
                  const skill = nodeByKey.get(e.to)?.name ?? "";
                  return <span key={e.to} className="skill-badge" style={{ background: colorFor(skill) }}>{skill}{e.label ? ` · ${e.label}` : ""}</span>;
                })}</p>
              )}
              {issues.filter((i) => i.key === selectedNode.key).map((i) => (
                <div key={i.check} className={`finding ${i.severity}`}><strong>{SEVERITY_LABELS[i.severity]}: {i.title}</strong><p>{i.detail}</p><p className="fix">{i.fix}</p></div>
              ))}
              <div className="actions">
                {plan.anchors.has(selectedNode.key) && <button className="link" onClick={() => { setTab("explore"); startRide(selectedNode.key); }}>Follow a call from here</button>}
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

      {ride && (
        <div className="ride">
          <div className="ride-route">
            {ride.path.map((k, i) => {
              const n = nodeByKey.get(k);
              return n ? <React.Fragment key={k}>{i > 0 && <span className="arrow">›</span>}<span className="stop"><span className="dot" style={{ background: KINDS[n.kind].color }} />{n.name}</span></React.Fragment> : null;
            })}
          </div>
          <div className="ride-choices">
            {ride.options.length > 0 ? <>
              <span className="question">Where does the call go next?</span>
              {ride.options.slice(0, MAX_RIDE_CHOICES).map((o) => <button key={o.key} onClick={() => choose(o)}><span className="dot" style={{ background: KINDS[o.kind].color }} />{o.name}<small>{o.relation}</small></button>)}
              {ride.options.length > MAX_RIDE_CHOICES && <span className="muted small">and {ride.options.length - MAX_RIDE_CHOICES} more</span>}
            </> : <span className="question">At the desk: end of the line.</span>}
          </div>
          <div className="ride-controls">
            <button onClick={() => setRide((r) => (r ? { ...r, playing: !r.playing } : r))}>{ride.playing ? "❚❚ Pause" : "▶ Go on"}</button>
            <button onClick={() => startRide(ride.path[0])}>↺ Start again</button>
            <button onClick={() => setRide(undefined)} aria-label="Stop following the call">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
