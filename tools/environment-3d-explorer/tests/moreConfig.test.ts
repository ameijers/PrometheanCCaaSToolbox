// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph, RawEnvironment } from "../src/graph";
import { findIssues } from "../src/health";
import { extendRide } from "../src/ride";

const Q_MAIN = "11111111-0000-4000-8000-000000000001";
const Q_TIER2 = "11111111-0000-4000-8000-000000000002";
const Q_HOURS_ONLY = "11111111-0000-4000-8000-000000000003";
const RS_OVERFLOW = "33333333-0000-4000-8000-000000000001";
const VOICEMAIL = "44444444-0000-4000-8000-000000000001";
const TRANSFER = "44444444-0000-4000-8000-000000000002";
const DEFAULT_ACTION = "44444444-0000-4000-8000-000000000003";

const overflowRule = (ruleId: string, flag: string, action: string) =>
  `<rule id="${ruleId}" name="${ruleId}"><action><setattribute><lhs>overflow.${flag}</lhs><rhs>true</rhs></setattribute><setattribute><lhs>overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs><rhs>${action}</rhs></setattribute></action></rule>`;

function environment(): RawEnvironment {
  return {
    phoneNumbers: [{ msdyn_ocphonenumberid: "P1", msdyn_phonenumber: "+31 1" }],
    channels: [{ msdyn_ocvoicechannelsettingid: "C1", msdyn_name: "Main line", _msdyn_phonenumberid_value: "P1", _msdyn_liveworkstreamid_value: "W1" }],
    workstreams: [{ msdyn_liveworkstreamid: "W1", msdyn_name: "Main", msdyn_streamsource: 192440000, _msdyn_defaultqueue_value: Q_MAIN, _msdyn_bot_user_value: "B1" }],
    routingConfigurations: [], routingSteps: [], rulesets: [],
    queues: [
      { queueid: Q_MAIN, name: "Main", _msdyn_prequeueoverflowrulesetid_value: RS_OVERFLOW, _msdyn_inqueueoverflowrulesetid_value: RS_OVERFLOW, _msdyn_operatinghourid_value: "H1" },
      { queueid: Q_TIER2, name: "Tier 2" },
      { queueid: Q_HOURS_ONLY, name: "Hours only", _msdyn_operatinghourid_value: "H1" }
    ],
    memberships: [{ queueid: Q_MAIN, systemuserid: "U1" }, { queueid: Q_TIER2, systemuserid: "U1" }, { queueid: Q_HOURS_ONLY, systemuserid: "U1" }],
    users: [{ systemuserid: "U1", fullname: "Ava", _businessunitid_value: "BU1" }],
    resources: [{ bookableresourceid: "R1", _userid_value: "U1" }],
    resourceSkills: [],
    botUsers: [{ systemuserid: "B1", fullname: "Claims IVR (Microsoft Copilot Studio)" }],
    variables: [{ msdyn_ocliveworkstreamcontextvariableid: "V1", msdyn_name: "SelectedMenuItem", msdyn_datatype: 192350000, _msdyn_liveworkstreamid_value: "W1" }],
    operatingHours: [{ msdyn_operatinghourid: "H1", msdyn_name: "Workdays" }],
    overflowRulesets: [{ msdyn_decisionrulesetid: RS_OVERFLOW, msdyn_rulesetdefinition: `<decision hit-policy="first"><rules>${
      overflowRule("o1", "operatinghouroverflow", VOICEMAIL)}${overflowRule("o2", "lapsedwaittimeoverflow", TRANSFER)}${overflowRule("o3", "queuesizeoverflow", DEFAULT_ACTION)}</rules></decision>` }],
    overflowActions: [
      { msdyn_overflowactionconfigid: VOICEMAIL, msdyn_name: "Voicemail", msdyn_overflowactiontype: 192350004 },
      { msdyn_overflowactionconfigid: TRANSFER, msdyn_name: "QueueTransfer_Tier2", msdyn_overflowactiontype: 192350005, msdyn_overflowactiondata: Q_TIER2 },
      { msdyn_overflowactionconfigid: DEFAULT_ACTION, msdyn_name: "workstream-x", msdyn_overflowactiontype: 192350000 }
    ],
    capacityProfiles: [{ msdyn_capacityprofileid: "CP1", msdyn_name: "Default voice inbound" }],
    workstreamCapacity: [{ _msdyn_workstream_id_value: "W1", _msdyn_capacityprofile_id_value: "CP1" }],
    resourceCapacity: [{ _msdyn_bookableresourceid_value: "R1", _msdyn_capacityprofileid_value: "CP1" }],
    businessUnits: [{ businessunitid: "BU1", name: "Contoso Support" }],
    teams: [{ teamid: "T1", name: "Contoso Support", isdefault: true }, { teamid: "T2", name: "Evening shift", isdefault: false }],
    teamMemberships: [{ systemuserid: "U1", teamid: "T1" }, { systemuserid: "U1", teamid: "T2" }],
    warnings: [], unread: []
  };
}

