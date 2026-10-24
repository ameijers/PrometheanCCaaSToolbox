// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Graph } from "../../environment-3d-explorer/src/model";

// Customer centers: groups of workstreams, drawn as one building each. Dataverse has no such
// grouping, so every workstream starts as its own center and the viewer combines them. Pure.

export interface Center {
  id: string;
  name: string;
  color: string;
  // Workstream record ids.
  workstreams: string[];
}

export interface Grouping {
  version: 1;
  centers: Center[];
}

// Building colours, picked in turn.
export const CENTER_COLORS = ["#38bdf8", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c", "#60a5fa", "#facc15", "#2dd4bf", "#e879f9"];

const workstreamsOf = (graph: Graph) => graph.nodes.filter((n) => n.kind === "workstream" && n.recordId).sort((a, b) => a.name.localeCompare(b.name));

function freeColor(centers: Center[]): string {
  const used = new Set(centers.map((c) => c.color));
  return CENTER_COLORS.find((c) => !used.has(c)) ?? CENTER_COLORS[centers.length % CENTER_COLORS.length];
}

function centerFor(id: string, name: string, centers: Center[]): Center {
  return { id: `center-${id}`, name, color: freeColor(centers), workstreams: [id] };
}

export function defaultGrouping(graph: Graph): Grouping {
  const centers: Center[] = [];
  workstreamsOf(graph).forEach((w) => centers.push(centerFor(w.recordId!, w.name, centers)));
  return { version: 1, centers };
}

// A saved grouping against today's environment: workstreams that are gone drop out, centers left
// empty go, and new workstreams get a center of their own.
export function reconcile(saved: Grouping | undefined, graph: Graph): Grouping {
  if (!saved || saved.version !== 1 || !Array.isArray(saved.centers)) return defaultGrouping(graph);
  const known = new Map(workstreamsOf(graph).map((w) => [w.recordId!, w.name]));
  const placed = new Set<string>();
  const centers: Center[] = [];
  saved.centers.forEach((c) => {
    const workstreams = (Array.isArray(c.workstreams) ? c.workstreams : []).filter((id) => known.has(id) && !placed.has(id));
    workstreams.forEach((id) => placed.add(id));
    if (workstreams.length && typeof c.id === "string") centers.push({ id: c.id, name: String(c.name || known.get(workstreams[0])), color: String(c.color || freeColor(centers)), workstreams });
  });
  known.forEach((name, id) => { if (!placed.has(id)) centers.push(centerFor(id, name, centers)); });
  return { version: 1, centers };
}

// Puts the given centers' workstreams into the first one, under a new name.
export function combine(grouping: Grouping, centerIds: string[], name: string): Grouping {
  const chosen = grouping.centers.filter((c) => centerIds.includes(c.id));
  if (chosen.length < 2) return grouping;
  const merged: Center = { ...chosen[0], name: name.trim() || chosen[0].name, workstreams: chosen.flatMap((c) => c.workstreams) };
  return { ...grouping, centers: grouping.centers.filter((c) => !centerIds.includes(c.id) || c.id === merged.id).map((c) => (c.id === merged.id ? merged : c)) };
}

// Gives every workstream of a center its own center again.
export function split(grouping: Grouping, centerId: string, graph: Graph): Grouping {
  const center = grouping.centers.find((c) => c.id === centerId);
  if (!center || center.workstreams.length < 2) return grouping;
  const names = new Map(workstreamsOf(graph).map((w) => [w.recordId!, w.name]));
  const rest = grouping.centers.filter((c) => c.id !== centerId);
  const parts: Center[] = [];
  center.workstreams.forEach((id, i) => {
    parts.push(i === 0 ? { ...center, name: names.get(id) ?? center.name, workstreams: [id] } : centerFor(id, names.get(id) ?? id, [...rest, ...parts]));
  });
  const at = grouping.centers.indexOf(center);
  return { ...grouping, centers: [...rest.slice(0, at), ...parts, ...rest.slice(at)] };
}

// Moves one workstream to another center, or to a new center of its own ("new").
export function moveWorkstream(grouping: Grouping, workstreamId: string, to: string, graph: Graph): Grouping {
  const from = grouping.centers.find((c) => c.workstreams.includes(workstreamId));
  if (!from || from.id === to) return grouping;
  let centers = grouping.centers.map((c) => (c.id === from.id ? { ...c, workstreams: c.workstreams.filter((w) => w !== workstreamId) } : c));
  if (to === "new") {
    const name = workstreamsOf(graph).find((w) => w.recordId === workstreamId)?.name ?? workstreamId;
    const fresh = centerFor(workstreamId, name, centers);
    // The id must be new: the workstream may have had a center of this id before.
    fresh.id = centers.some((c) => c.id === fresh.id) ? `${fresh.id}-${Date.now().toString(36)}` : fresh.id;
    centers = [...centers, fresh];
  } else {
    if (!centers.some((c) => c.id === to)) return grouping;
    centers = centers.map((c) => (c.id === to ? { ...c, workstreams: [...c.workstreams, workstreamId] } : c));
  }
  return { ...grouping, centers: centers.filter((c) => c.workstreams.length) };
}

export function rename(grouping: Grouping, centerId: string, name: string): Grouping {
  return name.trim() ? { ...grouping, centers: grouping.centers.map((c) => (c.id === centerId ? { ...c, name: name.trim() } : c)) } : grouping;
}

export function recolor(grouping: Grouping, centerId: string, color: string): Grouping {
  return { ...grouping, centers: grouping.centers.map((c) => (c.id === centerId ? { ...c, color } : c)) };
}
