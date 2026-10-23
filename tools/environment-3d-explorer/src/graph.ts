// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { parseDecisionXml } from "../../visual-routing-tester/src/ruleXml";
import { CONDITIONS } from "../../voicemail-builder/src/overflow";
import { Graph, GraphEdge, GraphNode, NodeKind, Unread } from "./model";

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
  // The rest of the configuration around the call path. Optional: without them the path still shows.
  botUsers?: Row[];
  variables?: Row[];
  operatingHours?: Row[];
  overflowRulesets?: Row[];
  overflowActions?: Row[];
  capacityProfiles?: Row[];
  workstreamCapacity?: Row[];
  resourceCapacity?: Row[];
  businessUnits?: Row[];
  teams?: Row[];
  teamMemberships?: Row[];
  warnings: string[];
  unread: Unread[];
}

// msdyn_routingconfigurationstep.msdyn_type for the "Route to queue" step.
export const QUEUE_IDENTIFICATION = 192350002;
// The platform's own queues carry this name; they're left out.
export const SYSTEM_QUEUE_NAME = "<CDS System>";
export const VOICE_STREAM = 192440000;

const STREAM_LABELS: Record<number, string> = { 192440000: "Voice", 192350000: "Record" };
// msdyn_overflowactionconfig.msdyn_overflowactiontype, confirmed live (academyexperiment, 2026-10-23).
// "Default" (192350000) is the platform's own placeholder and isn't drawn.
const OVERFLOW_TYPES: Record<number, string> = {
  192350001: "End conversation", 192350002: "Transfer to phone", 192350003: "Direct callback", 192350004: "Voicemail",
  192350005: "Queue transfer", 192350006: "Remain in queue", 192350007: "Scheduled callback"
};
const QUEUE_TRANSFER = 192350005;
const VARIABLE_TYPES: Record<number, string> = { 192350000: "Text", 192350001: "Number", 192350002: "Boolean", 192350100: "Entity reference" };
const OVERFLOW_ACTION_LHS = "overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid";

