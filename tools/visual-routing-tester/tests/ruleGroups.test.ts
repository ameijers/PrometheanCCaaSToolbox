// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { groupSummary, simulate } from "../src/evaluator";
import { Queue, RoutingModel, Workstream } from "../src/model";
import { isParsedGroup, ParsedGroup, parseDecisionXml, withHitPolicy, writeRuleXml } from "../src/ruleXml";

// Conditions in And/Or groups (Learn, "Configure route-to-queue rules": the condition builder, with Add row,
// Add group and Add related entity), percentage splits and classification outputs, written and read back.

const decision = (rules: string, hit: "first" | "all" = "all") => `<decision hit-policy="${hit}" version="1">\n  <rules>\n${rules}\n  </rules>\n</decision>`;

const OR_IN_AND = decision(writeRuleXml({
  id: "r1",
  name: "Sales & service",
  conditions: {
    operator: "AND",
    items: [
      { operator: "==", lhs: "liveworkitemcontext.Region", rhs: "North" },
      { operator: "OR", items: [{ operator: "==", lhs: "liveworkitemcontext.MenuItemSelected", rhs: "Sales" }, { operator: "==", lhs: "liveworkitemcontext.MenuItemSelected", rhs: "Service" }] }
    ]
  },
  action: { queueId: "q1" }
}));

describe("writeRuleXml and parseDecisionXml", () => {
  test("an Or group inside the And group is read back as nested groups", () => {
    const rule = parseDecisionXml(OR_IN_AND)!.rules[0];
    expect(rule.name).toBe("Sales & service");
    expect(rule.group.operator).toBe("AND");
    expect(rule.group.items).toHaveLength(2);
    const inner = rule.group.items[1] as ParsedGroup;
    expect(isParsedGroup(inner)).toBe(true);
    expect(inner.operator).toBe("OR");
    expect(inner.items.map((c) => !isParsedGroup(c) && c.rhs)).toEqual(["Sales", "Service"]);
    expect(rule.conditions).toHaveLength(3);
    expect(rule.setAttributes).toEqual([{ lhs: "assign_to.queue", rhs: "q1" }]);
  });

  test("a rule without conditions has no logical element and an empty group", () => {
    const xml = writeRuleXml({ id: "r", name: "Always", conditions: { operator: "AND", items: [{ operator: "OR", items: [] }] }, action: { queueId: "q" } });
    expect(xml).not.toContain("<logical");
    expect(parseDecisionXml(decision(xml))!.rules[0].group.items).toEqual([]);
  });

  test("a percentage split is written as the real upsertrecords shape", () => {
    const xml = writeRuleXml({ id: "r", name: "Split", conditions: { operator: "AND", items: [] }, action: { split: [{ queueId: "a", percentage: 70 }, { queueId: "b", percentage: 30 }] } });
    expect(xml).toContain("<target>percentagebaseddistribution</target>");
    expect(parseDecisionXml(decision(xml))!.rules[0].distributionRecords).toEqual([
      [{ lhs: "queuedetails.queueid", rhs: "{a}" }, { lhs: "queuedetails.percentage", rhs: "70" }],
      [{ lhs: "queuedetails.queueid", rhs: "{b}" }, { lhs: "queuedetails.percentage", rhs: "30" }]
    ]);
  });

  test("classification outputs are setattribute elements, and a not-null condition has no value", () => {
    const xml = writeRuleXml({
      id: "c",
      name: "VIP",
      conditions: { operator: "AND", items: [{ operator: "not-null", lhs: "liveworkitemcontext.AccountNumber" }] },
      action: { sets: [{ lhs: "msdyn_ocliveworkitem.msdyn_priorityscore", rhs: "20" }, { lhs: "liveworkitemcontext.Tier", rhs: "Gold" }] }
    });
    const rule = parseDecisionXml(decision(xml, "first"))!.rules[0];
    expect(rule.conditions).toEqual([{ operator: "not-null", lhs: "liveworkitemcontext.AccountNumber", rhs: undefined, unit: undefined }]);
    expect(rule.setAttributes).toEqual([{ lhs: "msdyn_ocliveworkitem.msdyn_priorityscore", rhs: "20" }, { lhs: "liveworkitemcontext.Tier", rhs: "Gold" }]);
  });

  test("comparison operators are written as real data has them, operator=\">=\", and read back", () => {
    const xml = writeRuleXml({ id: "r", name: "Score", conditions: { operator: "AND", items: [{ operator: ">=", lhs: "msdyn_ocliveworkitem.msdyn_priorityscore", rhs: "10" }, { operator: "<", lhs: "x", rhs: "3" }] }, action: { queueId: "q" } });
    expect(xml).toContain("<condition operator=\">=\">");
    expect(parseDecisionXml(decision(xml))!.rules[0].conditions.map((c) => c.operator)).toEqual([">=", "<"]);
    expect(parseDecisionXml(decision("    <rule id=\"r\" name=\"n\"><condition operator=\"&gt;=\"><lhs type=\"attribute\">a</lhs><rhs type=\"staticvalue\">1</rhs></condition></rule>"))!.rules[0].conditions[0].operator).toBe(">=");
  });

  test("withHitPolicy sets Hit-first or Hit-all on the decision", () => {
    expect(parseDecisionXml(withHitPolicy(OR_IN_AND, "first"))!.hitPolicy).toBe("first");
    expect(parseDecisionXml(withHitPolicy(withHitPolicy(OR_IN_AND, "first"), "all"))!.hitPolicy).toBe("all");
    expect(withHitPolicy("<decision version=\"1\"><rules></rules></decision>", "first")).toContain("hit-policy=\"first\"");
  });
});

const queue = (id: string): Queue => ({ id, name: `${id} queue`, assignmentMethod: "Round Robin", preQueueOverflowRules: [], inQueueOverflowRules: [] });

describe("simulate with condition groups", () => {
  const workstream: Workstream = {
    id: "stream",
    name: "Voice",
    active: true,
    variables: [],
    classificationRules: [],
    queueRoutingRules: [{
      id: "r1", name: "North sales or service", order: 0, hitPolicy: "all", enabled: true, conditionLogic: "AND",
      conditions: [],
      conditionGroup: { logic: "AND", items: [{ variableId: "Region", operator: "equals", value: "North" }, { logic: "OR", items: [{ variableId: "Menu", operator: "equals", value: "Sales" }, { variableId: "Menu", operator: "equals", value: "Service" }] }] },
      targets: [{ queueId: "north" }]
    }],
    fallbackQueueId: "fallback"
  };
  const model: RoutingModel = { workstreams: [workstream], queues: [queue("north"), queue("fallback")], warnings: [] };

  test("the rule matches when the And row and one row of the Or group hold", () => {
    const result = simulate(workstream, model, { Region: "North", Menu: "Service" });
    expect(result.queue?.id).toBe("north");
    expect(result.rule?.id).toBe("r1");
    expect(result.steps.find((s) => s.id === "r1")?.detail).toContain("(Menu equals \"Sales\" OR Menu equals \"Service\")");
  });

  test("the rule doesn't match when no row of the Or group holds", () => {
    const result = simulate(workstream, model, { Region: "North", Menu: "Billing" });
    expect(result.queue?.id).toBe("fallback");
    expect(result.rule).toBeUndefined();
  });

  test("groupSummary says Always for an empty group", () => {
    expect(groupSummary({ logic: "AND", items: [] }, {})).toBe("Always");
  });
});
