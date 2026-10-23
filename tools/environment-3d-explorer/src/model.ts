// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The environment as a graph: every record is a node, every relationship an edge. Edges always
// point downstream, in the direction a conversation travels (phone number -> channel -> workstream
// -> routing rule -> queue -> agent -> skill), so "in front of" and "behind" mean upstream and
// downstream.

export type NodeKind = "phone" | "channel" | "workstream" | "rule" | "queue" | "agent" | "skill";

export interface KindInfo {
  label: string;
  plural: string;
  // Depth layer: higher is closer to the front of the scene.
  layer: number;
  color: string;
  // Dataverse table, for "Open record". Routing rules live inside a ruleset, so they open the ruleset.
  table?: string;
}

export const KINDS: Record<NodeKind, KindInfo> = {
  phone: { label: "Phone number", plural: "Phone numbers", layer: 3, color: "#7dd3fc", table: "msdyn_ocphonenumber" },
  channel: { label: "Voice channel", plural: "Voice channels", layer: 2, color: "#38bdf8", table: "msdyn_ocvoicechannelsetting" },
  workstream: { label: "Workstream", plural: "Workstreams", layer: 1, color: "#fbbf24", table: "msdyn_liveworkstream" },
  rule: { label: "Routing rule", plural: "Routing rules", layer: 0, color: "#f472b6", table: "msdyn_decisionruleset" },
  queue: { label: "Queue", plural: "Queues", layer: -1, color: "#34d399", table: "queue" },
  agent: { label: "Agent", plural: "Agents", layer: -2, color: "#a78bfa", table: "systemuser" },
  skill: { label: "Skill", plural: "Skills", layer: -3, color: "#fb923c", table: "characteristic" }
};

export const KIND_ORDER: NodeKind[] = ["phone", "channel", "workstream", "rule", "queue", "agent", "skill"];

export interface GraphNode {
  // Unique across the graph: "<kind>:<record id>" (a rule adds its rule id inside the ruleset).
  key: string;
  kind: NodeKind;
  name: string;
  // The Dataverse record to open, when there is one.
  recordId?: string;
  // Shown in the details panel, in this order.
  details: [string, string][];
  // What health.ts checks, beyond the links themselves.
  facts?: NodeFacts;
}

export interface NodeFacts {
  voice?: boolean;
  disabled?: boolean;
  // Queues a rule (or a workstream as its default) points at that aren't among the active omnichannel queues.
  missingQueues?: number;
  hasResource?: boolean;
}

// Optional reads that failed: checks that depend on them are skipped rather than reported.
export type Unread = "phoneNumbers" | "channels" | "resources" | "skills";

export type EdgeKind = "number" | "channel" | "routes" | "default" | "member" | "skill";

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  // Things that couldn't be read; the scene still shows the rest.
  warnings: string[];
  unread: Unread[];
}

export const EDGE_LABELS: Record<EdgeKind, string> = {
  number: "phone number",
  channel: "channel",
  routes: "routes to",
  default: "default queue",
  member: "member",
  skill: "has skill"
};
