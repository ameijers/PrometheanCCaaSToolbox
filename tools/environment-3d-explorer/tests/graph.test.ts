// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph, chainOf, RawEnvironment } from "../src/graph";
import { demoRaw } from "../src/demoData";

const empty = (): RawEnvironment => ({
  phoneNumbers: [], channels: [], workstreams: [], routingConfigurations: [], routingSteps: [], rulesets: [],
  queues: [], memberships: [], users: [], resources: [], resourceSkills: [], warnings: []
});

const Q1 = "11111111-0000-4000-8000-000000000001";
const Q2 = "11111111-0000-4000-8000-000000000002";
const RS = "22222222-0000-4000-8000-000000000001";

function small(): RawEnvironment {
  const raw = empty();
  raw.phoneNumbers.push({ msdyn_ocphonenumberid: "P1", msdyn_phonenumber: "+31 20 555 0101", statecode: 0, msdyn_phoneinboundenabled: true });
  raw.channels.push({ msdyn_ocvoicechannelsettingid: "C1", msdyn_name: "Sales line", _msdyn_phonenumberid_value: "p1", _msdyn_liveworkstreamid_value: "W1" });
  raw.workstreams.push({ msdyn_liveworkstreamid: "{W1}", msdyn_name: "Sales", msdyn_streamsource: 192440000, _msdyn_defaultqueue_value: Q2 });
  raw.routingConfigurations.push({ msdyn_routingconfigurationid: "RC-OLD", msdyn_isactiveconfiguration: false, _msdyn_liveworkstreamid_value: "w1" });
  raw.routingConfigurations.push({ msdyn_routingconfigurationid: "RC", msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: "w1" });
  raw.routingSteps.push({ msdyn_type: 192350002, _msdyn_routingconfigurationid_value: "rc", _msdyn_rulesetid_value: RS });
  raw.routingSteps.push({ msdyn_type: 192350002, _msdyn_routingconfigurationid_value: "rc-old", _msdyn_rulesetid_value: "unused" });
  raw.rulesets.push({
    msdyn_decisionrulesetid: RS, msdyn_disabledrules: "r2",
    msdyn_rulesetdefinition: `<decision hit-policy="first"><rules>
      <rule id="r1" name="Billing"><logical operator="AND"><condition operator="equals"><lhs type="attribute">liveworkitemcontext.Menu</lhs><rhs type="staticvalue">1</rhs></condition></logical>
        <action><setattribute><lhs type="attribute">assign_to.queue</lhs><rhs type="staticvalue">{${Q1.toUpperCase()}}</rhs></setattribute></action></rule>
      <rule id="r2" name="Split"><action><upsertrecords><target>percentagebaseddistribution</target><records>
        <record><setattribute><lhs>queuedetails.queueid</lhs><rhs>${Q1}</rhs></setattribute><setattribute><lhs>queuedetails.percentage</lhs><rhs>60</rhs></setattribute></record>
        <record><setattribute><lhs>queuedetails.queueid</lhs><rhs>${Q2}</rhs></setattribute><setattribute><lhs>queuedetails.percentage</lhs><rhs>40</rhs></setattribute></record>
      </records></upsertrecords></action></rule></rules></decision>`
  });
  raw.queues.push({ queueid: Q1, name: "Billing", msdyn_queuetype: 192350002 }, { queueid: Q2, name: "Overflow", msdyn_queuetype: 192350002 }, { queueid: "SYS", name: "<CDS System>" });
  raw.memberships.push({ queueid: Q1, systemuserid: "U1" }, { queueid: Q2, systemuserid: "U2" }, { queueid: "not-omnichannel", systemuserid: "U3" });
  raw.users.push({ systemuserid: "U1", fullname: "Ava Jansen", domainname: "ava@contoso.example" }, { systemuserid: "U2", fullname: "Liam Bos" }, { systemuserid: "U3", fullname: "Back Office" });
  raw.resources.push({ bookableresourceid: "BR1", _userid_value: "u1" });
  raw.resourceSkills.push({ _resource_value: "br1", Characteristic: { characteristicid: "S1", name: "Billing" }, RatingValue: { name: "Expert" } });
  raw.resourceSkills.push({ _resource_value: "br1", Characteristic: { name: "Dutch" } });
  return raw;
}

