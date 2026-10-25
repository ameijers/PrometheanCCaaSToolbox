// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Graph } from "../../environment-3d-explorer/src/model";

// Customer centers: named groups of workstreams, drawn as one building each. Dataverse has no such
// grouping, so the viewer makes them: create a center, give it a name, move workstreams into it. A
// workstream that's in no center stands as a building of its own (an automatic center). Pure.

export interface Center {
  id: string;
  name: string;
  color: string;
  // Workstream record ids.
  workstreams: string[];
  // Made by the viewer (kept when empty); otherwise one workstream's own building.
  custom?: boolean;
}

export interface Grouping {
  version: 1;
  centers: Center[];
  // Workstreams not drawn (record ids). Ones linked to nothing start hidden.
  hidden?: string[];
}

// Building colours, picked in turn.
export const CENTER_COLORS = ["#38bdf8", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c", "#60a5fa", "#facc15", "#2dd4bf", "#e879f9"];

const workstreamsOf = (graph: Graph) => graph.nodes.filter((n) => n.kind === "workstream" && n.recordId).sort((a, b) => a.name.localeCompare(b.name));
const nameOf = (graph: Graph, id: string) => workstreamsOf(graph).find((w) => w.recordId === id)?.name ?? id;

function freeColor(centers: Center[]): string {
  const used = new Set(centers.map((c) => c.color));
  return CENTER_COLORS.find((c) => !used.has(c)) ?? CENTER_COLORS[centers.length % CENTER_COLORS.length];
}

function ownCenter(id: string, name: string, centers: Center[]): Center {
  return { id: `center-${id}`, name, color: freeColor(centers), workstreams: [id] };
}

// Linked to nothing: no channel or bot leads to it, and it routes nowhere (no rules, no default queue).
// These only add clutter, so they start hidden.
export function isUnlinked(graph: Graph, workstreamId: string): boolean {
  const key = `workstream:${workstreamId}`;
  const into = graph.edges.some((e) => e.to === key && (e.kind === "channel" || e.kind === "handoff"));
  const out = graph.edges.some((e) => e.from === key && (e.kind === "routes" || e.kind === "default"));
  return !into && !out;
}

export function defaultGrouping(graph: Graph): Grouping {
  const centers: Center[] = [];
  workstreamsOf(graph).forEach((w) => centers.push(ownCenter(w.recordId!, w.name, centers)));
  return { version: 1, centers, hidden: workstreamsOf(graph).map((w) => w.recordId!).filter((id) => isUnlinked(graph, id)) };
}

// A saved grouping against today's environment: workstreams that are gone drop out, automatic centers
// left empty go (the viewer's own stay), and new workstreams get a building of their own.
export function reconcile(saved: Grouping | undefined, graph: Graph): Grouping {
  if (!saved || saved.version !== 1 || !Array.isArray(saved.centers)) return defaultGrouping(graph);
  const known = new Map(workstreamsOf(graph).map((w) => [w.recordId!, w.name]));
  const placed = new Set<string>();
  const centers: Center[] = [];
  saved.centers.forEach((c) => {
    if (typeof c.id !== "string") return;
    const workstreams = (Array.isArray(c.workstreams) ? c.workstreams : []).filter((id) => known.has(id) && !placed.has(id));
    workstreams.forEach((id) => placed.add(id));
    // Groupings saved before centers could be made: one with more than one workstream was the viewer's.
    const custom = c.custom ?? (Array.isArray(c.workstreams) && c.workstreams.length > 1);
    if (workstreams.length || custom) {
      centers.push({ id: c.id, name: String(c.name || known.get(workstreams[0]) || "Customer center"), color: String(c.color || freeColor(centers)), workstreams, ...(custom ? { custom: true } : {}) });
    }
  });
  const fresh: string[] = [];
  known.forEach((name, id) => { if (!placed.has(id)) { centers.push(ownCenter(id, name, centers)); fresh.push(id); } });
  // A grouping saved before hiding existed hides nothing it didn't know about; new workstreams hide when unlinked.
  const hidden = [...(Array.isArray(saved.hidden) ? saved.hidden.filter((id) => known.has(id)) : []), ...fresh.filter((id) => isUnlinked(graph, id))];
  return { version: 1, centers, hidden };
}

// A new, empty customer center; workstreams are moved into it afterwards.
export function createCenter(grouping: Grouping, name: string, id = `custom-${Date.now().toString(36)}`): Grouping {
  const clean = name.trim();
  if (!clean) return grouping;
  const custom = grouping.centers.filter((c) => c.custom);
  const at = custom.length ? grouping.centers.indexOf(custom[custom.length - 1]) + 1 : 0;
  const center: Center = { id, name: clean, color: freeColor(grouping.centers), workstreams: [], custom: true };
  return { ...grouping, centers: [...grouping.centers.slice(0, at), center, ...grouping.centers.slice(at)] };
}

// Moves a workstream into a customer center, or out to a building of its own ("own").
export function moveWorkstream(grouping: Grouping, workstreamId: string, to: string, graph: Graph): Grouping {
  const from = grouping.centers.find((c) => c.workstreams.includes(workstreamId));
  if (!from || from.id === to) return grouping;
  if (to === "own" && !from.custom) return grouping;
  let centers = grouping.centers.map((c) => (c.id === from.id ? { ...c, workstreams: c.workstreams.filter((w) => w !== workstreamId) } : c));
  if (to === "own") {
    const own = ownCenter(workstreamId, nameOf(graph, workstreamId), centers);
    if (centers.some((c) => c.id === own.id)) own.id = `${own.id}-${Date.now().toString(36)}`;
    centers = [...centers, own];
  } else {
    if (!centers.some((c) => c.id === to)) return grouping;
    centers = centers.map((c) => (c.id === to ? { ...c, workstreams: [...c.workstreams, workstreamId] } : c));
  }
  return { ...grouping, centers: centers.filter((c) => c.workstreams.length || c.custom) };
}

// Removes a customer center the viewer made; its workstreams get a building of their own again.
export function deleteCenter(grouping: Grouping, centerId: string, graph: Graph): Grouping {
  const center = grouping.centers.find((c) => c.id === centerId);
  if (!center?.custom) return grouping;
  let next: Grouping = grouping;
  center.workstreams.forEach((id) => { next = moveWorkstream(next, id, "own", graph); });
  return { ...next, centers: next.centers.filter((c) => c.id !== centerId) };
}

export function rename(grouping: Grouping, centerId: string, name: string): Grouping {
  return name.trim() ? { ...grouping, centers: grouping.centers.map((c) => (c.id === centerId ? { ...c, name: name.trim() } : c)) } : grouping;
}

export function recolor(grouping: Grouping, centerId: string, color: string): Grouping {
  return { ...grouping, centers: grouping.centers.map((c) => (c.id === centerId ? { ...c, color } : c)) };
}

export function setHidden(grouping: Grouping, workstreamId: string, hidden: boolean): Grouping {
  const rest = (grouping.hidden ?? []).filter((id) => id !== workstreamId);
  return { ...grouping, hidden: hidden ? [...rest, workstreamId] : rest };
}
