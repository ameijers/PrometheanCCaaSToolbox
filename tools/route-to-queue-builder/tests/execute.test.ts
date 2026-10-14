// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { RouteSource } from "../src/dataSource";
import { demoSource, resetDemo } from "../src/demoData";
import { ExecuteOptions, executePlan, hasVariable } from "../src/execute";
import { runLogCsv } from "../src/export";
import { ResolvedPlan, Settings } from "../src/model";
import { resolvePlan, validateCsv } from "../src/plan";
import { existingRules } from "../src/rules";
import { exampleCsv } from "../src/template";

const SETTINGS: Settings = { variable: "SelectedMenuItem", defaultRulesetName: "Route to queue" };
const HEAD = "workstream_name,rule_name,menu_value,queue_name";

function options(): ExecuteOptions {
  let n = 0;
  return { newId: () => `00000000-0000-4000-a000-${String(++n).padStart(12, "0")}`, pollMs: 1, contractTimeoutMs: 5, sleep: async () => undefined };
}

// The sample environment is the fake; `recording` wraps it to see the writes in order.
function recording(base: RouteSource = demoSource): { source: RouteSource; writes: string[]; payloads: Record<string, unknown>[] } {
  const writes: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  const source: RouteSource = {
    ...base,
    create: async (table, payload) => { writes.push(`create ${table}`); payloads.push(payload); return base.create(table, payload); },
    update: async (table, id, columns) => { writes.push(`update ${table} ${Object.keys(columns).join(",")}`); payloads.push(columns); return base.update(table, id, columns); }
  };
  return { source, writes, payloads };
}

async function plan(csv: string, settings = SETTINGS): Promise<ResolvedPlan> {
  return resolvePlan(validateCsv(parseCsv(csv)), await demoSource.loadCatalog(), settings);
}

async function workstream(name: string) {
  return (await demoSource.loadCatalog()).workstreams.find((w) => w.name === name)!;
}

beforeEach(() => resetDemo());

