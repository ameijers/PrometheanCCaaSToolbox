// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { demoSource } from "../src/demoData";
import { SnapshotDocument, buildDocument } from "../src/document";
import { attributeText, rulesetText } from "../src/rules";
import { takeSnapshot } from "../src/snapshot";

let doc: SnapshotDocument;
beforeAll(async () => { doc = buildDocument(await takeSnapshot(demoSource)); });

describe("buildDocument", () => {
  test("totals and every workstream, sorted by channel", () => {
    expect(doc.totals).toEqual(expect.arrayContaining([{ label: "Workstreams", value: 5 }, { label: "Queues", value: 6 }, { label: "Agents", value: 5 }, { label: "Phone numbers", value: 5 }]));
    expect(doc.workstreams.map((w) => `${w.kind}: ${w.name}`)).toEqual(["Entity records: Case routing", "Live chat: Support – Chat", "Voice call: Sales – Outbound Profile", "Voice call: Sales – Voice", "Voice call: Support – Voice"]);
    expect(doc.sample).toBe(true);
  });

  test("a workstream's settings, channels, variables, capacity and routing rules in words", () => {
    const sales = doc.workstreams.find((w) => w.name === "Sales – Voice")!;
    expect(sales.fields).toEqual(expect.arrayContaining([["Direction", "Inbound"], ["Fallback queue", "Sales – EN"], ["Bot", "Contoso IVR bot"], ["Allowed presences", "Available; Busy"]]));
    expect(sales.channels.map((c) => c.name)).toEqual(["Sales – Main line", "Sales – Dutch line"]);
    expect(sales.channels[0].fields).toEqual(expect.arrayContaining([["Phone number", "+15550100"], ["Operating hours", "Office hours"], ["Recording", "Yes"]]));
    expect(sales.channels[0].languages).toEqual(["English (United States), voice en-US-AvaMultilingualNeural, hold music Transform"]);
    expect(sales.variables).toEqual([["Customer language", "Text · CustomerLanguage"], ["VIP customer", "True or false · IsVip"]]);
    expect(sales.capacityProfiles).toEqual(["Default voice inbound"]);
    expect(sales.queues).toEqual(["Sales – EN", "Sales – NL"]);
    expect(sales.routing.map((b) => b.title)).toEqual(["Enrichment: Classify", "Queue identification: Route to queue"]);
    expect(sales.routing[1].text!.rules).toEqual([
      { name: "Dutch callers", enabled: true, when: "Customer language is \"nl-NL\"", then: "Route to queue \"Sales – NL\"" },
      { name: "Everyone else", enabled: true, when: "Always", then: "Route to queue \"Sales – EN\"" }
    ]);
    expect(sales.routing[0].text!.rules[0]).toMatchObject({ when: "VIP customer is \"true\"", then: "Set priority to \"1\"" });
  });

  test("a workstream without routing says so", () => {
    const cases = doc.workstreams.find((w) => w.name === "Case routing")!;
    expect(cases.routing).toEqual([]);
    expect(cases.routingNote).toMatch(/No routing configuration/);
  });

  test("queues: settings, who routes to them, custom assignment rules, overflow and members", () => {
    const nl = doc.queues.find((q) => q.name === "Sales – NL")!;
    expect(nl).toMatchObject({ type: "Voice", assignment: "Custom assignment", usedBy: ["Sales – Voice"], members: ["Ava Jansen", "Liam de Vries"] });
    expect(nl.methods).toHaveLength(1);
    expect(nl.methods[0]).toMatchObject({ name: "Skills first", active: true });
    expect(nl.methods[0].rulesets[0].text!.rules[0]).toMatchObject({ when: "VIP customer is \"true\"", then: "Pick agents by creation time" });
    expect(nl.methods[0].rulesets[1].text!.rules).toEqual([
      { name: "Exact skill match", enabled: true, when: "agent's skills matches exactly the conversation's required skills", then: "Pick agents by last assignment time" },
      { name: "Closest skill match", enabled: true, when: "languages contains language", then: "Pick agents by most matching skills" }
    ]);
    const support = doc.queues.find((q) => q.name === "Support – Voice")!;
    expect(support.overflow[0]).toMatchObject({ title: "Pre-queue overflow", ruleset: "Support – Voice overflow" });
    expect(support.overflow[0].text!.rules[0].then).toBe("When wait time overflows; Overflow action \"Offer a callback\"");
    expect(doc.queues.find((q) => q.name === "Sales – Outbound")!.usedBy).toEqual(["Sales – Outbound Profile"]);
  });

  test("agents with queues, skills, capacity, roles and teams; bots aren't agents", () => {
    expect(doc.agents.map((a) => a.name)).toEqual(["Ava Jansen", "Emma Brown", "Liam de Vries", "Mila Peters", "Noah Smith"]);
    expect(doc.agents[0]).toMatchObject({
      queues: ["Sales – NL", "Voicemail – Group"], skills: ["Dutch · Expert", "English · Very good"], capacityProfiles: ["Default voice inbound"],
      roles: ["Omnichannel agent", "Omnichannel supervisor"], teams: ["Contoso", "Sales team"]
    });
  });

  test("lists, the table summary and what was left out", () => {
    const numbers = doc.lists.find((l) => l.title === "Phone numbers")!;
    expect(numbers.rows[0]).toEqual(["+15550100", "Yes", "No", "Active", "Sales – Main line"]);
    expect(doc.lists.find((l) => l.title === "Rating models")!.rows).toEqual([["Proficiency", "Basic, Fair, Good, Very good, Expert"]]);
    expect(doc.lists.find((l) => l.title === "Business units and teams")!.rows.map((r) => r[0])).toEqual(["Contoso", "Contoso Support", "Sales team", "Support team"]);
    expect(doc.tables.find((t) => t.logicalName === "msdyn_ocfbpage")!.status).toBe("Not in this environment");
    expect(doc.leftOut).toEqual(["Workstreams: msdyn_apikey", "Workstreams: msdyn_secureapikey"]);
  });
});

