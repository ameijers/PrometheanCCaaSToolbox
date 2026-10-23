// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Graph, KINDS, NodeKind } from "./model";

// Places every node in 3D. Depth (z) is the node's layer, so the call flow runs from the front
// (phone numbers) to the back (skills). Within a layer, workstreams sit on a sunflower spiral and
// every other node sits near the nodes it connects to, then nodes push each other apart so the
// layer reads as a cloud. Deterministic: the same environment always gets the same picture.

export type Vec3 = [number, number, number];

export const LAYER_SPACING = 60;
const MIN_DISTANCE = 6;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Stable pseudo-random number in [-1, 1) per string, so jitter doesn't change between loads.
export function hash(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

function spiral(index: number, spacing: number): [number, number] {
  const r = spacing * Math.sqrt(index + 0.5);
  return [r * Math.cos(index * GOLDEN_ANGLE), r * Math.sin(index * GOLDEN_ANGLE)];
}

const rms = (points: [number, number][]) => Math.sqrt(points.reduce((s, p) => s + p[0] * p[0] + p[1] * p[1], 0) / Math.max(1, points.length));

function separate(points: [number, number][], iterations: number): void {
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[j][0] - points[i][0];
        const dy = points[j][1] - points[i][1];
        const d = Math.hypot(dx, dy);
        if (d >= MIN_DISTANCE) continue;
        // Two nodes on the same spot: pick a direction from their index so they still separate.
        const [ux, uy] = d > 1e-6 ? [dx / d, dy / d] : [Math.cos(i + j), Math.sin(i + j)];
        const push = (MIN_DISTANCE - d) / 2;
        points[i][0] -= ux * push; points[i][1] -= uy * push;
        points[j][0] += ux * push; points[j][1] += uy * push;
        moved = true;
      }
    }
    if (!moved) return;
  }
}

// "Size by connections": a record grows with the number of links it has (a queue's members and the
// rules routing to it, a workstream's channels and rules), by the square root so big ones don't swamp the rest.
export function connectionScales(graph: Graph): Map<string, number> {
  const degree = new Map<string, number>();
  graph.edges.forEach((e) => { degree.set(e.from, (degree.get(e.from) ?? 0) + 1); degree.set(e.to, (degree.get(e.to) ?? 0) + 1); });
  return new Map(graph.nodes.map((n) => [n.key, 0.7 + Math.min(2.5, Math.sqrt(degree.get(n.key) ?? 0) * 0.4)]));
}

export function computeLayout(graph: Graph): Map<string, Vec3> {
  const xy = new Map<string, [number, number]>();
  const byKind = (kind: NodeKind) => graph.nodes.filter((n) => n.kind === kind);
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  graph.edges.forEach((e) => {
    up.set(e.to, [...(up.get(e.to) ?? []), e.from]);
    down.set(e.from, [...(down.get(e.from) ?? []), e.to]);
  });
  const neighbours = (nodeKey: string, direction: "up" | "down") => (direction === "up" ? up : down).get(nodeKey) ?? [];

  // Workstreams anchor the picture.
  const workstreams = byKind("workstream").sort((a, b) => a.name.localeCompare(b.name));
  workstreams.forEach((n, i) => xy.set(n.key, spiral(i, 22)));
  const anchorRadius = workstreams.length ? rms(workstreams.map((n) => xy.get(n.key)!)) : 30;

  // Every other layer, walking outwards from the workstreams: a node sits at the centre of the
  // already placed nodes it's linked to, plus a little jitter. Unlinked nodes ring the layer.
  const place = (kind: NodeKind, direction: "up" | "down") => {
    const nodes = byKind(kind);
    const points = nodes.map((n, i): [number, number] => {
      const linked = neighbours(n.key, direction).map((k) => xy.get(k)).filter((p): p is [number, number] => !!p);
      if (!linked.length) {
        const [x, y] = spiral(i, 9);
        const outer = 30 + Math.sqrt(nodes.length) * 9;
        const angle = Math.atan2(y, x);
        return [Math.cos(angle) * (outer + Math.hypot(x, y) * 0.3), Math.sin(angle) * (outer + Math.hypot(x, y) * 0.3)];
      }
      const cx = linked.reduce((s, p) => s + p[0], 0) / linked.length;
      const cy = linked.reduce((s, p) => s + p[1], 0) / linked.length;
      return [cx + hash(n.key, 1) * 6, cy + hash(n.key, 2) * 6];
    });
    // Averaging pulls a layer towards the middle (a queue fed by every workstream ends up in the
    // centre), so a layer that shrank is stretched back out to a little more than the workstreams' size.
    const target = Math.max(anchorRadius * 1.2, Math.sqrt(nodes.length) * 8);
    const radius = rms(points);
    if (radius > 1e-6 && radius < target) points.forEach((p) => { p[0] *= target / radius; p[1] *= target / radius; });
    separate(points, nodes.length > 1500 ? 8 : 40);
    nodes.forEach((n, i) => xy.set(n.key, points[i]));
  };
  place("bot", "down");
  place("channel", "down");
  place("phone", "down");
  place("variable", "up");
  place("rule", "up");
  place("queue", "up");
  place("hours", "down");
  place("overflow", "up");
  place("agent", "up");
  place("capacity", "up");
  place("skill", "up");
  place("team", "up");
  place("businessunit", "up");

  const positions = new Map<string, Vec3>();
  graph.nodes.forEach((n) => {
    const [x, y] = xy.get(n.key) ?? [0, 0];
    positions.set(n.key, [x, y, KINDS[n.kind].layer * LAYER_SPACING + hash(n.key, 3) * 5]);
  });
  return positions;
}