const edges = (raw: RawEnvironment) => buildGraph(raw).edges.map((e) => `${e.from} > ${e.to} (${e.kind}${e.label ? ` ${e.label}` : ""})`).sort();

describe("the configuration around the call path", () => {
  test("links bot, variables, hours, overflow, capacity, teams and business units", () => {
    expect(edges(environment())).toEqual([
      "agent:u1 > businessunit:bu1 (businessunit)",
      "agent:u1 > capacity:cp1 (capacity)",
      "agent:u1 > team:t2 (team)",
      "bot:w1 > workstream:w1 (handoff)",
      "channel:c1 > bot:w1 (bot)",
      "hours:h1 > queue:" + Q_HOURS_ONLY + " (hours)",
      "hours:h1 > queue:" + Q_MAIN + " (hours)",
      "overflow:" + Q_MAIN + ":" + TRANSFER + " > queue:" + Q_TIER2 + " (transfer)",
      "phone:p1 > channel:c1 (number)",
      "queue:" + Q_HOURS_ONLY + " > agent:u1 (member)",
      "queue:" + Q_MAIN + " > agent:u1 (member)",
      "queue:" + Q_MAIN + " > overflow:" + Q_MAIN + ":" + TRANSFER + " (overflow Wait time)",
      "queue:" + Q_MAIN + " > overflow:" + Q_MAIN + ":" + VOICEMAIL + " (overflow Out of operating hours)",
      "queue:" + Q_TIER2 + " > agent:u1 (member)",
      "workstream:w1 > capacity:cp1 (capacity)",
      "workstream:w1 > queue:" + Q_MAIN + " (default)",
      "workstream:w1 > variable:v1 (variable)"
    ].sort());
  });

  test("names records the way the admin center does, and lists when an overflow action applies", () => {
    const graph = buildGraph(environment());
    const node = (k: string) => graph.nodes.find((n) => n.key === k)!;
    expect(node("bot:w1").name).toBe("Claims IVR (Microsoft Copilot Studio)");
    expect(node("bot:w1").recordId).toBe("b1");
    const voicemail = node(`overflow:${Q_MAIN}:${VOICEMAIL}`);
    expect(voicemail.name).toBe("Voicemail");
    // The same rules sit in both stages here, so the action applies at both.
    expect(voicemail.details.filter(([label]) => label === "When").map(([, v]) => v)).toEqual(["Out of operating hours (before queuing)", "Out of operating hours (in queue)"]);
    expect(graph.nodes.some((n) => n.key.includes(DEFAULT_ACTION))).toBe(false);
    expect(node("variable:v1").details).toEqual([["Type", "Text"]]);
  });

  test("a ride goes through the bot and can take the overflow on to another queue", () => {
    const graph = buildGraph(environment());
    expect(extendRide(graph, ["phone:p1"]).path).toEqual(["phone:p1", "channel:c1", "bot:w1", "workstream:w1", `queue:${Q_MAIN}`]);
    expect(extendRide(graph, [`overflow:${Q_MAIN}:${TRANSFER}`]).path).toEqual([`overflow:${Q_MAIN}:${TRANSFER}`, `queue:${Q_TIER2}`, "agent:u1"]);
  });

  test("health: a bot's channel counts for its workstream, a transfer reaches a queue, operating hours don't", () => {
    const checks = findIssues(buildGraph(environment())).map((i) => `${i.key} ${i.check}`);
    expect(checks).not.toContain("workstream:w1 no-channel");
    expect(checks).not.toContain(`queue:${Q_TIER2} unreachable`);
    expect(checks).toContain(`queue:${Q_HOURS_ONLY} unreachable`);
  });

  test("everything around the call path is optional", () => {
    const raw = environment();
    ["botUsers", "variables", "operatingHours", "overflowRulesets", "overflowActions", "capacityProfiles", "workstreamCapacity", "resourceCapacity", "businessUnits", "teams", "teamMemberships"]
      .forEach((k) => delete (raw as any)[k]);
    const graph = buildGraph(raw);
    expect(graph.nodes.find((n) => n.key === "bot:w1")?.name).toBe("Bot");
    expect(graph.nodes.filter((n) => ["overflow", "capacity", "team", "businessunit", "variable"].includes(n.kind))).toEqual([]);
  });
});
