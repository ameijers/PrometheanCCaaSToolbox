// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The environment as a graph: every record is a node, every relationship an edge. Edges always
// point downstream, in the direction a conversation travels (phone number -> channel -> bot ->
// workstream -> routing rule -> queue -> overflow or agent -> skill), so "in front of" and "behind"
// mean upstream and downstream. Settings that belong to a record (context variables, operating hours,
// capacity profiles, teams, business units) sit on half layers next to it.

export type NodeKind =
  | "phone" | "channel" | "bot" | "workstream" | "variable" | "rule" | "hours" | "queue" | "overflow"
  | "agent" | "capacity" | "skill" | "team" | "businessunit";

export interface KindInfo {
  label: string;
  plural: string;
  // Depth layer: higher is closer to the front of the scene.
  layer: number;
  color: string;
  // Dataverse table, for "Open record". Routing rules live inside a ruleset, so they open the ruleset;
  // an overflow action opens its action configuration, a bot its user.
  table?: string;
  // Hidden until ticked in the legend: these can add a lot of records.
  hiddenAtFirst?: boolean;
}

export const KINDS: Record<NodeKind, KindInfo> = {
  phone: { label: "Phone number", plural: "Phone numbers", layer: 3, color: "#7dd3fc", table: "msdyn_ocphonenumber" },
  channel: { label: "Voice channel", plural: "Voice channels", layer: 2, color: "#38bdf8", table: "msdyn_ocvoicechannelsetting" },
  bot: { label: "Bot", plural: "Bots", layer: 1.5, color: "#e879f9", table: "systemuser" },
  workstream: { label: "Workstream", plural: "Workstreams", layer: 1, color: "#fbbf24", table: "msdyn_liveworkstream" },
  variable: { label: "Context variable", plural: "Context variables", layer: 0.5, color: "#fcd34d", table: "msdyn_ocliveworkstreamcontextvariable", hiddenAtFirst: true },
  rule: { label: "Routing rule", plural: "Routing rules", layer: 0, color: "#f472b6", table: "msdyn_decisionruleset" },
  hours: { label: "Operating hours", plural: "Operating hours", layer: -0.5, color: "#94a3b8", table: "msdyn_operatinghour" },
  queue: { label: "Queue", plural: "Queues", layer: -1, color: "#34d399", table: "queue" },
  overflow: { label: "Overflow action", plural: "Overflow actions", layer: -1.5, color: "#f87171", table: "msdyn_overflowactionconfig" },
  agent: { label: "Agent", plural: "Agents", layer: -2, color: "#a78bfa", table: "systemuser" },
  capacity: { label: "Capacity profile", plural: "Capacity profiles", layer: -2.5, color: "#2dd4bf", table: "msdyn_capacityprofile", hiddenAtFirst: true },
  skill: { label: "Skill", plural: "Skills", layer: -3, color: "#fb923c", table: "characteristic" },
  team: { label: "Team", plural: "Teams", layer: -3.5, color: "#60a5fa", table: "team", hiddenAtFirst: true },
  businessunit: { label: "Business unit", plural: "Business units", layer: -4, color: "#818cf8", table: "businessunit", hiddenAtFirst: true }
};

export const KIND_ORDER: NodeKind[] = ["phone", "channel", "bot", "workstream", "variable", "rule", "hours", "queue", "overflow", "agent", "capacity", "skill", "team", "businessunit"];

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
export type Unread = "phoneNumbers" | "channels" | "resources" | "skills" | "bots" | "variables" | "hours" | "overflow" | "capacity" | "teams" | "businessunits";

export type EdgeKind =
  | "number" | "channel" | "bot" | "handoff" | "routes" | "default" | "member" | "skill"
  | "variable" | "hours" | "overflow" | "transfer" | "capacity" | "team" | "businessunit";

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
  skill: "has skill",
  bot: "answered by bot",
  handoff: "hands over to",
  variable: "context variable",
  hours: "operating hours",
  overflow: "overflow",
  transfer: "transfers to",
  capacity: "capacity profile",
  team: "team member",
  businessunit: "business unit"
};
