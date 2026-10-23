// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { parseDecisionXml } from "../../visual-routing-tester/src/ruleXml";
import { Graph, GraphEdge, GraphNode, NodeKind } from "./model";

// Turns the rows dataverse.ts (or demoData.ts) read into the graph the scene draws. Pure: no Xrm.

type Row = Record<string, any>;

export interface RawEnvironment {
  phoneNumbers: Row[];
  channels: Row[];
  workstreams: Row[];
  routingConfigurations: Row[];
  routingSteps: Row[];
  rulesets: Row[];
  queues: Row[];
  memberships: Row[];
  users: Row[];
  resources: Row[];
  resourceSkills: Row[];
  warnings: string[];
}

// msdyn_routingconfigurationstep.msdyn_type for the "Route to queue" step.
export const QUEUE_IDENTIFICATION = 192350002;
// The platform's own queues carry this name; they're left out.
export const SYSTEM_QUEUE_NAME = "<CDS System>";

const STREAM_LABELS: Record<number, string> = { 192440000: "Voice", 192350000: "Record" };
const QUEUE_TYPE_LABELS: Record<number, string> = { 192350002: "Voice", 192350000: "Messaging", 192350001: "Record" };

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const id = (value: unknown): string | undefined => (typeof value === "string" && value ? value.replace(/[{}]/g, "").toLowerCase() : undefined);
const key = (kind: NodeKind, recordId: string) => `${kind}:${recordId}`;
const yesNo = (value: unknown) => (value === true ? "Yes" : value === false ? "No" : "Unknown");

function describeConditions(conditions: { operator: string; lhs: string; rhs?: string }[], logic: string): string {
  if (!conditions.length) return "Always";
  return conditions.map((c) => `${c.lhs.replace(/^liveworkitemcontext\./, "")} ${c.operator}${c.rhs !== undefined ? ` ${c.rhs}` : ""}`).join(` ${logic} `);
}

