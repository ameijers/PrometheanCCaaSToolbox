// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { EDGE_LABELS, EdgeKind, Graph, GraphNode, NodeKind } from "./model";

// "Follow the call": a route along the lines a conversation takes, phone number -> channel ->
// workstream -> routing rule -> queue -> agent. Where there's one way on the route grows by itself;
// where there are more, the viewer picks. Skills aren't a step a call takes, so the ride ends at the agent.

const FLOW: EdgeKind[] = ["number", "channel", "routes", "default", "member"];

export interface RideOption {
  key: string;
  name: string;
  kind: NodeKind;
  relation: string;
}

const orderOf = (n: GraphNode) => Number(n.details.find(([label]) => label === "Order")?.[1] ?? Number.MAX_SAFE_INTEGER);

export function rideOptions(graph: Graph, from: string, exclude: Set<string> = new Set()): RideOption[] {
  const nodeByKey = new Map(graph.nodes.map((n) => [n.key, n]));
  return graph.edges
    .filter((e) => e.from === from && FLOW.includes(e.kind) && nodeByKey.has(e.to) && !exclude.has(e.to))
    .map((e) => ({ edge: e, node: nodeByKey.get(e.to)! }))
    // Rules in their order, the default queue after them, everything else by name.
    .sort((a, b) => (a.edge.kind === "default" ? 1 : 0) - (b.edge.kind === "default" ? 1 : 0) || orderOf(a.node) - orderOf(b.node) || a.node.name.localeCompare(b.node.name))
    .map(({ edge, node }) => ({ key: node.key, name: node.name, kind: node.kind, relation: edge.label ? `${EDGE_LABELS[edge.kind]} · ${edge.label}` : EDGE_LABELS[edge.kind] }));
}

// Follows single ways on from the end of the route; returns the route and the choices at its end.
export function extendRide(graph: Graph, path: string[]): { path: string[]; options: RideOption[] } {
  const route = [...path];
  for (;;) {
    const options = rideOptions(graph, route[route.length - 1], new Set(route));
    if (options.length !== 1) return { path: route, options };
    route.push(options[0].key);
  }
}

// Where a ride starts when nothing is selected: the first phone number that leads somewhere.
export function defaultRideStart(graph: Graph): string | undefined {
  const phones = graph.nodes.filter((n) => n.kind === "phone").sort((a, b) => a.name.localeCompare(b.name));
  return (phones.find((p) => rideOptions(graph, p.key).length) ?? phones[0] ?? graph.nodes.find((n) => n.kind === "workstream"))?.key;
}
