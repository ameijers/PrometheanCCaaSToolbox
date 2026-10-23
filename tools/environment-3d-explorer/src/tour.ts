// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Vec3 } from "./layout";
import { GraphNode, KIND_ORDER, KINDS, NodeKind } from "./model";

// A fly-through, front to back: one stop per layer, looking at that layer's part of the chain (or
// of the whole environment) from a little in front and to the side.

export interface TourStop {
  kind: NodeKind;
  count: number;
  // A few names to show in the caption.
  names: string[];
  position: Vec3;
  target: Vec3;
}

export const TOUR_NAMES = 5;

export function buildTour(nodes: GraphNode[], positions: Map<string, Vec3>, only?: Set<string>): TourStop[] {
  return KIND_ORDER.flatMap((kind): TourStop[] => {
    const group = nodes.filter((n) => n.kind === kind && (!only || only.has(n.key)) && positions.has(n.key));
    if (!group.length) return [];
    const points = group.map((n) => positions.get(n.key)!);
    const target: Vec3 = [0, 1, 2].map((axis) => points.reduce((s, p) => s + p[axis], 0) / points.length) as Vec3;
    const spread = Math.max(10, ...points.map((p) => Math.hypot(p[0] - target[0], p[1] - target[1])));
    return [{
      kind,
      count: group.length,
      names: group.map((n) => n.name).sort((a, b) => a.localeCompare(b)).slice(0, TOUR_NAMES),
      target,
      position: [target[0] + spread * 0.5 + 18, target[1] + spread * 0.35 + 12, target[2] + spread * 1.15 + 35]
    }];
  });
}

export function tourCaption(stop: TourStop): string {
  const label = stop.count === 1 ? KINDS[stop.kind].label : KINDS[stop.kind].plural;
  const more = stop.count > stop.names.length ? `, and ${stop.count - stop.names.length} more` : "";
  return `${stop.count} ${label.toLowerCase()}: ${stop.names.join(", ")}${more}`;
}
