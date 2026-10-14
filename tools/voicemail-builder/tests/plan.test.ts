// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { demoSource, resetDemo } from "../src/demoData";
import { Catalog, ResolvedPlan, Settings } from "../src/model";
import { hasWork, resolvePlan, validateCsv } from "../src/plan";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";

const SKIP: Settings = { existingRules: "skip", assignmentMethod: "Highest capacity" };
const OVERWRITE: Settings = { ...SKIP, existingRules: "overwrite" };
const HEAD = "queue_name,calls_waiting,estimated_wait_minutes,out_of_hours,wait_time_seconds,voicemail_workstream_name,voicemail_queue_name,members";

let catalog: Catalog;
beforeEach(async () => { resetDemo(); catalog = await demoSource.loadCatalog(); });

function plan(lines: string[], settings: Settings = SKIP): ResolvedPlan {
  return resolvePlan(validateCsv(parseCsv(lines.join("\n"))), catalog, settings);
}
const errors = (p: ResolvedPlan) => p.issues.filter((i) => i.severity === "error");
const warnings = (p: ResolvedPlan) => p.issues.filter((i) => i.severity === "warning");

describe("validateCsv", () => {
  test("the example resolves against the sample environment without errors", () => {
    const p = resolvePlan(validateCsv(parseCsv(exampleCsv())), catalog, SKIP);
    expect(errors(p)).toEqual([]);
    expect(p.queues.map((q) => [q.row.queueName, q.voicemailQueue?.name ?? "new", q.voicemailWorkstream?.name ?? "new", q.intake, q.members.length])).toEqual([
      ["Sales – Voice", "new", "new", "add", 2],
      ["Support – Voice", "new", "new", "add", 1],
      ["Billing – Voice", "Billing voicemail", "new", "add", 0]
    ]);
  });

  test("the copy in examples/ is exactly what the Upload step offers", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8")).toBe(exampleCsv());
  });

  test("names default from the queue name, members are de-duplicated, conditions are read", () => {
    const { rows } = validateCsv(parseCsv([HEAD, "Sales – Voice,10,,yes,90,,,Anna@contoso.com|anna@contoso.com;bram@contoso.com"].join("\n")));
    expect(rows[0]).toEqual({
      line: 2, queueName: "Sales – Voice", voicemailWorkstreamName: "Sales – Voice Voicemail", voicemailQueueName: "Sales – Voice Voicemail Queue",
      overflow: [{ condition: "callsWaiting", value: 10 }, { condition: "outOfHours" }, { condition: "waitTime", value: 90 }],
      members: ["anna@contoso.com", "bram@contoso.com"]
    });
  });

  test("bad values, no condition and duplicate queues are errors", () => {
    const p = validateCsv(parseCsv([HEAD, "A,0,x,maybe,,,,", "B,,,,,,,", "C,3,,No,,,,", "c,3,,,,,,", ",1,,,,,,"].join("\n")));
    expect(p.issues.map((i) => `${i.line}:${i.column}`)).toEqual(["2:calls_waiting", "2:estimated_wait_minutes", "2:out_of_hours", "3:calls_waiting", "5:queue_name", "6:queue_name"]);
    expect(p.issues[3].message).toMatch(/No overflow condition/);
  });
});