export function buildGraph(raw: RawEnvironment): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const warnings = [...raw.warnings];
  const add = (node: GraphNode) => { if (!nodes.has(node.key)) nodes.set(node.key, node); return node.key; };
  const link = (from: string, to: string, kind: GraphEdge["kind"], label?: string) => {
    if (nodes.has(from) && nodes.has(to) && !edges.some((e) => e.from === from && e.to === to && e.kind === kind)) edges.push({ from, to, kind, label });
  };

  // Queues first: rules, default queues and memberships all point at them.
  const queueIds = new Set<string>();
  raw.queues.filter((q) => str(q.name) !== SYSTEM_QUEUE_NAME).forEach((q) => {
    const queueId = id(q.queueid);
    if (!queueId) return;
    queueIds.add(queueId);
    add({
      key: key("queue", queueId), kind: "queue", name: str(q.name) || "(unnamed queue)", recordId: queueId,
      details: [["Type", QUEUE_TYPE_LABELS[q.msdyn_queuetype] ?? "Unknown"], ["Members", String(raw.memberships.filter((m) => id(m.queueid) === queueId).length)]]
    });
  });

  raw.workstreams.forEach((w) => {
    const wsId = id(w.msdyn_liveworkstreamid);
    if (!wsId) return;
    add({
      key: key("workstream", wsId), kind: "workstream", name: str(w.msdyn_name) || "(unnamed workstream)", recordId: wsId,
      details: [["Channel", STREAM_LABELS[w.msdyn_streamsource] ?? `Other (${w.msdyn_streamsource ?? "unknown"})`]]
    });
    const defaultQueue = id(w._msdyn_defaultqueue_value);
    if (defaultQueue) link(key("workstream", wsId), key("queue", defaultQueue), "default");
  });

  // Phone number -> voice channel -> workstream.
  raw.phoneNumbers.forEach((n) => {
    const numberId = id(n.msdyn_ocphonenumberid);
    if (!numberId) return;
    add({
      key: key("phone", numberId), kind: "phone", name: str(n.msdyn_phonenumber) || "(no number)", recordId: numberId,
      details: [["Active", yesNo(n.statecode === 0)], ["Inbound", yesNo(n.msdyn_phoneinboundenabled)], ["Outbound", yesNo(n.msdyn_phoneoutboundenabled)]]
    });
  });
  raw.channels.forEach((c) => {
    const channelId = id(c.msdyn_ocvoicechannelsettingid);
    if (!channelId) return;
    const numberId = id(c._msdyn_phonenumberid_value);
    add({
      key: key("channel", channelId), kind: "channel", name: str(c.msdyn_name) || "(unnamed channel)", recordId: channelId,
      details: [["Phone number", numberId ? "Linked" : "None yet"]]
    });
    if (numberId) link(key("phone", numberId), key("channel", channelId), "number");
    const wsId = id(c._msdyn_liveworkstreamid_value);
    if (wsId) link(key("channel", channelId), key("workstream", wsId), "channel");
  });

  // Workstream -> its active routing configuration's route-to-queue rules -> queues.
  const rulesetById = new Map(raw.rulesets.map((r) => [id(r.msdyn_decisionrulesetid), r]));
  raw.workstreams.forEach((w) => {
    const wsId = id(w.msdyn_liveworkstreamid);
    if (!wsId) return;
    const active = raw.routingConfigurations.find((c) => id(c._msdyn_liveworkstreamid_value) === wsId && c.msdyn_isactiveconfiguration === true);
    if (!active) return;
    const configId = id(active.msdyn_routingconfigurationid);
    raw.routingSteps
      .filter((s) => id(s._msdyn_routingconfigurationid_value) === configId && s.msdyn_type === QUEUE_IDENTIFICATION)
      .forEach((step) => {
        const rulesetId = id(step._msdyn_rulesetid_value);
        const ruleset = rulesetId ? rulesetById.get(rulesetId) : undefined;
        if (!rulesetId || !ruleset) return;
        const decision = parseDecisionXml(str(ruleset.msdyn_rulesetdefinition));
        if (!decision) {
          warnings.push(`The route-to-queue rules of "${str(w.msdyn_name)}" couldn't be read.`);
          return;
        }
        const disabled = str(ruleset.msdyn_disabledrules);
        decision.rules.forEach((rule, index) => {
          const ruleKey = add({
            key: `rule:${rulesetId}:${rule.id}`, kind: "rule", name: rule.name, recordId: rulesetId,
            details: [
              ["Workstream", str(w.msdyn_name)], ["Order", String(index + 1)],
              ["Condition", describeConditions(rule.conditions, rule.conditionLogic)],
              ["Enabled", disabled.includes(rule.id) ? "No" : "Yes"]
            ]
          });
          link(key("workstream", wsId), ruleKey, "routes");
          const targets = rule.distributionRecords.length
            ? rule.distributionRecords.map((record) => ({
              queueId: id(record.find((sa) => sa.lhs === "queuedetails.queueid")?.rhs),
              weight: record.find((sa) => sa.lhs === "queuedetails.percentage")?.rhs
            }))
            : [{ queueId: id(rule.setAttributes.find((sa) => sa.lhs === "assign_to.queue")?.rhs), weight: undefined }];
          targets.forEach((t) => {
            if (t.queueId) link(ruleKey, key("queue", t.queueId), "routes", t.weight ? `${t.weight}%` : undefined);
          });
        });
      });
  });

  // Queue -> agent. Only users who are a member of an omnichannel queue are agents here.
  const usersById = new Map(raw.users.map((u) => [id(u.systemuserid), u]));
  raw.memberships.forEach((m) => {
    const queueId = id(m.queueid);
    const userId = id(m.systemuserid);
    const user = userId ? usersById.get(userId) : undefined;
    if (!queueId || !userId || !user || !queueIds.has(queueId)) return;
    const agentKey = add({
      key: key("agent", userId), kind: "agent", name: str(user.fullname) || str(user.domainname) || "(unnamed user)", recordId: userId,
      details: [["Sign-in", str(user.domainname)], ["Disabled", yesNo(user.isdisabled)]]
    });
    link(key("queue", queueId), agentKey, "member");
  });

  // Agent -> skill, through the agent's bookable resource.
  const userByResource = new Map(raw.resources.map((r) => [id(r.bookableresourceid), id(r._userid_value)]));
  raw.resourceSkills.forEach((rs) => {
    const userId = userByResource.get(id(rs._resource_value));
    const skill = rs.Characteristic;
    const skillId = id(skill?.characteristicid) ?? id(rs._characteristic_value);
    // Without an id the name still tells skills apart (the record just can't be opened).
    const skillKey = skillId ? key("skill", skillId) : str(skill?.name) ? `skill:name:${str(skill.name).toLowerCase()}` : undefined;
    if (!userId || !skillKey || !nodes.has(key("agent", userId))) return;
    add({ key: skillKey, kind: "skill", name: str(skill?.name) || "(unnamed skill)", recordId: skillId, details: [] });
    link(key("agent", userId), skillKey, "skill", str(rs.RatingValue?.name) || undefined);
  });

  return { nodes: [...nodes.values()], edges, warnings };
}

// Everything upstream of a node (walking edges backwards) and everything downstream (walking
// forwards). Directions don't mix, so a queue's chain doesn't pull in its siblings.
export function chainOf(graph: Graph, start: string): Set<string> {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  graph.edges.forEach((e) => {
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
  });
  const walk = (next: Map<string, string[]>) => {
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const current = stack.pop()!;
      (next.get(current) ?? []).forEach((n) => { if (!seen.has(n)) { seen.add(n); stack.push(n); } });
    }
    return seen;
  };
  return new Set([...walk(outgoing), ...walk(incoming)]);
}