describe("executePlan", () => {
  test("a workstream without routing gets the variable, a routing configuration, a ruleset with its rules and a step", async () => {
    const { source, writes, payloads } = recording();
    const [result] = await executePlan(await plan([HEAD, "Sales – Voice,Route to new sales,NewOrder,Sales – NL", "Sales – Voice,Route to order status,OrderStatus,Sales – Orders"].join("\n")), source, options());
    expect(writes).toEqual(["create msdyn_ocliveworkstreamcontextvariable", "create msdyn_routingconfiguration", "create msdyn_decisionruleset", "create msdyn_routingconfigurationstep"]);
    expect(result).toMatchObject({ outcome: "done", rulesAdded: 2 });
    expect(result.steps.map((s) => [s.label, s.status])).toEqual([["Context variable", "created"], ["Routing configuration", "created"], ["Ruleset", "created"], ["Route-to-queue step", "created"]]);

    const ws = await workstream("Sales – Voice");
    expect(payloads[0]).toEqual({
      msdyn_name: "SelectedMenuItem", msdyn_displayname: "SelectedMenuItem", msdyn_datatype: 192350000, msdyn_isdisplayable: true, msdyn_islist: false,
      msdyn_ismodifiable: true, msdyn_issystemdefined: false, "msdyn_liveworkstreamid@odata.bind": `/msdyn_liveworkstreams(${ws.id})`
    });
    expect(payloads[1]).toMatchObject({ msdyn_name: "Route to queue", msdyn_isactiveconfiguration: true, msdyn_uniquename: expect.stringMatching(/^new_[0-9a-f]{32}$/) });
    expect(payloads[2]).toMatchObject({
      msdyn_name: "Route to queue", msdyn_rulesettype: 192350000, msdyn_authoringmode: 192350000, msdyn_isinputcollection: false, msdyn_persistoutputdata: false, msdyn_refreshinputdata: false,
      "msdyn_inputcontractid@odata.bind": `/msdyn_decisioncontracts(${ws.routingContractId})`, "msdyn_outputcontractid@odata.bind": "/msdyn_decisioncontracts(00000000-0000-4000-9000-000000000001)"
    });
    expect(payloads[3]).toMatchObject({ msdyn_name: "Route to queue", msdyn_type: 192350002, msdyn_steporder: 1 });
    expect(existingRules(ws.routing!.queueRuleset!.definition, "SelectedMenuItem").map((r) => [r.name, r.values])).toEqual([["Route to new sales", ["NewOrder"]], ["Route to order status", ["OrderStatus"]]]);
    expect(ws.variables.map((v) => v.name)).toEqual(["SelectedMenuItem"]);
  });

  test("rules are only added once the platform has put the new variable in the routing contract", async () => {
    const reads: boolean[] = [];
    const watching: RouteSource = { ...demoSource, loadContractDefinition: async (id) => { const c = await demoSource.loadContractDefinition(id); reads.push(hasVariable(c, "SelectedMenuItem")); return c; } };
    const { source, writes } = recording(watching);
    await executePlan(await plan([HEAD, "Sales – Voice,A,1,Sales – NL"].join("\n")), source, options());
    expect(reads).toEqual([false, true]);
    expect(writes[1]).toBe("create msdyn_routingconfiguration");
  });

  test("if the platform doesn't add the variable in time, no rules are written and the run says what to do", async () => {
    const never: RouteSource = { ...demoSource, loadContractDefinition: async () => "<contract version=\"1\" />" };
    const { source, writes } = recording(never);
    const [result] = await executePlan(await plan([HEAD, "Sales – Voice,A,1,Sales – NL"].join("\n")), source, options());
    expect(writes).toEqual(["create msdyn_ocliveworkstreamcontextvariable"]);
    expect(result.outcome).toBe("partial");
    expect(result.steps.map((s) => s.status)).toEqual(["created", "failed", "skipped"]);
    expect(result.notes[0]).toMatch(/Upload the file again in a minute/);
  });

  test("a workstream with a route-to-queue ruleset gets the rules added after its own, nothing else", async () => {
    const before = (await workstream("Support – Voice")).routing!.queueRuleset!.definition!;
    const { source, writes } = recording();
    const [result] = await executePlan(await plan([HEAD, "Support – Voice,Route to returns,Returns,Support – Returns", "Support – Voice,Route to technical support,Technical,Support – Technical"].join("\n")), source, options());
    expect(writes).toEqual(["update msdyn_decisionruleset msdyn_rulesetdefinition"]);
    expect(result).toMatchObject({ outcome: "done", rulesAdded: 2 });
    const after = (await workstream("Support – Voice")).routing!.queueRuleset!.definition!;
    expect(after.startsWith(before.slice(0, before.lastIndexOf("  </rules>")))).toBe(true);
    expect(existingRules(after, "SelectedMenuItem").map((r) => r.name)).toEqual(["Route to billing questions", "Route to returns", "Route to technical support"]);
  });

  test("rules added since the upload are kept: the ruleset is read again just before writing", async () => {
    const p = await plan([HEAD, "Support – Voice,Route to returns,Returns,Support – Returns"].join("\n"));
    const rulesetId = p.workstreams[0].workstream!.routing!.queueRuleset!.id;
    // Someone adds a rule in the admin center between upload and create.
    const changed = (await demoSource.loadRulesetDefinition(rulesetId))!.replace("  </rules>", "    <rule id=\"meanwhile\" name=\"Added meanwhile\"><action /></rule>\n  </rules>");
    await demoSource.update("msdyn_decisionruleset", rulesetId, { msdyn_rulesetdefinition: changed });
    await executePlan(p, demoSource, options());
    expect(existingRules(await demoSource.loadRulesetDefinition(rulesetId), "SelectedMenuItem").map((r) => r.name)).toEqual(["Route to billing questions", "Added meanwhile", "Route to returns"]);
  });

  test("a workstream whose routing has no route-to-queue step gets a ruleset and a step after its other steps", async () => {
    const { source, writes, payloads } = recording();
    await executePlan(await plan([HEAD, "Billing – Voice,Route to invoices,Invoice,Billing"].join("\n")), source, options());
    expect(writes).toEqual(["create msdyn_ocliveworkstreamcontextvariable", "create msdyn_decisionruleset", "create msdyn_routingconfigurationstep"]);
    const ws = await workstream("Billing – Voice");
    expect(payloads[2]).toMatchObject({ msdyn_steporder: 2, "msdyn_routingconfigurationid@odata.bind": `/msdyn_routingconfigurations(${ws.routing!.configId})` });
  });

  test("a failure part-way is reported and doesn't stop the other workstreams", async () => {
    const results = await executePlan(await plan([HEAD, "Escalations – Voice,A,1,Escalations", "Support – Voice,B,2,Support – Returns"].join("\n")), demoSource, options());
    expect(results.map((r) => r.outcome)).toEqual(["partial", "done"]);
    expect(results[0].steps.map((s) => [s.label, s.status])).toEqual([["Context variable", "created"], ["Routing configuration", "created"], ["Route to queue", "failed"]]);
    expect(results[0].steps[2].error).toMatch(/Simulated failure/);
    expect(results[0].notes[0]).toMatch(/Stopped part-way/);
  });

  test("a failure on the first write is reported as not done", async () => {
    const failing: RouteSource = { ...demoSource, update: async () => { throw new Error("No privilege."); } };
    const [result] = await executePlan(await plan([HEAD, "Support – Voice,B,2,Support – Returns"].join("\n")), failing, options());
    expect(result).toMatchObject({ outcome: "failed", rulesAdded: 0 });
    expect(result.steps[0]).toMatchObject({ label: "Rules", status: "failed", error: "No privilege." });
  });

  test("rules that don't read back are reported", async () => {
    const forgetful: RouteSource = { ...demoSource, loadRulesetDefinition: async (id) => (await demoSource.loadRulesetDefinition(id))?.replace(/<rule id="00000000-0000-4000-a000[^]*?<\/rule>/, "") };
    const [result] = await executePlan(await plan([HEAD, "Support – Voice,B,2,Support – Returns", "Support – Voice,C,3,Support – Technical"].join("\n")), forgetful, options());
    expect(result).toMatchObject({ outcome: "partial", rulesAdded: 1 });
    expect(result.notes[0]).toMatch(/1 rule doesn't read back: "B"/);
  });

  test("blocked workstreams are never written to", async () => {
    const { source, writes } = recording();
    const p = await plan([HEAD, "Claims – Voice,A,1,Sales – NL", "Support – Voice,B,2,Support – Returns"].join("\n"));
    const results = await executePlan(p, source, options());
    expect(results.map((r) => r.name)).toEqual(["Support – Voice"]);
    expect(writes).toEqual(["update msdyn_decisionruleset msdyn_rulesetdefinition"]);
  });

  test("the example runs end to end, and the log has a row per record", async () => {
    const p = await plan(exampleCsv());
    const results = await executePlan(p, demoSource, options());
    expect(results.map((r) => [r.name, r.outcome, r.rulesAdded])).toEqual([["Sales – Voice", "done", 2], ["Support – Voice", "done", 2], ["Billing – Voice", "done", 1]]);
    const csv = runLogCsv(results, p.issues, { tool: "Route-to-Queue Builder", mode: "demo", environment: "the sample environment", user: "Sample user", startedAt: "2026-10-14T08:00:00.000Z", finishedAt: "2026-10-14T08:01:00.000Z", source: "route-to-queue-example.csv" }, SETTINGS);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toContain("Context variable,Workstream,Workstream outcome,Entry,Record type,Record,Status,Record id,Time,Details");
    expect(lines).toHaveLength(1 + 4 + 1 + 3);
    expect(lines[1]).toMatch(/SelectedMenuItem,Sales – Voice,Done,Record,Context variable,SelectedMenuItem,Created,/);
  });
});
