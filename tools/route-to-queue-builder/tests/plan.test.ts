// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { demoSource, resetDemo } from "../src/demoData";
import { Catalog, ResolvedPlan, Settings } from "../src/model";
import { resolvePlan, settingsIssues, validateCsv } from "../src/plan";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";

const SETTINGS: Settings = { variable: "SelectedMenuItem", defaultRulesetName: "Route to queue" };
const HEAD = "workstream_name,rule_name,menu_value,queue_name";

let catalog: Catalog;
beforeEach(async () => { resetDemo(); catalog = await demoSource.loadCatalog(); });

function plan(lines: string[], settings: Settings = SETTINGS): ResolvedPlan {
  return resolvePlan(validateCsv(parseCsv(lines.join("\n"))), catalog, settings);
}
const errors = (p: ResolvedPlan) => p.issues.filter((i) => i.severity === "error");
const warnings = (p: ResolvedPlan) => p.issues.filter((i) => i.severity === "warning");

describe("validateCsv", () => {
  test("the example resolves cleanly against the sample environment", () => {
    const p = resolvePlan(validateCsv(parseCsv(exampleCsv())), catalog, SETTINGS);
    expect(p.issues).toEqual([]);
    expect(p.workstreams.map((w) => [w.name, w.mode, w.rulesetName, w.createVariable, w.rules.length])).toEqual([
      ["Sales – Voice", "newConfig", "Route to queue", true, 2],
      ["Support – Voice", "append", "Support routing", false, 2],
      ["Billing – Voice", "newRuleset", "Route to queue", true, 1]
    ]);
  });

  test("the copy in examples/ is exactly what the Upload step offers", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8")).toBe(exampleCsv());
  });

  test("every column is required, in the header and in each row", () => {
    expect(validateCsv(parseCsv("workstream_name,rule_name\nA,B")).issues[0].message).toMatch(/no menu_value, queue_name columns/);
    const p = plan([HEAD, "Sales – Voice,,NewOrder,Sales – NL", ",R,V,Q"]);
    expect(errors(p).map((e) => `${e.line}:${e.column}`)).toEqual(["2:rule_name", "3:workstream_name"]);
    expect(p.workstreams).toHaveLength(0);
  });

  test("headers are matched loosely and unknown columns are ignored with a warning", () => {
    const p = plan(["Workstream Name,Rule-Name,menu value,QUEUE_NAME,notes", "Sales – Voice,R,NewOrder,Sales – NL,x"]);
    expect(errors(p)).toEqual([]);
    expect(warnings(p)[0].message).toMatch(/Ignored column not in the template: notes/);
  });
});

