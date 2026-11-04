// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { environmentLabel, isDataverseAvailable, recordUrl } from "../../shared/src/xrm";
import { loadGraph, loadLiveRows } from "../../environment-3d-explorer/src/dataverse";
import { demoRaw } from "../../environment-3d-explorer/src/demoData";
import { demoLiveSource } from "../../environment-3d-explorer/src/demoLive";
import { useFullscreen } from "../../environment-3d-explorer/src/fullscreen";
import { buildLive, CONVERSATION_COLORS, CONVERSATION_LABELS, Live, LiveRows, liveDetails, newArrivals, Presence, PRESENCE_COLORS, PRESENCE_LABELS, waitingByQueue } from "../../environment-3d-explorer/src/live";
import { buildGraph, chainOf } from "../../environment-3d-explorer/src/graph";
import { findIssues, SEVERITY_LABELS, worstByKey } from "../../environment-3d-explorer/src/health";
import { EDGE_LABELS, Graph, GraphEdge, GraphNode, KIND_ORDER, KINDS, NodeKind } from "../../environment-3d-explorer/src/model";
import { defaultRideStart, extendRide, RideOption } from "../../environment-3d-explorer/src/ride";
import { plannedRide, tourAsked, TourBar, TourStep, useTour } from "../../environment-3d-explorer/src/tour";
import { readUrlOptions } from "../../environment-3d-explorer/src/urlOptions";
import { browserStore } from "../../contact-center-3d/src/store";
import { createCenter, Grouping, moveWorkstream, reconcile } from "../../contact-center-3d/src/centers";
import { CenterPicker, CentersTab } from "./Centers";
import { Arrival, DiagramHandle, DiagramView, LiveMarks, SEVERITY_COLORS } from "./Diagram";
import { center, computeDiagram, Diagram, Point, routePoints } from "./layout";
import { loadViews, SavedView, storeViews } from "./views";

const LIVE_REFRESH_MS = 15000;
const DEMO_REFRESH_MS = 5000;
const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_RIDE_CHOICES = 8;
const MAX_ISSUES_LISTED = 60;
const MAX_CONNECTIONS = 40;

type Tab = "centers" | "shapes" | "explore" | "live" | "health" | "help";
const TABS: { id: Tab; label: string }[] = [
  { id: "centers", label: "Centers" }, { id: "shapes", label: "Shapes" }, { id: "explore", label: "Explore" }, { id: "live", label: "Live" }, { id: "health", label: "Health" }, { id: "help", label: "Help" }
];
// The address's tab names from the 3D Explorer still work ("layers" is "shapes" here).
const TAB_ALIASES: Record<string, Tab> = { layers: "shapes" };

// Workstreams and queues carry the diagram's structure, so they can't be switched off.
const ALWAYS_SHOWN: NodeKind[] = ["workstream", "queue"];
const firstHidden = () => new Set(KIND_ORDER.filter((k) => KINDS[k].hiddenAtFirst));

const SKIPPED_CHECKS: Record<string, string> = {
  phoneNumbers: "voice channels without a number",
  channels: "voice workstreams without a channel, and unused numbers",
  resources: "agents without a bookable resource",
  skills: ""
};

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

