// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph, RawEnvironment } from "../src/graph";
import { demoRaw } from "../src/demoData";
import { findIssues, worstByKey } from "../src/health";
import { Unread } from "../src/model";

const Q_ROUTED = "11111111-0000-4000-8000-000000000001";
const Q_EMPTY = "11111111-0000-4000-8000-000000000002";
const Q_IDLE = "11111111-0000-4000-8000-000000000003";
const Q_GONE = "11111111-0000-4000-8000-000000000009";
const RS = "22222222-0000-4000-8000-000000000001";

const rule = (ruleId: string, queueId: string) =>
  `<rule id="${ruleId}" name="${ruleId}"><action><setattribute><lhs type="attribute">assign_to.queue</lhs><rhs type="staticvalue">${queueId}</rhs></setattribute></action></rule>`;

function environment(unread: Unread[] = []): RawEnvironment {
  return {
    phoneNumbers: [
      { msdyn_ocphonenumberid: "P1", msdyn_phonenumber: "+31 1" },
      { msdyn_ocphonenumberid: "P2", msdyn_phonenumber: "+31 2" }
    ],
    channels: [
      { msdyn_ocvoicechannelsettingid: "C1", msdyn_name: "Sales line", _msdyn_phonenumberid_value: "P1", _msdyn_liveworkstreamid_value: "W1" },
      { msdyn_ocvoicechannelsettingid: "C2", msdyn_name: "New line", _msdyn_liveworkstreamid_value: "W1" }
    ],
    workstreams: [
      { msdyn_liveworkstreamid: "W1", msdyn_name: "Sales", msdyn_streamsource: 192440000, _msdyn_defaultqueue_value: Q_ROUTED },
      { msdyn_liveworkstreamid: "W2", msdyn_name: "Orphan voice", msdyn_streamsource: 192440000, _msdyn_defaultqueue_value: Q_GONE },
      { msdyn_liveworkstreamid: "W3", msdyn_name: "Nowhere", msdyn_streamsource: 192350000 }
    ],
    routingConfigurations: [{ msdyn_routingconfigurationid: "RC", msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: "W1" }],
    routingSteps: [{ msdyn_type: 192350002, _msdyn_routingconfigurationid_value: "RC", _msdyn_rulesetid_value: RS }],
    rulesets: [{ msdyn_decisionrulesetid: RS, msdyn_rulesetdefinition: `<decision hit-policy="first"><rules>${rule("ok", Q_ROUTED)}${rule("empty", Q_EMPTY)}${rule("gone", Q_GONE)}</rules></decision>` }],
    queues: [
      { queueid: Q_ROUTED, name: "Sales" },
      { queueid: Q_EMPTY, name: "Empty" },
      { queueid: Q_IDLE, name: "Idle" }
    ],
    memberships: [
      { queueid: Q_ROUTED, systemuserid: "U1" },
      { queueid: Q_ROUTED, systemuserid: "U2" },
      { queueid: Q_IDLE, systemuserid: "U3" }
    ],
    users: [
      { systemuserid: "U1", fullname: "Ready Agent" },
      { systemuserid: "U2", fullname: "No Resource" },
      { systemuserid: "U3", fullname: "Gone Agent", isdisabled: true }
    ],
    resources: [{ bookableresourceid: "R1", _userid_value: "U1" }, { bookableresourceid: "R3", _userid_value: "U3" }],
    resourceSkills: [],
    warnings: [],
    unread
  };
}

const summary = (raw: RawEnvironment) => findIssues(buildGraph(raw)).map((i) => `${i.severity} ${i.key} ${i.check}`).sort();

describe("findIssues", () => {
  test("finds each structural problem and warning", () => {
    expect(summary(environment())).toEqual([
      "problem queue:" + Q_EMPTY + " no-members",
      "problem rule:" + RS + ":gone missing-queue",
      "problem workstream:w2 missing-default-queue",
      "problem workstream:w3 routes-nowhere",
      "warning agent:u2 no-resource",
      "warning agent:u3 disabled-member",
      "warning channel:c2 no-number",
      "warning phone:p2 unused-number",
      "warning queue:" + Q_IDLE + " only-disabled-members",
      "warning queue:" + Q_IDLE + " unreachable",
      "warning workstream:w2 no-channel"
    ].sort());
  });

  test("a healthy chain has no issues", () => {
    const keys = new Set(findIssues(buildGraph(environment())).map((i) => i.key));
    ["workstream:w1", "channel:c1", "phone:p1", `rule:${RS}:ok`, `queue:${Q_ROUTED}`, "agent:u1"].forEach((k) => expect(keys.has(k)).toBe(false));
  });

  test("skips the checks that need a table that couldn't be read", () => {
    const checks = summary(environment(["channels", "phoneNumbers", "resources"]));
    expect(checks.some((c) => /no-channel|no-number|unused-number|no-resource/.test(c))).toBe(false);
  });

  test("lists problems before warnings, and keeps each record's worst severity", () => {
    const issues = findIssues(buildGraph(environment()));
    const firstWarning = issues.findIndex((i) => i.severity === "warning");
    expect(issues.slice(firstWarning).every((i) => i.severity === "warning")).toBe(true);
    expect(worstByKey(issues).get("workstream:w2")).toBe("problem");
  });

  test("the sample environment has a few of each", () => {
    const issues = findIssues(buildGraph(demoRaw()));
    expect(issues.filter((i) => i.severity === "problem").length).toBeGreaterThan(0);
    expect(issues.filter((i) => i.severity === "warning").length).toBeGreaterThan(0);
  });
});