describe("settings", () => {
  test("the context variable is required and must be a plain name", () => {
    expect(settingsIssues({ ...SETTINGS, variable: " " })[0].message).toMatch(/Enter the name of the context variable/);
    expect(settingsIssues({ ...SETTINGS, variable: "Selected item" })[0].message).toMatch(/isn't a valid context variable name/);
    expect(settingsIssues({ ...SETTINGS, variable: "1st" })).toHaveLength(1);
    expect(settingsIssues({ ...SETTINGS, variable: "Selected_Menu2" })).toEqual([]);
  });

  test("a default ruleset name is needed only for workstreams without a route-to-queue ruleset", () => {
    const p = plan([HEAD, "Support – Voice,R,V,Support – Returns", "Sales – Voice,R,V,Sales – NL"], { ...SETTINGS, defaultRulesetName: "" });
    expect(errors(p).map((e) => e.workstream)).toEqual(["Sales – Voice"]);
    expect(errors(p)[0].message).toMatch(/no route-to-queue ruleset yet. Enter a default ruleset name/);
    expect(p.workstreams.map((w) => w.blocked)).toEqual([false, true]);
  });
});

describe("resolvePlan", () => {
  test("rules of one workstream are grouped, in file order, wherever they are in the file", () => {
    const p = plan([HEAD, "Sales – Voice,A,1,Sales – NL", "Support – Voice,B,2,Support – Returns", "sales – voice,C,3,Sales – Orders"]);
    expect(p.workstreams.map((w) => [w.name, w.rules.map((r) => r.ruleName)])).toEqual([["Sales – Voice", ["A", "C"]], ["Support – Voice", ["B"]]]);
    expect(p.workstreams[0].rules.map((r) => r.queueId)).toEqual([catalog.queues[0].id, catalog.queues[1].id]);
  });

  test("the context variable is created only where it's missing", () => {
    const p = plan([HEAD, "Sales – Voice,A,1,Sales – NL", "Support – Voice,B,2,Support – Returns"]);
    expect(p.workstreams.map((w) => w.createVariable)).toEqual([true, false]);
    // CallReason exists on Support only.
    const q = plan([HEAD, "Sales – Voice,A,1,Sales – NL", "Support – Voice,B,2,Support – Returns"], { ...SETTINGS, variable: "CallReason" });
    expect(q.workstreams.map((w) => w.createVariable)).toEqual([true, false]);
  });

  test("a context variable of another type, or in another case, blocks the workstream", () => {
    const p = plan([HEAD, "Claims – Voice,A,1,Sales – NL"]);
    expect(errors(p)[0].message).toMatch(/context variable "SelectedMenuItem" of type Number/);
    const q = plan([HEAD, "Support – Voice,A,1,Support – Returns"], { ...SETTINGS, variable: "selectedmenuitem" });
    expect(errors(q)[0].message).toMatch(/has a context variable "SelectedMenuItem". Names are case-sensitive/);
  });

  test("unknown, ambiguous and mismatched names are errors", () => {
    const p = plan([HEAD, "Nowhere,A,1,Sales – NL", "Sales – Voice,B,2,Nope", "Sales – Voice,C,3,Callbacks", "Sales – Voice,D,4,Support – Chat", "Chat – Web,E,5,Sales – NL", "Legacy – Voice,F,6,Sales – NL"]);
    expect(errors(p).map((e) => `${e.line}:${e.column}`)).toEqual(["2:workstream_name", "3:queue_name", "4:queue_name", "5:queue_name", "6:queue_name", "7:workstream_name"]);
    expect(errors(p)[2].message).toMatch(/2 advanced queues are named "Callbacks"/);
    expect(errors(p)[3].message).toMatch(/is a Messaging queue, which doesn't take work from a voice workstream/);
    expect(errors(p)[4].message).toMatch(/is a Voice queue, which doesn't take work from this workstream/);
    expect(errors(p)[5].message).toMatch(/has no routing contract/);
  });

  test("rule names must be unique within the ruleset, existing rules included", () => {
    const p = plan([HEAD, "Support – Voice,Route to billing questions,X,Billing", "Support – Voice,New,Y,Billing", "Support – Voice,new,Z,Billing"]);
    expect(errors(p).map((e) => [e.line, e.message.replace(/ of .*/, "")])).toEqual([[2, "A rule named \"Route to billing questions\" is already in the existing ruleset"], [4, "A rule named \"new\" is already in line 3"]]);
  });

  test("a value that another rule already routes is a warning", () => {
    const p = plan([HEAD, "Support – Voice,A,Billing,Billing", "Support – Voice,B,Returns,Support – Returns", "Support – Voice,C,Returns,Support – Technical"]);
    expect(errors(p)).toEqual([]);
    expect(warnings(p).map((w) => [w.line, w.message])).toEqual([
      [2, "\"Billing\" is also the value of the existing rule \"Route to billing questions\". Both rules match the same conversations."],
      [4, "\"Returns\" is also the value of the rule on line 3. Both rules match the same conversations."]
    ]);
  });

  test("a missing output contract blocks everything", () => {
    catalog.outputContractId = undefined;
    expect(errors(plan([HEAD, "Sales – Voice,A,1,Sales – NL"]))[0].message).toMatch(/Demand queue identification output contract/);
  });

  test("routing that isn't active, or with two route-to-queue rulesets, blocks the workstream", () => {
    catalog.workstreams[0].routingInactive = true;
    catalog.workstreams[1].routing!.queueRulesets = 2;
    const p = plan([HEAD, "Sales – Voice,A,1,Sales – NL", "Support – Voice,B,2,Support – Returns"]);
    expect(errors(p)[0].message).toMatch(/^"Sales – Voice" has routing configurations, but none is active/);
    expect(errors(p)[1].message).toMatch(/^"Support – Voice" has 2 route-to-queue rulesets, which this tool doesn't expect/);
  });
});