describe("rules in words", () => {
  test("attributes", () => {
    expect(attributeText("msdyn_ocliveworkitem.msdyn_liveworkstreamid_msdyn_ocliveworkitem.msdyn_capacityrequired")).toBe("required capacity");
    expect(attributeText("liveworkitemcontext.00000000-0000-4000-a100-000000000001.Segment")).toBe("Segment");
    expect(attributeText("agent.availableCapacity")).toBe("available capacity");
  });

  test("weighted distribution, disabled rules, or-conditions and record ids", () => {
    const q1 = "11111111-1111-4111-8111-111111111111", q2 = "22222222-2222-4222-8222-222222222222";
    const xml = `<decision hit-policy="all"><rules>
      <rule id="r1" name="Split"><logical operator="OR"><condition operator="=="><lhs>liveworkitemcontext.Segment</lhs><rhs>Gold</rhs></condition><condition operator="not-null"><lhs>msdyn_ocliveworkitem.msdyn_customer</lhs></condition></logical>
        <action><upsertrecords><records><record><setattribute><lhs>queuedetails.queueid</lhs><rhs>${q1}</rhs></setattribute><setattribute><lhs>queuedetails.percentage</lhs><rhs>70</rhs></setattribute></record><record><setattribute><lhs>queuedetails.queueid</lhs><rhs>${q2}</rhs></setattribute><setattribute><lhs>queuedetails.percentage</lhs><rhs>30</rhs></setattribute></record></records></upsertrecords></action></rule>
      <rule id="r2" name="Off"><logical operator="AND"><condition operator="=="><lhs>msdyn_ocliveworkitem.msdyn_account</lhs><rhs>${q2}</rhs></condition></logical><action></action></rule>
    </rules></decision>`;
    const result = rulesetText(xml, "[\"r2\"]", new Map([[q1, "Gold"], [q2, "Silver"]]), { Segment: "Customer segment" })!;
    expect(result.hitPolicy).toBe("all");
    expect(result.rules).toEqual([
      { name: "Split", enabled: true, when: "Customer segment is \"Gold\" or customer has a value", then: "Share between \"Gold\" (70%), \"Silver\" (30%)" },
      { name: "Off", enabled: false, when: "account is \"Silver\"", then: "No action" }
    ]);
    expect(rulesetText("not xml", undefined, new Map())).toBeNull();
  });

  test("a record outside the snapshot is shown by its id, without braces", () => {
    const xml = `<decision hit-policy="first"><rules><rule id="r" name="Account"><logical operator="AND"><condition operator="=="><lhs>msdyn_ocliveworkitem.msdyn_account</lhs><rhs>{056BC9D2-849F-F111-AAAD-70A8A5B10059}</rhs></condition></logical><action></action></rule></rules></decision>`;
    expect(rulesetText(xml, undefined, new Map())!.rules[0].when).toBe("account is record 056bc9d2-849f-f111-aaad-70a8a5b10059");
  });

  test("nested groups keep their meaning", () => {
    const c = (lhs: string, rhs: string) => `<condition operator="=="><lhs>liveworkitemcontext.${lhs}</lhs><rhs>${rhs}</rhs></condition>`;
    const xml = `<decision hit-policy="first"><rules><rule id="r" name="Nested"><logical operator="AND">${c("Country", "NL")}<logical operator="OR">${c("Segment", "Gold")}${c("Segment", "Silver")}</logical></logical><action></action></rule></rules></decision>`;
    expect(rulesetText(xml, undefined, new Map())!.rules[0].when).toBe("Country is \"NL\" and (Segment is \"Gold\" or Segment is \"Silver\")");
  });
});