describe("resolvePlan", () => {
  test("only voice queues can be set up", () => {
    const p = plan([HEAD, "Nowhere,1,,,,,,", "Support – Chat,1,,,,,,", "Billing voicemail,1,,,,,,"]);
    expect(errors(p).map((e) => e.message.replace(/ queue\. .*/, " queue."))).toEqual([
      "No active advanced queue named \"Nowhere\" exists in this environment.",
      "\"Support – Chat\" is a Messaging queue.",
      "\"Billing voicemail\" is a Record queue."
    ]);
  });

  test("an existing voicemail queue must be a Record queue; names can't be shared between rows", () => {
    const p = plan([HEAD, "Sales – Voice,1,,,,,Support – Voice,", "Billing – Voice,1,,,,X,Shared,", "Escalations – Voice,1,,,,X,Shared,"]);
    expect(errors(p).map((e) => `${e.line}:${e.column}`)).toEqual(["2:voicemail_queue_name", "4:voicemail_queue_name", "4:voicemail_workstream_name"]);
    expect(errors(p)[0].message).toMatch(/it's a Voice queue. Voicemails can only go to a Record queue/);
  });

  test("an existing workstream that isn't a voicemail workstream can't be used", () => {
    const p = plan([HEAD, "Billing – Voice,1,,,,Sales – Voice,,"]);
    expect(errors(p)[0].message).toMatch(/isn't a voicemail record workstream/);
  });

  test("members are resolved, and those already in a reused queue aren't added again", () => {
    const p = plan([HEAD, "Billing – Voice,1,,,,,Billing voicemail,dana@contoso.com|anna@contoso.com", "Sales – Voice,1,,,,,,ghost@contoso.com"]);
    expect(p.queues[0].members.map((m) => m.signIn)).toEqual(["anna@contoso.com"]);
    expect(errors(p).map((e) => e.message)).toEqual(["No user with sign-in name or email \"ghost@contoso.com\" exists in this environment."]);
    expect(warnings(plan([HEAD, "Sales – Voice,1,,,,,,"])).map((w) => w.column)).toEqual(["members"]);
  });

  test("a queue without overflow gets new rulesets with every condition", () => {
    const [q] = plan([HEAD, "Sales – Voice,10,5,Yes,120,,,anna@contoso.com"]).queues;
    expect(q.stages.map((s) => [s.stage, s.ruleset?.id ?? "new", s.changes.map((c) => `${c.kind} ${c.wanted.condition}`)])).toEqual([
      ["prequeue", "new", ["add estimatedWait", "add callsWaiting", "add outOfHours"]],
      ["inqueue", "new", ["add waitTime"]]
    ]);
  });

  test("an existing rule with another action is skipped or overwritten, as chosen", () => {
    const line = "Support – Voice,,5,,,,,chris@contoso.com";
    const skip = plan([HEAD, line]);
    expect(skip.queues[0].stages[0]).toMatchObject({ changes: [], skipped: ["Estimated wait time"] });
    expect(warnings(skip).map((w) => w.message)).toEqual(["The overflow rule \"Rule1\" (Estimated wait time) has another action. It's left as it is (Skip)."]);
    const over = plan([HEAD, line], OVERWRITE);
    expect(over.queues[0].stages[0].changes).toEqual([expect.objectContaining({ kind: "update", overwrote: true, wanted: { condition: "estimatedWait", value: 5 } })]);
    expect(warnings(over)[0].message).toMatch(/It's changed to voicemail: Estimated wait 5 min or more/);
  });

  test("an existing voicemail rule is left when it's the same, and updated when the threshold differs", () => {
    expect(plan([HEAD, "Support – Voice,,,,60,,,chris@contoso.com"]).queues[0].stages[1].changes).toEqual([]);
    const changed = plan([HEAD, "Support – Voice,,,,90,,,chris@contoso.com"]).queues[0].stages[1].changes;
    expect(changed).toEqual([expect.objectContaining({ kind: "update", overwrote: false, wanted: { condition: "waitTime", value: 90 } })]);
  });

  test("out of hours on a queue without operating hours is a warning", () => {
    expect(warnings(plan([HEAD, "Billing – Voice,,,Yes,,,,dana@contoso.com"])).map((w) => w.message)).toEqual(["\"Billing – Voice\" has no operating hours, so it's never out of hours and this rule never applies."]);
  });

  test("an intake rule for the queue to another workstream is skipped or overwritten; one to the same workstream is kept", async () => {
    const queueId = catalog.queues[0].id;
    const ws = catalog.workstreams[0].id;
    catalog.hub!.definition = `<decision hit-policy="first" version="1">\n  <rules>\n    <rule id="r1" name="Old"><logical operator="AND"><condition operator="=="><lhs type="attribute">msdyn_ocvoicemail.msdyn_missedconversationid_msdyn_ocvoicemail.msdyn_cdsqueueid_msdyn_ocliveworkitem.queueid</lhs><rhs type="staticvalue">{${queueId}}</rhs></condition></logical><action><setattribute><lhs type="attribute">action.unifiedrouting</lhs><rhs type="staticvalue">{${ws}}</rhs></setattribute></action></rule>\n  </rules>\n</decision>`;
    expect(plan([HEAD, "Sales – Voice,1,,,,,,anna@contoso.com"]).queues[0].intake).toBe("keep");
    expect(plan([HEAD, "Sales – Voice,1,,,,,,anna@contoso.com"], OVERWRITE).queues[0].intake).toBe("update");
    expect(plan([HEAD, "Sales – Voice,1,,,,Default Group Voicemail Workstream,,anna@contoso.com"]).queues[0].intake).toBe("keep");
  });

  test("an intake rule without a condition before ours is an error", () => {
    catalog.hub!.definition = "<decision hit-policy=\"first\" version=\"1\">\n  <rules>\n    <rule id=\"r\" name=\"Everything\"><action><setattribute><lhs type=\"attribute\">action.unifiedrouting</lhs><rhs type=\"staticvalue\">{x}</rhs></setattribute></action></rule>\n  </rules>\n</decision>";
    expect(errors(plan([HEAD, "Sales – Voice,1,,,,,,anna@contoso.com"]))[0].message).toMatch(/"Everything" has no condition and comes first/);
  });

  test("missing platform pieces block everything", () => {
    catalog.voicemailActionId = undefined;
    catalog.hub = undefined;
    const p = plan([HEAD, "Sales – Voice,1,,,,,,anna@contoso.com"]);
    expect(errors(p).map((e) => e.message.slice(0, 45))).toEqual(["The platform's voicemail record routing (the ", "This environment has no Voicemail overflow ac"]);
    expect(p.queues[0].blocked).toBe(true);
  });

  test("a queue that's already fully set up has nothing to do", () => {
    const vmQueue = catalog.queues.find((q) => q.name === "Billing voicemail")!;
    catalog.workstreams.push({ id: "ws-vm", name: "Support – Voice Voicemail", record: true, hubId: catalog.hub!.id, defaultQueueId: vmQueue.id });
    const supportId = catalog.queues.find((q) => q.name === "Support – Voice")!.id;
    catalog.hub!.definition = `<decision hit-policy="first" version="1">\n  <rules>\n    <rule id="r1" name="Support"><logical operator="AND"><condition operator="=="><lhs type="attribute">msdyn_ocvoicemail.msdyn_missedconversationid_msdyn_ocvoicemail.msdyn_cdsqueueid_msdyn_ocliveworkitem.queueid</lhs><rhs type="staticvalue">{${supportId}}</rhs></condition></logical><action><setattribute><lhs type="attribute">action.unifiedrouting</lhs><rhs type="staticvalue">{ws-vm}</rhs></setattribute></action></rule>\n  </rules>\n</decision>`;
    const [q] = plan([HEAD, "Support – Voice,,,,60,,Billing voicemail,"]).queues;
    expect(hasWork(q)).toBe(false);
  });
});