// The overflow condition a rule sets, by the names Voicemail Builder verified live ("overflow.operatinghouroverflow"
// is "Out of operating hours"); any other flag is spelled out the way Visual Routing Tester does.
function overflowTrigger(lhs: string): string | undefined {
  const known = Object.values(CONDITIONS).find((c) => lhs === `overflow.${c.flag}`);
  if (known) return known.label;
  const match = lhs.match(/^overflow\.(\w+)overflow$/i);
  return match ? match[1].replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()) : undefined;
}
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
    const defaultQueue = id(w._msdyn_defaultqueue_value);
    add({
      key: key("workstream", wsId), kind: "workstream", name: str(w.msdyn_name) || "(unnamed workstream)", recordId: wsId,
      details: [["Channel", STREAM_LABELS[w.msdyn_streamsource] ?? `Other (${w.msdyn_streamsource ?? "unknown"})`]],
      facts: { voice: w.msdyn_streamsource === VOICE_STREAM, missingQueues: defaultQueue && !queueIds.has(defaultQueue) ? 1 : 0 }
    });
    if (defaultQueue) link(key("workstream", wsId), key("queue", defaultQueue), "default");

    // A workstream's bot (a Copilot Studio agent, as a user) answers before routing. One node per
    // workstream, so a bot shared by two workstreams doesn't join their routes.
    const botUserId = id(w._msdyn_bot_user_value);
    if (botUserId) {
      const botUser = (raw.botUsers ?? []).find((u) => id(u.systemuserid) === botUserId);
      add({ key: `bot:${wsId}`, kind: "bot", name: str(botUser?.fullname) || "Bot", recordId: botUserId, details: [["Workstream", str(w.msdyn_name)]] });
      link(`bot:${wsId}`, key("workstream", wsId), "handoff");
    }
  });

  // Context variables, next to their workstream.
  (raw.variables ?? []).forEach((v) => {
    const variableId = id(v.msdyn_ocliveworkstreamcontextvariableid);
    const wsId = id(v._msdyn_liveworkstreamid_value);
    if (!variableId || !wsId || !nodes.has(key("workstream", wsId))) return;
    add({ key: key("variable", variableId), kind: "variable", name: str(v.msdyn_name) || "(unnamed variable)", recordId: variableId, details: [["Type", VARIABLE_TYPES[v.msdyn_datatype] ?? "Unknown"]] });
    link(key("workstream", wsId), key("variable", variableId), "variable");
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
    if (wsId && nodes.has(`bot:${wsId}`)) link(key("channel", channelId), `bot:${wsId}`, "bot");
    else if (wsId) link(key("channel", channelId), key("workstream", wsId), "channel");
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
          const targets = rule.distributionRecords.length
            ? rule.distributionRecords.map((record) => ({
              queueId: id(record.find((sa) => sa.lhs === "queuedetails.queueid")?.rhs),
              weight: record.find((sa) => sa.lhs === "queuedetails.percentage")?.rhs
            }))
            : [{ queueId: id(rule.setAttributes.find((sa) => sa.lhs === "assign_to.queue")?.rhs), weight: undefined }];
          const ruleKey = add({
            key: `rule:${rulesetId}:${rule.id}`, kind: "rule", name: rule.name, recordId: rulesetId,
            details: [
              ["Workstream", str(w.msdyn_name)], ["Order", String(index + 1)],
              ["Condition", describeConditions(rule.conditions, rule.conditionLogic)],
              ["Enabled", disabled.includes(rule.id) ? "No" : "Yes"]
            ],
            facts: { disabled: disabled.includes(rule.id), missingQueues: targets.filter((t) => t.queueId && !queueIds.has(t.queueId)).length }
          });
          link(key("workstream", wsId), ruleKey, "routes");
          targets.forEach((t) => {
            if (t.queueId) link(ruleKey, key("queue", t.queueId), "routes", t.weight ? `${t.weight}%` : undefined);
          });
        });
      });
  });

  // Queue -> agent. Only users who are a member of an omnichannel queue are agents here.
  const usersById = new Map(raw.users.map((u) => [id(u.systemuserid), u]));
  const usersWithResource = new Set(raw.resources.map((r) => id(r._userid_value)));
  raw.memberships.forEach((m) => {
    const queueId = id(m.queueid);
    const userId = id(m.systemuserid);
    const user = userId ? usersById.get(userId) : undefined;
    if (!queueId || !userId || !user || !queueIds.has(queueId)) return;
    const agentKey = add({
      key: key("agent", userId), kind: "agent", name: str(user.fullname) || str(user.domainname) || "(unnamed user)", recordId: userId,
      details: [["Sign-in", str(user.domainname)], ["Disabled", yesNo(user.isdisabled)]],
      facts: { disabled: user.isdisabled === true, hasResource: usersWithResource.has(userId) }
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

  // Operating hours, in front of the queues that use them.
  const hoursById = new Map((raw.operatingHours ?? []).map((h) => [id(h.msdyn_operatinghourid), h]));
  raw.queues.forEach((q) => {
    const queueId = id(q.queueid);
    const hoursId = id(q._msdyn_operatinghourid_value);
    if (!queueId || !hoursId || !nodes.has(key("queue", queueId))) return;
    add({ key: key("hours", hoursId), kind: "hours", name: str(hoursById.get(hoursId)?.msdyn_name) || "Operating hours", recordId: hoursId, details: [] });
    link(key("hours", hoursId), key("queue", queueId), "hours");
  });

  // Overflow: a branch off the queue per action its overflow rules take. A queue transfer goes on to its queue.
  const overflowRulesets = new Map((raw.overflowRulesets ?? []).map((r) => [id(r.msdyn_decisionrulesetid), r]));
  const actions = new Map((raw.overflowActions ?? []).map((a) => [id(a.msdyn_overflowactionconfigid), a]));
  raw.queues.forEach((q) => {
    const queueId = id(q.queueid);
    if (!queueId || !nodes.has(key("queue", queueId))) return;
    ([["Before queuing", q._msdyn_prequeueoverflowrulesetid_value], ["In queue", q._msdyn_inqueueoverflowrulesetid_value]] as const).forEach(([stage, rulesetValue]) => {
      const ruleset = overflowRulesets.get(id(rulesetValue));
      const decision = ruleset ? parseDecisionXml(str(ruleset.msdyn_rulesetdefinition)) : undefined;
      decision?.rules.forEach((rule) => {
        const actionId = id(rule.setAttributes.find((sa) => sa.lhs === OVERFLOW_ACTION_LHS)?.rhs);
        const action = actionId ? actions.get(actionId) : undefined;
        const type = OVERFLOW_TYPES[action?.msdyn_overflowactiontype];
        if (!actionId || !action || !type) return;
        const trigger = rule.setAttributes.map((sa) => overflowTrigger(sa.lhs)).find(Boolean) ?? rule.name;
        const overflowKey = `overflow:${queueId}:${actionId}`;
        const existing = nodes.get(overflowKey);
        if (existing) existing.details.push(["When", `${trigger} (${stage.toLowerCase()})`]);
        else add({ key: overflowKey, kind: "overflow", name: type, recordId: actionId, details: [["Queue", str(q.name)], ["Action", str(action.msdyn_name)], ["When", `${trigger} (${stage.toLowerCase()})`]] });
        link(key("queue", queueId), overflowKey, "overflow", trigger);
        if (action.msdyn_overflowactiontype === QUEUE_TRANSFER) {
          const target = id(action.msdyn_overflowactiondata);
          if (target) link(overflowKey, key("queue", target), "transfer");
        }
      });
    });
  });

  // Capacity profiles: the workstreams that use them and the agents who have them.
  const profiles = new Map((raw.capacityProfiles ?? []).map((p) => [id(p.msdyn_capacityprofileid), p]));
  const profile = (profileId: string | undefined) => {
    const p = profileId ? profiles.get(profileId) : undefined;
    return p && profileId ? add({ key: key("capacity", profileId), kind: "capacity", name: str(p.msdyn_name) || "(unnamed profile)", recordId: profileId, details: [] }) : undefined;
  };
  (raw.workstreamCapacity ?? []).forEach((wc) => {
    const wsKey = key("workstream", id(wc._msdyn_workstream_id_value) ?? "");
    const profileKey = nodes.has(wsKey) ? profile(id(wc._msdyn_capacityprofile_id_value)) : undefined;
    if (profileKey) link(wsKey, profileKey, "capacity");
  });
  (raw.resourceCapacity ?? []).forEach((rc) => {
    const userId = userByResource.get(id(rc._msdyn_bookableresourceid_value));
    const agentKey = userId ? key("agent", userId) : "";
    const profileKey = nodes.has(agentKey) ? profile(id(rc._msdyn_capacityprofileid_value)) : undefined;
    if (profileKey) link(agentKey, profileKey, "capacity");
  });

  // Teams (not the business units' default teams, which every user is in) and business units, behind the agents.
  const teamsById = new Map((raw.teams ?? []).filter((t) => t.isdefault !== true).map((t) => [id(t.teamid), t]));
  (raw.teamMemberships ?? []).forEach((tm) => {
    const agentKey = key("agent", id(tm.systemuserid) ?? "");
    const teamId = id(tm.teamid);
    const team = teamId ? teamsById.get(teamId) : undefined;
    if (!team || !teamId || !nodes.has(agentKey)) return;
    add({ key: key("team", teamId), kind: "team", name: str(team.name) || "(unnamed team)", recordId: teamId, details: [] });
    link(agentKey, key("team", teamId), "team");
  });
  const unitsById = new Map((raw.businessUnits ?? []).map((b) => [id(b.businessunitid), b]));
  raw.users.forEach((u) => {
    const agentKey = key("agent", id(u.systemuserid) ?? "");
    const unitId = id(u._businessunitid_value);
    const unit = unitId ? unitsById.get(unitId) : undefined;
    if (!unit || !unitId || !nodes.has(agentKey)) return;
    add({ key: key("businessunit", unitId), kind: "businessunit", name: str(unit.name) || "(unnamed business unit)", recordId: unitId, details: [] });
    link(agentKey, key("businessunit", unitId), "businessunit");
  });

  return { nodes: [...nodes.values()], edges, warnings, unread: [...raw.unread] };
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