function download(href: string, name: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// A new call's way in: along the line from its workstream's rule (or default) into the queue, else straight.
function arrivalPoints(diagram: Diagram, workstreamKey: string | undefined, queueKey: string | undefined): Point[] | undefined {
  const queueShape = queueKey ? diagram.shapeById.get(`q|${queueKey}`) : undefined;
  const wsShape = workstreamKey ? diagram.shapeById.get(`ws|${workstreamKey}`) : undefined;
  if (!queueShape) return undefined;
  const line = diagram.connectors.find((c) => c.toShape === queueShape.id && (c.fromShape === wsShape?.id || diagram.shapeById.get(c.fromShape)?.parent === wsShape?.id));
  if (line) return line.points;
  return wsShape ? [center(wsShape), center(queueShape)] : undefined;
}

export function App(): React.ReactElement {
  const inDataverse = isDataverseAvailable();
  const [useSample, setUseSample] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const asked = params.get("demo") ?? new URLSearchParams(params.get("data") ?? "").get("demo");
    return (asked !== null && !/^(0|false|no|off)$/i.test(asked)) || tourAsked();
  });
  const live = inDataverse && !useSample;
  const environment = live ? environmentLabel() : "the sample environment";
  const urlOptions = useMemo(() => readUrlOptions(window.location.search), []);

  const [graph, setGraph] = useState<Graph | undefined>(undefined);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hiddenKinds, setHiddenKinds] = useState<Set<NodeKind>>(firstHidden);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const [chainOnly, setChainOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [showWarnings, setShowWarnings] = useState(false);
  const [showHealth, setShowHealth] = useState(urlOptions.health);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [ride, setRide] = useState<{ id: number; path: string[]; options: RideOption[]; playing: boolean; routeOnly: boolean } | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(() => {
    const asked = urlOptions.tab ? TAB_ALIASES[urlOptions.tab] ?? urlOptions.tab : undefined;
    return TABS.find((t) => t.id === asked)?.id ?? (urlOptions.health ? "health" : urlOptions.live ? "live" : urlOptions.ride ? "explore" : "centers");
  });
  const [spacing, setSpacing] = useState(urlOptions.depth ?? 1);
  const { fullscreen, error: fullscreenError, toggle: toggleFullscreen } = useFullscreen();
  const [liveOn, setLiveOn] = useState(urlOptions.live);
  const [activity, setActivity] = useState<Live | undefined>(undefined);
  const [liveError, setLiveError] = useState("");
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [groupCenters, setGroupCenters] = useState(true);
  // As in 3D Contact Center: queues nothing routes to are left out unless asked for (?unrouted=1).
  const [showUnrouted, setShowUnrouted] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("unrouted") ?? new URLSearchParams(params.get("data") ?? "").get("unrouted");
    return v !== null && !/^(0|false|no|off)$/i.test(v);
  });
  const [grouping, setGrouping] = useState<Grouping | undefined>(undefined);
  const store = useMemo(() => browserStore(), []);
  const [views, setViews] = useState<SavedView[]>(() => loadViews(environment));
  useEffect(() => { setViews(loadViews(environment)); }, [environment]);
  const [viewName, setViewName] = useState("");
  const [exportError, setExportError] = useState("");
  const handle = useRef<DiagramHandle | null>(null);

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

  // Customer centers: the same grouping (and saved data) as 3D Contact Center's, made in either tool.
  useEffect(() => {
    if (!graph) return;
    let cancelled = false;
    void store.load(environment).then((saved) => { if (!cancelled) setGrouping(reconcile(saved, graph)); });
    return () => { cancelled = true; };
  }, [graph, environment, store]);
  const changeGrouping = (next: Grouping) => { setGrouping(next); void store.save(environment, next); };
  const customCenters = (grouping?.centers ?? []).filter((c) => c.custom).length;

  const nodeByKey = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.key, n])), [graph]);
  const lit = useMemo(() => (graph && selected ? chainOf(graph, selected) : undefined), [graph, selected]);
  const issues = useMemo(() => (graph ? findIssues(graph) : []), [graph]);
  const worst = useMemo(() => worstByKey(issues), [issues]);
  const issueContext = useMemo(() => {
    const keys = new Set(worst.keys());
    (graph?.edges ?? []).forEach((e) => { if (worst.has(e.from)) keys.add(e.to); if (worst.has(e.to)) keys.add(e.from); });
    return keys;
  }, [graph, worst]);
  const problemCount = issues.filter((i) => i.severity === "problem").length;
  const skipped = (graph?.unread ?? []).map((u) => SKIPPED_CHECKS[u]).filter(Boolean);
  const rideKeys = useMemo(() => (ride ? new Set([...ride.path, ...ride.options.map((o) => o.key)]) : undefined), [ride]);

  // Left out, as in 3D Contact Center: workstreams hidden with the eye (with their bot, rules and the
  // channels and numbers that only lead there), and queues nothing routes to unless asked for.
  const leftOut = useMemo(() => {
    const out = new Set<string>();
    if (!graph) return out;
    const into = (key: string, kind: string) => graph.edges.filter((e) => e.to === key && e.kind === kind).map((e) => e.from);
    (grouping?.hidden ?? []).forEach((id) => {
      const ws = "workstream:" + id;
      out.add(ws);
      graph.edges.filter((e) => e.from === ws && (e.kind === "variable" || (e.kind === "routes" && e.to.startsWith("rule:")))).forEach((e) => out.add(e.to));
      const bots = into(ws, "handoff");
      bots.forEach((b) => out.add(b));
      [...into(ws, "channel"), ...bots.flatMap((b) => into(b, "bot"))].forEach((c) => {
        out.add(c);
        into(c, "number").forEach((p) => { if (graph.edges.filter((e) => e.from === p && e.kind === "number").every((e) => out.has(e.to))) out.add(p); });
      });
    });
    if (!showUnrouted) {
      graph.nodes.filter((n) => n.kind === "queue" && !graph.edges.some((e) => e.to === n.key && (e.kind === "routes" || e.kind === "default" || e.kind === "transfer" || e.kind === "outbound"))).forEach((q) => out.add(q.key));
    }
    return out;
  }, [graph, grouping, showUnrouted]);

  // What's drawn: the filters change the layout itself, so the diagram closes up around what's left.
  const visible = useMemo(() => {
    const filter = rideKeys && ride?.routeOnly ? (k: string) => rideKeys.has(k)
      : chainOnly && lit ? (k: string) => lit.has(k)
      : showHealth && problemsOnly ? (k: string) => issueContext.has(k)
      : undefined;
    if (!leftOut.size) return filter;
    return (k: string) => !leftOut.has(k) && (!filter || filter(k));
  }, [rideKeys, ride?.routeOnly, chainOnly, lit, showHealth, problemsOnly, issueContext, leftOut]);
  const diagram = useMemo(
    () => (graph ? computeDiagram(graph, { hidden: hiddenKinds, visible, spacing, centers: groupCenters ? grouping?.centers : undefined }) : undefined),
    [graph, hiddenKinds, visible, spacing, groupCenters, grouping]
  );

  // Live activity, read now and every so often while it's on.
  const diagramRef = useRef(diagram);
  diagramRef.current = diagram;
  useEffect(() => {
    if (!liveOn || !graph) { setActivity(undefined); setArrivals([]); return; }
    let cancelled = false;
    let previous: Live | undefined;
    const demo = !live ? demoLiveSource(graph) : undefined;
    const readRows = (since: string): Promise<LiveRows> => (demo ? Promise.resolve(demo(since)) : loadLiveRows(graph, since));
    const read = async () => {
      try {
        const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
        const next = buildLive(graph, await readRows(since), new Date().toISOString());
        if (cancelled) return;
        const d = diagramRef.current;
        const arriving = d ? newArrivals(previous, next)
          .map((c) => ({ id: `${c.id}:${next.readAt}`, points: arrivalPoints(d, c.workstreamKey, c.queueKey) }))
          .filter((a): a is Arrival => !!a.points) : [];
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
  }, [liveOn, graph, live]);

  const liveMarks = useMemo<LiveMarks | undefined>(() => {
    if (!activity) return undefined;
    const handling = new Map<string, number>();
    const open = new Map<string, number>();
    activity.open.forEach((c) => {
      if (c.agentKey && c.status !== "waiting") handling.set(c.agentKey, (handling.get(c.agentKey) ?? 0) + 1);
      if (c.workstreamKey) open.set(c.workstreamKey, (open.get(c.workstreamKey) ?? 0) + 1);
    });
    return {
      presence: new Map([...activity.presence.entries()].map(([k, p]) => [k, PRESENCE_COLORS[p.presence]])),
      presenceName: new Map([...activity.presence.entries()].map(([k, p]) => [k, p.name])),
      waiting: waitingByQueue(activity), handling, open
    };
  }, [activity]);
  const presenceCounts = useMemo(() => {
    const counts = new Map<Presence, number>();
    activity?.presence.forEach((p) => counts.set(p.presence, (counts.get(p.presence) ?? 0) + 1));
    return counts;
  }, [activity]);

  const counts = useMemo(() => {
    const c = new Map<NodeKind, number>();
    (graph?.nodes ?? []).forEach((n) => c.set(n.kind, (c.get(n.kind) ?? 0) + 1));
    return c;
  }, [graph]);
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? (graph?.nodes ?? []).filter((n) => n.name.toLowerCase().includes(q)).slice(0, 12) : [];
  }, [graph, search]);

  // Selecting from a list (search, issues, connections) scrolls the record into view when it's off screen.
  // A click in the diagram itself never moves it: you can click from one shape to the next.
  const [revealRequest, setRevealRequest] = useState(0);
  const select = useCallback((key: string, reveal = true) => { setSelected(key); if (reveal) setRevealRequest((n) => n + 1); }, []);
  useEffect(() => {
    if (!revealRequest || !selected || !diagram) return;
    const ids = diagram.byNode.get(selected);
    if (ids?.length) handle.current?.reveal(ids);
  }, [revealRequest, diagram]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!graph) return;
    const wanted = (urlOptions.focus ?? "").toLowerCase();
    const match = wanted ? graph.nodes.find((n) => n.name.toLowerCase() === wanted) ?? graph.nodes.find((n) => n.name.toLowerCase().includes(wanted)) : undefined;
    if (match) select(match.key);
  }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = useCallback(() => { setSelected(undefined); setChainOnly(false); }, []);
  const fitAll = () => handle.current?.fitAll();

  // Follow the call.
  const startRide = (from?: string) => {
    const start = from ?? selected ?? (graph ? defaultRideStart(graph) : undefined);
    if (!graph || !start) return;
    setHovered(undefined);
    setRide({ id: Date.now(), ...extendRide(graph, [start]), playing: true, routeOnly: false });
  };
  const stopRide = useCallback(() => setRide(undefined), []);
  const choose = (option: RideOption) => { if (graph) setRide((r) => (r ? { ...r, ...extendRide(graph, [...r.path, option.key]), playing: true } : r)); };
  const ridePoints = useMemo(() => (ride && diagram ? routePoints(diagram, ride.path) : []), [ride, diagram]);
  const rideStarted = useRef(false);
  useEffect(() => {
    if (rideStarted.current || !urlOptions.ride || !graph || (urlOptions.focus && !selected)) return;
    rideStarted.current = true;
    startRide(selected);
  }, [graph, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guided tour, on the sample data.
  const keyOf = (kind: string, name: string) => graph?.nodes.find((n) => n.kind === kind && n.name === name)?.key;
  const go = (kind: string, name: string) => { const k = keyOf(kind, name); if (k) select(k); };
  type Before = { sample: boolean; tab: Tab; spacing: number; hiddenKinds: Set<NodeKind>; grouping?: Grouping };
  const tourBefore = useRef<Before | undefined>(undefined);
  const [tourWanted, setTourWanted] = useState(false);
  const tourSteps: TourStep[] = [
    { title: "The Environment Diagram", text: "Your whole Dynamics 365 Contact Center as one diagram, left to right the way a call travels: numbers, channels, workstreams and their routing, queues and their agents, overflow.", seconds: 10,
      run: () => { clear(); setRide(undefined); setLiveOn(false); setShowHealth(false); setProblemsOnly(false); setHiddenKinds(firstHidden()); setSpacing(1); setTimeout(fitAll, 50); } },
    { title: "Containers, as in Visio", text: "A workstream holds its bot, its routing rules in order and its default queue. A queue holds its operating hours and its agents, with their skills as tags.", seconds: 10,
      run: () => go("workstream", "Customer Service – Voice") },
    { title: "Shapes", text: "Switch kinds of records on and off: context variables, capacity profiles, teams, business units… The diagram closes up around what's left.", seconds: 9, panel: true,
      run: () => { setTab("shapes"); clear(); setHiddenKinds(new Set()); setTimeout(fitAll, 50); return () => setHiddenKinds(firstHidden()); } },
    { title: "Customer centers", text: "Group workstreams into customer centers, drawn as one container: create, rename and delete them here. 3D Contact Center shows the same centers as buildings.", seconds: 10, panel: true,
      run: () => {
        if (!graph || !grouping) return;
        const before = grouping;
        setTab("centers");
        let g = createCenter(reconcile(undefined, graph), "Contoso Service Center", "tour-center");
        ["Customer Service – Voice", "Technical Support – Voice", "Web Chat"].forEach((name) => {
          const id = graph.nodes.find((n) => n.kind === "workstream" && n.name === name)?.recordId;
          if (id) g = moveWorkstream(g, id, "tour-center", graph);
        });
        setGroupCenters(true); setGrouping(g); clear(); setTimeout(fitAll, 50);
        // Shown, not saved: the viewer's own centers come back afterwards.
        return () => setGrouping(before);
      } },
    { title: "Click a record", text: "Everything a call passes before and after it lights up, the rest fades. An agent in several queues lights up in each.", seconds: 9,
      run: () => go("agent", "Julia de Vries") },
    { title: "Only this chain", text: "Show only this chain: the diagram redraws with just the records that lead to it and follow from it.", seconds: 9,
      run: () => { go("queue", "Billing"); setChainOnly(true); return () => setChainOnly(false); } },
    { title: "Follow the call", text: "Follow a call along the lines, from a phone number through the routing rules to a queue and an agent.", seconds: 22,
      run: () => {
        if (!graph) return;
        clear();
        const channel = keyOf("channel", "Customer Service channel");
        const phone = graph.edges.find((e) => e.kind === "number" && e.to === channel)?.from ?? defaultRideStart(graph);
        if (phone) setRide({ id: Date.now(), ...plannedRide(graph, phone, ["Customer Service channel", "Contoso Service IVR (Microsoft Copilot Studio)", "Customer Service – Voice", "Billing", "Julia de Vries"]), playing: true, routeOnly: false });
        return () => setRide(undefined);
      } },
    { title: "Live activity", text: "Agents show their presence, queues how many calls wait, and new calls run along the lines into their queue.", seconds: 13, panel: true,
      run: () => { setTab("live"); setLiveOn(true); clear(); go("queue", "Tier 1 Support"); } },
    { title: "Health", text: "Problems and warnings are marked on the shapes. Show only the records with an issue; each one says how to fix it.", seconds: 11, panel: true,
      run: () => { setTab("health"); setLiveOn(false); setShowHealth(true); setProblemsOnly(true); setShowUnrouted(true); go("queue", "Partner Desk"); return () => { setProblemsOnly(false); setShowUnrouted(false); }; } },
    { title: "Save it, share it", text: "Save a view to come back to, or download the diagram as SVG (opens in Visio) or PNG.", seconds: 8, panel: true,
      run: () => { setTab("explore"); clear(); setTimeout(fitAll, 50); } },
    { title: "Promethean CCaaS Toolbox", text: "Free and open source, for Dynamics 365 Contact Center admins: github.com/ameijers/PrometheanCCaaSToolbox", seconds: 8,
      run: () => { clear(); setTimeout(fitAll, 50); } }
  ];
  const tour = useTour(tourSteps, () => {
    const before = tourBefore.current;
    tourBefore.current = undefined;
    setRide(undefined); clear(); setLiveOn(false); setShowHealth(false); setProblemsOnly(false);
    if (!before) return;
    setTab(before.tab); setSpacing(before.spacing); setHiddenKinds(before.hiddenKinds);
    if (before.grouping) setGrouping(before.grouping);
    if (!before.sample) { setGraph(undefined); setUseSample(false); }
  });
  const snapshot = (sample: boolean): Before => ({ sample, tab, spacing, hiddenKinds, grouping });
  const startTour = () => {
    if (!useSample) { tourBefore.current = snapshot(false); setGraph(undefined); setSelected(undefined); setUseSample(true); setTourWanted(true); return; }
    tourBefore.current = snapshot(true);
    tour.start();
  };
  const tourOpened = useRef(false);
  useEffect(() => {
    if (!graph || !useSample) return;
    if (tourWanted) { setTourWanted(false); tour.start(); return; }
    if (!tourOpened.current && tourAsked()) { tourOpened.current = true; tourBefore.current = snapshot(true); tour.start(); }
  }, [graph, useSample, tourWanted]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveView = () => {
    const v = handle.current?.view();
    if (!v) return;
    let n = views.length + 1;
    while (views.some((x) => x.name === `View ${n}`)) n++;
    const name = viewName.trim() || `View ${n}`;
    const next = [...views.filter((x) => x.name !== name), { name, ...v }];
    setViews(next);
    storeViews(environment, next);
    setViewName("");
  };
  const deleteView = (name: string) => { const next = views.filter((v) => v.name !== name); setViews(next); storeViews(environment, next); };
  const fileBase = () => `environment-diagram-${environment.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
  const exportSvg = () => {
    const svg = handle.current?.svg();
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    download(url, `${fileBase()}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const exportPng = async () => {
    setExportError("");
    try { const url = await handle.current?.png(); if (url) download(url, `${fileBase()}.png`); } catch (e) { setExportError(e instanceof Error ? e.message : String(e)); }
  };

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) { if (e.key === "Escape") e.target.blur(); return; }
      if (e.key === "Escape") { clear(); stopRide(); }
      if (e.key === "f" || e.key === "F") void toggleFullscreen();
      if (e.key === "0") fitAll();
      if (e.key === "+" || e.key === "=" || e.key === "-") {
        const v = handle.current?.view();
        if (v) {
          const k = Math.max(0.06, Math.min(3, v.k * (e.key === "-" ? 0.8 : 1.25)));
          const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
          handle.current?.setView({ k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k });
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [clear, stopRide]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedNode = selected ? nodeByKey.get(selected) : undefined;
  const hoveredNode = hovered ? nodeByKey.get(hovered) : undefined;
  const selectedIssues = selectedNode ? issues.filter((i) => i.key === selectedNode.key) : [];
  const hoveredIssue = hoveredNode ? issues.find((i) => i.key === hoveredNode.key) : undefined;
  const upstream = selectedNode ? (graph?.edges ?? []).filter((e) => e.to === selectedNode.key) : [];
  const downstream = selectedNode ? (graph?.edges ?? []).filter((e) => e.from === selectedNode.key) : [];
  const openUrl = live && selectedNode?.recordId && KINDS[selectedNode.kind].table ? recordUrl(KINDS[selectedNode.kind].table!, selectedNode.recordId) : undefined;
  const copies = selected ? diagram?.byNode.get(selected)?.length ?? 0 : 0;

  return (
    <div className="diagram-app">
      {diagram && !error && (
        <DiagramView
          diagram={diagram} lit={rideKeys ?? lit} selected={selected} hovered={hovered} issues={showHealth ? worst : undefined}
          live={liveMarks} ride={ride ? { id: ride.id, points: ridePoints, playing: ride.playing } : undefined} arrivals={arrivals} routeKeys={rideKeys}
          handle={handle} leftInset={tour.active && !tour.step?.panel ? 0 : 320} onSelect={(k) => select(k, false)} onHover={setHovered} onBackground={() => { if (!ride) clear(); }}
        />
      )}

      <aside className={`panel left${tour.active && !tour.step?.panel ? " tour-hidden" : ""}`}>
        <header>
          <div className="brand-mark">PCT</div>
          <div>
            <p className="eyebrow">Promethean CCaaS Toolbox</p>
            <h1>Environment Diagram</h1>
          </div>
        </header>
        <p className="target">
          <span className={`status-dot${live ? " live" : ""}`} />{environment}
          {inDataverse && <button className="link source" onClick={() => { setGraph(undefined); setSelected(undefined); setUseSample(live); }}>{live ? "Use sample data" : "Back to live data"}</button>}
        </p>

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

        <div className="mode">
          <button onClick={fitAll} title="Fit the whole diagram (0)">Fit</button>
          <button className={fullscreen ? "on" : ""} onClick={() => void toggleFullscreen()} title="Full screen (F)">{fullscreen ? "Exit full screen" : "Full screen"}</button>
        </div>
        {fullscreenError && <p className="muted small error-text">{fullscreenError}</p>}
        <label className="slider">
          <span>Spacing</span>
          <input type="range" min={1} max={3} step={0.1} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} aria-label="Spacing between swimlanes" />
          <span className="count">{spacing.toFixed(1)}×</span>
        </label>

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
          {tab === "shapes" && (
            <>
              <ul className="legend">
                {KIND_ORDER.map((kind) => {
                  const fixed = ALWAYS_SHOWN.includes(kind);
                  return (
                    <li key={kind}>
                      <label className={hiddenKinds.has(kind) ? "off" : ""} title={fixed ? "Always shown: the diagram is built around them" : undefined}>
                        <input type="checkbox" checked={fixed || !hiddenKinds.has(kind)} disabled={fixed}
                          onChange={() => setHiddenKinds((h) => { const next = new Set(h); if (next.has(kind)) next.delete(kind); else next.add(kind); return next; })} />
                        <span className="dot" style={{ background: KINDS[kind].color }} />
                        <span className="name">{KINDS[kind].plural}</span>
                        <span className="count">{counts.get(kind) ?? 0}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="muted small">Left to right: how a call travels. Rules sit inside their workstream, agents inside their queues; skills, capacity profiles, teams and business units are tags on the agent.</p>
            </>
          )}
          {tab === "centers" && graph && grouping && (
            <CentersTab grouping={grouping} graph={graph} where={store.where} showUnrouted={showUnrouted} onShowUnrouted={setShowUnrouted}
              onChange={changeGrouping} onSelect={(k) => select(k)} onGoToCenter={(id) => handle.current?.reveal(["center|" + id], true)} />
          )}
          {tab === "explore" && graph && (
            <div className="views">
              <button className="wide" onClick={() => startRide()} disabled={!graph.nodes.length}>▶ Follow the call {selectedNode ? `from ${selectedNode.name}` : "from a phone number"}</button>
              <div className="save-view">
                <input value={viewName} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveView(); }} placeholder="View name" aria-label="View name" />
                <button onClick={saveView}>Save view</button>
              </div>
              {views.length > 0 && (
                <ul className="view-list">
                  {views.map((v) => (
                    <li key={v.name}>
                      <button className="name" onClick={() => handle.current?.setView(v)}>{v.name}</button>
                      <button className="remove" onClick={() => deleteView(v.name)} aria-label={`Delete view ${v.name}`}>×</button>
                    </li>
                  ))}
                </ul>
              )}
              <h3>Download</h3>
              <div className="save-view">
                <button onClick={exportSvg} title="A vector drawing: open it in Visio (File > Open), a browser or PowerPoint">SVG (Visio)</button>
                <button onClick={() => void exportPng()} title="A picture of the whole diagram">PNG</button>
              </div>
              <p className="muted small">The whole diagram as it's drawn now, with its highlights. Visio opens the SVG; right-click it and choose Convert to Shape to edit the shapes.</p>
              {exportError && <p className="muted small error-text">{exportError}</p>}
            </div>
          )}
          {tab === "live" && graph && (
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
                      <p className="muted small">Updated {new Date(activity.readAt).toLocaleTimeString()}, every {(live ? LIVE_REFRESH_MS : DEMO_REFRESH_MS) / 1000} seconds.</p>
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
                      <p className="muted small">Agents show their presence colour; a cyan number is how many conversations they have now. Queues show how many calls wait.</p>
                    </>
                  ) : !liveError && <p className="muted small">Reading live activity…</p>}
                  {liveError && <p className="muted small error-text">Couldn't read live activity: {liveError}</p>}
                </>
              )}
            </div>
          )}
          {tab === "health" && graph && (
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
                          <button onClick={() => { if (i.key.startsWith("queue:") && leftOut.has(i.key)) setShowUnrouted(true); select(i.key); }}>
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
          {tab === "help" && (
            <>
              <button className="tour-start" onClick={startTour} disabled={!graph}>▶ Play the tour</button>
              <p className="muted small">A guided tour of everything the diagram can do, on the sample data; it plays by itself. Also: add <code>?tour=1</code> to the page address.</p>
              <dl className="help">
                <dt>Drag</dt><dd>move the diagram</dd>
                <dt>Scroll</dt><dd>zoom (at the pointer)</dd>
                <dt>Click</dt><dd>select a record</dd>
                <dt>+ / −</dt><dd>zoom in / out</dd>
                <dt>0</dt><dd>fit the whole diagram</dd>
                <dt>F</dt><dd>full screen</dd>
                <dt>Esc</dt><dd>clear the selection</dd>
              </dl>
              <h3>Reading the diagram</h3>
              <ul className="key">
                <li><span className="key-shape container" /> Container: a workstream or a queue, with what belongs to it inside</li>
                <li><span className="key-shape diamond" /> Routing rule, in the order it's checked</li>
                <li><span className="key-shape line" /> What a call travels; <span className="key-shape dashed" /> the default queue</li>
                <li><span className="key-shape pill" /> Tag: a skill, capacity profile, team or business unit</li>
                <li><span className="key-shape group" /> Customer center, or records not connected to a workstream</li>
              </ul>
              {graph && graph.warnings.length > 0 && (
                <div className="warnings">
                  <button onClick={() => setShowWarnings((s) => !s)}>{graph.warnings.length} thing{graph.warnings.length === 1 ? "" : "s"} couldn't be read</button>
                  {showWarnings && <ul>{graph.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                </div>
              )}
              <button className="link" onClick={() => void load()} disabled={loading}>Read the environment again</button>
            </>
          )}
        </div>
      </aside>

      {selectedNode && (
        <aside className="panel right">
          <div className="kind" style={{ color: KINDS[selectedNode.kind].color }}>{KINDS[selectedNode.kind].label}</div>
          <h2>{selectedNode.name}</h2>
          {(selectedNode.details.length > 0 || activity) && (
            <dl className="details">
              {[...selectedNode.details, ...(activity ? liveDetails(selectedNode.key, activity) : [])].map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value || "—"}</dd></React.Fragment>)}
            </dl>
          )}
          {selectedNode.kind === "workstream" && selectedNode.recordId && grouping && graph && (
            <label className="center-field">
              <span>Customer center</span>
              <CenterPicker grouping={grouping} graph={graph} workstreamId={selectedNode.recordId} onChange={(g) => { changeGrouping(g); setGroupCenters(true); }} />
            </label>
          )}
          {copies > 1 && <p className="muted small">Drawn {copies} times in the diagram (once per queue or channel); all copies are highlighted.</p>}
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
            <button className="link" onClick={clear}>Clear selection</button>
          </div>
          <Connections title="Before it (comes from)" edges={upstream} side="from" nodeByKey={nodeByKey} onSelect={select} />
          <Connections title="After it (goes to)" edges={downstream} side="to" nodeByKey={nodeByKey} onSelect={select} />
        </aside>
      )}

      <TourBar tour={tour} />

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
                <button key={o.key} onClick={() => choose(o)}><span className="dot" style={{ background: KINDS[o.kind].color }} />{o.name}<small>{o.relation}</small></button>
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

      {hoveredNode && hoveredNode.key !== selected && !ride && (
        <div className="hover-hint">
          <span className="dot" style={{ background: KINDS[hoveredNode.kind].color }} />{KINDS[hoveredNode.kind].label}: <strong>{hoveredNode.name}</strong>
          {liveMarks?.presenceName.get(hoveredNode.key) && <span> · {liveMarks.presenceName.get(hoveredNode.key)}</span>}
          {showHealth && hoveredIssue && <span style={{ color: SEVERITY_COLORS[hoveredIssue.severity] }}> · {hoveredIssue.title}</span>}
        </div>
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
