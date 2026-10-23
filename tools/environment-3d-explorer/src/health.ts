// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Graph, GraphNode } from "./model";

// Structural health checks on the graph: things the picture can show, because they're about how
// records are (or aren't) linked. Pure, and it reads nothing more than the scene already has.
//
// "problem": conversations can get stuck or lost here. "warning": worth a look, but it can be on purpose
// (a queue kept for later, a number not used yet).

export type Severity = "problem" | "warning";

export interface Issue {
  key: string;
  severity: Severity;
  check: string;
  title: string;
  detail: string;
  fix: string;
}

export const SEVERITY_LABELS: Record<Severity, string> = { problem: "Problem", warning: "Warning" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function findIssues(graph: Graph): Issue[] {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const kindOf = new Map(graph.nodes.map((n) => [n.key, n.kind]));
  const nodeByKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const incomingKinds = new Map<string, string[]>();
  graph.edges.forEach((e) => incomingKinds.set(e.to, [...(incomingKinds.get(e.to) ?? []), e.kind]));
  graph.edges.forEach((e) => {
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
  });
  const into = (n: GraphNode, kind?: string) => (incoming.get(n.key) ?? []).filter((k) => !kind || kindOf.get(k) === kind);
  const out = (n: GraphNode, kind?: string) => (outgoing.get(n.key) ?? []).filter((k) => !kind || kindOf.get(k) === kind);
  const read = (what: Graph["unread"][number]) => !graph.unread.includes(what);

  const issues: Issue[] = [];
  const add = (n: GraphNode, severity: Severity, check: string, title: string, detail: string, fix: string) =>
    issues.push({ key: n.key, severity, check, title, detail, fix });

  graph.nodes.forEach((n) => {
    switch (n.kind) {
      case "workstream": {
        const rules = out(n, "rule");
        const defaultQueue = out(n, "queue");
        if (n.facts?.missingQueues) {
          add(n, "problem", "missing-default-queue", "Default queue not found",
            "The workstream's default queue isn't an active omnichannel queue: it was deleted, deactivated or isn't an omnichannel queue.",
            "Pick an active queue as the workstream's default queue.");
        }
        // A default queue that's gone is reported once, above, not again as "routes nowhere".
        if (!rules.length && !defaultQueue.length && !n.facts?.missingQueues) {
          add(n, "problem", "routes-nowhere", "Routes nowhere",
            "The workstream has no route-to-queue rules in an active routing configuration and no default queue, so its conversations have nowhere to go.",
            "Add route-to-queue rules, or set a default queue.");
        } else if (!rules.length && defaultQueue.length) {
          add(n, "warning", "no-rules", "No routing rules",
            "The workstream has no route-to-queue rules in an active routing configuration, so every conversation goes to the default queue.",
            "If that's not the intent, add route-to-queue rules.");
        }
        // Calls reach a workstream from its channels, directly or through its bot.
        const channels = [...into(n, "channel"), ...into(n, "bot").flatMap((b) => into(nodeByKey.get(b)!, "channel"))];
        if (n.facts?.voice && read("channels") && !channels.length) {
          add(n, "warning", "no-channel", "No voice channel",
            "This voice workstream has no voice channel, so no phone number leads to it and it can't receive calls.",
            "Add a voice channel with a phone number to the workstream, or remove the workstream if it's no longer used.");
        }
        break;
      }
      case "channel":
        if (read("phoneNumbers") && !into(n, "phone").length) {
          add(n, "warning", "no-number", "No phone number",
            "The voice channel has no phone number, so calls can't reach it yet.",
            "Assign a phone number to the channel (in the admin center, on the workstream's voice channel).");
        }
        break;
      case "phone":
        if (read("channels") && !out(n, "channel").length) {
          add(n, "warning", "unused-number", "Not used",
            "No voice channel uses this phone number, so calls to it don't reach the contact center. An unused number may still be billed.",
            "Assign it to a voice workstream, or release it if it's not needed.");
        }
        break;
      case "rule":
        if (n.facts?.missingQueues) {
          add(n, "problem", "missing-queue", "Routes to a queue that's gone",
            `The rule routes to ${plural(n.facts.missingQueues, "queue")} that isn't an active omnichannel queue: deleted, deactivated or not an omnichannel queue.`,
            "Edit the rule to route to an active queue.");
        }
        break;
      case "queue": {
        // Reached through routing: a rule, a default queue or another queue's overflow transfer
        // (not operating hours, which also point at the queue).
        const reached = (incomingKinds.get(n.key) ?? []).some((k) => k === "routes" || k === "default" || k === "transfer");
        const members = out(n, "agent");
        if (!members.length) {
          add(n, reached ? "problem" : "warning", "no-members", "No members",
            reached
              ? "Conversations are routed to this queue, but it has no members, so nobody can pick them up."
              : "The queue has no members.",
            "Add agents to the queue (Queue Membership does this in bulk).");
        } else if (members.every((k) => nodeByKey.get(k)?.facts?.disabled)) {
          add(n, reached ? "problem" : "warning", "only-disabled-members", "Only disabled members",
            "Every member of this queue is a disabled user, so nobody can pick up its conversations.",
            "Add active agents to the queue.");
        }
        if (!reached) {
          add(n, "warning", "unreachable", "Nothing routes here",
            "No route-to-queue rule and no workstream's default queue points at this queue, so no conversation reaches it through routing.",
            "Route to it from a workstream, or deactivate it if it's no longer used.");
        }
        break;
      }
      case "agent":
        if (n.facts?.disabled) {
          add(n, "warning", "disabled-member", "Disabled user in a queue",
            `The user is disabled but still a member of ${plural(into(n, "queue").length, "queue")}.`,
            "Remove the user from the queues.");
        } else if (read("resources") && n.facts?.hasResource === false) {
          add(n, "warning", "no-resource", "Not a bookable resource",
            "The user is a queue member but has no bookable resource, so no capacity profile or skills can be assigned, and unified routing may not assign work to them.",
            "Set the user up as a bookable resource (User Setup does this in bulk).");
        }
        break;
    }
  });

  // Problems first, then by kind as the scene orders them.
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "problem" ? -1 : 1));
}

// One severity per record: its worst.
export function worstByKey(issues: Issue[]): Map<string, Severity> {
  const worst = new Map<string, Severity>();
  issues.forEach((i) => { if (worst.get(i.key) !== "problem") worst.set(i.key, i.severity); });
  return worst;
}
