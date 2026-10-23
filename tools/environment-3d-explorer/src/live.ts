// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Graph } from "./model";

// Live activity on top of the configuration: each agent's presence, and the conversations open now
// or created in the last day, mapped onto the graph's records. Pure: dataverse.ts and demoData.ts
// supply the rows.

type Row = Record<string, any>;

export type Presence = "available" | "busy" | "dnd" | "away" | "offline";
export type ConversationStatus = "waiting" | "with-agent" | "wrap-up";

// msdyn_presence.msdyn_basepresencestatus, confirmed live (academyexperiment, 2026-10-23).
const BASE_PRESENCE: Record<number, Presence> = { 192360000: "available", 192360001: "busy", 192360002: "dnd", 192360003: "away", 192360004: "offline" };
// msdyn_ocliveworkitem.statuscode, confirmed live: 1 Open, 2 Active, 3 Waiting, 4 Closed, 5 Wrap-up, 6 Resolved, 7 Scheduled.
const OPEN = 1, WRAP_UP = 5;

export const PRESENCE_LABELS: Record<Presence, string> = { available: "Available", busy: "Busy", dnd: "Do not disturb", away: "Away", offline: "Offline" };
export const PRESENCE_COLORS: Record<Presence, string> = { available: "#22c55e", busy: "#ef4444", dnd: "#b91c1c", away: "#f59e0b", offline: "#64748b" };
export const CONVERSATION_COLORS: Record<ConversationStatus, string> = { waiting: "#fde047", "with-agent": "#67e8f9", "wrap-up": "#c4b5fd" };
export const CONVERSATION_LABELS: Record<ConversationStatus, string> = { waiting: "waiting", "with-agent": "with an agent", "wrap-up": "in wrap-up" };

export interface LiveConversation {
  id: string;
  status: ConversationStatus;
  queueKey?: string;
  agentKey?: string;
  workstreamKey?: string;
}

export interface LiveRows {
  agentStatuses: Row[];
  // Open conversations, and every conversation created since `since`.
  conversations: Row[];
  since: string;
}

export interface Live {
  readAt: string;
  since: string;
  presence: Map<string, { presence: Presence; name: string }>;
  // Open now.
  open: LiveConversation[];
  // Created since `since`, open or not, per record key.
  recent: Map<string, number>;
}

const id = (value: unknown) => (typeof value === "string" && value ? value.replace(/[{}]/g, "").toLowerCase() : undefined);

export function buildLive(graph: Graph, rows: LiveRows, readAt: string): Live {
  const keys = new Set(graph.nodes.map((n) => n.key));
  const known = (key: string) => (keys.has(key) ? key : undefined);

  const presence = new Map<string, { presence: Presence; name: string }>();
  rows.agentStatuses.forEach((row) => {
    const agentKey = known(`agent:${id(row._msdyn_agentid_value)}`);
    if (!agentKey) return;
    const base = BASE_PRESENCE[row.msdyn_currentpresenceid?.msdyn_basepresencestatus];
    // Signed out counts as offline, whatever presence was last set.
    const p: Presence = row.msdyn_isagentloggedin === false ? "offline" : base ?? "offline";
    presence.set(agentKey, { presence: p, name: row.msdyn_isagentloggedin === false ? "Signed out" : String(row.msdyn_currentpresenceid?.msdyn_name ?? PRESENCE_LABELS[p]) });
  });

  const open: LiveConversation[] = [];
  const recent = new Map<string, number>();
  const sinceTime = Date.parse(rows.since);
  rows.conversations.forEach((row) => {
    const conversation: LiveConversation = {
      id: id(row.msdyn_ocliveworkitemid) ?? "",
      status: row.statuscode === WRAP_UP ? "wrap-up" : row.statuscode === OPEN && !row._msdyn_activeagentid_value ? "waiting" : "with-agent",
      queueKey: known(`queue:${id(row._msdyn_cdsqueueid_value)}`),
      agentKey: known(`agent:${id(row._msdyn_activeagentid_value)}`),
      workstreamKey: known(`workstream:${id(row._msdyn_liveworkstreamid_value)}`)
    };
    if (row.statecode === 0) open.push(conversation);
    if (Date.parse(row.createdon) >= sinceTime) {
      [conversation.queueKey, conversation.workstreamKey].forEach((k) => { if (k) recent.set(k, (recent.get(k) ?? 0) + 1); });
    }
  });

  return { readAt, since: rows.since, presence, open, recent };
}

// The lines the details panel shows for a record while live activity is on.
export function liveDetails(key: string, live: Live): [string, string][] {
  const kind = key.split(":")[0];
  const count = (status: ConversationStatus, where: (c: LiveConversation) => boolean) => live.open.filter((c) => c.status === status && where(c)).length;
  if (kind === "agent") {
    const p = live.presence.get(key);
    const mine = (c: LiveConversation) => c.agentKey === key;
    return [["Presence", p ? p.name : "Unknown"], ["Conversations now", String(live.open.filter(mine).length)]];
  }
  if (kind === "queue" || kind === "workstream") {
    const here = (c: LiveConversation) => (kind === "queue" ? c.queueKey : c.workstreamKey) === key;
    return [
      ["Waiting now", String(count("waiting", here))],
      ["With an agent now", String(count("with-agent", here) + count("wrap-up", here))],
      ["Last 24 hours", String(live.recent.get(key) ?? 0)]
    ];
  }
  return [];
}

export function waitingByQueue(live: Live): Map<string, number> {
  const waiting = new Map<string, number>();
  live.open.forEach((c) => { if (c.status === "waiting" && c.queueKey) waiting.set(c.queueKey, (waiting.get(c.queueKey) ?? 0) + 1); });
  return waiting;
}

// Conversations that are open now but weren't at the previous read: they arrive with a flourish.
export function newArrivals(previous: Live | undefined, current: Live): LiveConversation[] {
  if (!previous) return [];
  const before = new Set(previous.open.map((c) => c.id));
  return current.open.filter((c) => !before.has(c.id));
}