describe("buildGraph", () => {
  test("links phone number -> channel -> workstream -> rules -> queues -> agents -> skills", () => {
    const graph = buildGraph(small());
    const edges = graph.edges.map((e) => `${e.from} > ${e.to} (${e.kind}${e.label ? ` ${e.label}` : ""})`);
    expect(edges.sort()).toEqual([
      "phone:p1 > channel:c1 (number)",
      "channel:c1 > workstream:w1 (channel)",
      `workstream:w1 > queue:${Q2} (default)`,
      `workstream:w1 > rule:${RS}:r1 (routes)`,
      `workstream:w1 > rule:${RS}:r2 (routes)`,
      `rule:${RS}:r1 > queue:${Q1} (routes)`,
      `rule:${RS}:r2 > queue:${Q1} (routes 60%)`,
      `rule:${RS}:r2 > queue:${Q2} (routes 40%)`,
      `queue:${Q1} > agent:u1 (member)`,
      `queue:${Q2} > agent:u2 (member)`,
      "agent:u1 > skill:s1 (skill Expert)",
      "agent:u1 > skill:name:dutch (skill)"
    ].sort());
  });

  test("leaves out the system queue, inactive routing and users who aren't in an omnichannel queue", () => {
    const graph = buildGraph(small());
    const names = graph.nodes.map((n) => n.name);
    expect(names).not.toContain("<CDS System>");
    expect(names).not.toContain("Back Office");
    expect(graph.nodes.filter((n) => n.kind === "rule")).toHaveLength(2);
  });

  test("shows a disabled rule as disabled", () => {
    const rule = buildGraph(small()).nodes.find((n) => n.key === `rule:${RS}:r2`)!;
    expect(rule.details).toContainEqual(["Enabled", "No"]);
    expect(rule.recordId).toBe(RS);
  });

  test("warns about a route-to-queue ruleset it can't read", () => {
    const raw = small();
    raw.rulesets[0].msdyn_rulesetdefinition = "not xml";
    expect(buildGraph(raw).warnings).toEqual(["The route-to-queue rules of \"Sales\" couldn't be read."]);
  });

  test("the sample environment builds into a connected graph", () => {
    const graph = buildGraph(demoRaw());
    const kinds = new Set(graph.nodes.map((n) => n.kind));
    expect([...kinds].sort()).toEqual(["agent", "channel", "phone", "queue", "rule", "skill", "workstream"]);
    const keys = new Set(graph.nodes.map((n) => n.key));
    graph.edges.forEach((e) => { expect(keys.has(e.from)).toBe(true); expect(keys.has(e.to)).toBe(true); });
    expect(graph.warnings).toEqual([]);
  });
});

describe("chainOf", () => {
  test("a workstream's chain is everything in front of it and everything behind it", () => {
    const graph = buildGraph(small());
    expect([...chainOf(graph, "workstream:w1")].sort()).toEqual([
      "agent:u1", "agent:u2", "channel:c1", "phone:p1", `queue:${Q1}`, `queue:${Q2}`, `rule:${RS}:r1`, `rule:${RS}:r2`, "skill:name:dutch", "skill:s1", "workstream:w1"
    ].sort());
  });

  test("a queue's chain doesn't pull in its sibling queues", () => {
    const graph = buildGraph(small());
    const chain = chainOf(graph, `queue:${Q1}`);
    expect(chain.has("workstream:w1")).toBe(true);
    expect(chain.has("phone:p1")).toBe(true);
    expect(chain.has("agent:u1")).toBe(true);
    expect(chain.has(`queue:${Q2}`)).toBe(false);
    expect(chain.has("agent:u2")).toBe(false);
  });
});
