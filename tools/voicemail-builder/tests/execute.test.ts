// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { VoicemailSource } from "../src/dataSource";
import { demoSource, resetDemo } from "../src/demoData";
import { executePlan } from "../src/execute";
import { runLogCsv } from "../src/export";
import { readIntakeRules } from "../src/intake";
import { ResolvedPlan, Settings } from "../src/model";
import { readRules } from "../src/overflow";
import { resolvePlan, validateCsv } from "../src/plan";
import { exampleCsv } from "../src/template";

const SKIP: Settings = { existingRules: "skip", assignmentMethod: "Highest capacity" };
const HEAD = "queue_name,calls_waiting,estimated_wait_minutes,out_of_hours,wait_time_seconds,voicemail_workstream_name,voicemail_queue_name,members";

function ids(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-a000-${String(++n).padStart(12, "0")}`;
}

function recording(base: VoicemailSource = demoSource): { source: VoicemailSource; writes: string[]; payloads: Record<string, unknown>[] } {
  const writes: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  const source: VoicemailSource = {
    ...base,
    create: async (table, payload) => { writes.push(`create ${table}`); payloads.push(payload); return base.create(table, payload); },
    update: async (table, id, columns) => { writes.push(`update ${table} ${Object.keys(columns).join(",")}`); payloads.push(columns); return base.update(table, id, columns); },
    addMember: async (queueId, userId) => { writes.push("add member"); return base.addMember(queueId, userId); }
  };
  return { source, writes, payloads };
}

async function plan(csv: string, settings = SKIP): Promise<ResolvedPlan> {
  return resolvePlan(validateCsv(parseCsv(csv)), await demoSource.loadCatalog(), settings);
}

const queue = async (name: string) => (await demoSource.loadCatalog()).queues.find((q) => q.name === name)!;

beforeEach(() => resetDemo());

describe("executePlan", () => {
  test("a queue without anything gets, in order: voicemail queue, members, workstream, intake rule, overflow rulesets linked to the queue", async () => {
    const { source, writes, payloads } = recording();
    const [result] = await executePlan(await plan([HEAD, "Sales – Voice,10,,Yes,120,,,anna@contoso.com|bram@contoso.com"].join("\n")), source, ids());
    expect(writes).toEqual([
      "create queue", "add member", "add member", "create msdyn_liveworkstream", "update msdyn_decisionruleset msdyn_rulesetdefinition",
      "create msdyn_decisionruleset", "update queue msdyn_decisionrulesetid@odata.bind",
      "create msdyn_decisionruleset", "update queue msdyn_inqueueoverflowrulesetid@odata.bind"
    ]);
    expect(result.outcome).toBe("done");
    expect(payloads[0]).toEqual({ name: "Sales – Voice Voicemail Queue", msdyn_isomnichannelqueue: true, msdyn_queuetype: 192350001, msdyn_assignmentstrategy: 192350000, msdyn_priority: 1, queueviewtype: 1 });

    const catalog = await demoSource.loadCatalog();
    const vmQueue = catalog.queues.find((q) => q.name === "Sales – Voice Voicemail Queue")!;
    const vmWorkstream = catalog.workstreams.find((w) => w.name === "Sales – Voice Voicemail")!;
    expect(vmQueue.memberIds).toHaveLength(2);
    expect(vmWorkstream).toMatchObject({ record: true, hubId: catalog.hub!.id, defaultQueueId: vmQueue.id });
    expect(payloads[1]).toMatchObject({ msdyn_streamsource: 192350000, msdyn_mode: 717210001, msdyn_workdistributionmode: 192350000, msdyn_capacityrequired: 30, "msdyn_defaultqueue@odata.bind": `/queues(${vmQueue.id})` });

    const voice = await queue("Sales – Voice");
    expect(readIntakeRules(catalog.hub!.definition).map((r) => [r.name, r.queueId, r.workstreamId])).toEqual([["Voicemail – Sales – Voice", voice.id, vmWorkstream.id]]);
    expect(readRules(voice.prequeue!.definition).map((r) => [r.name, r.condition, r.value, r.actionId])).toEqual([["Rule1", "callsWaiting", "10", catalog.voicemailActionId], ["Rule2", "outOfHours", "false", catalog.voicemailActionId]]);
    expect(readRules(voice.inqueue!.definition).map((r) => [r.condition, r.value])).toEqual([["waitTime", "120"]]);
    expect(voice.prequeue!.name).toBe("queue_prequeue_Sales – Voice");
    expect(payloads[3]).toMatchObject({ msdyn_name: "queue_prequeue_Sales – Voice", msdyn_uniquename: expect.stringMatching(/^msdyn_[0-9a-f-]{36}$/), "msdyn_inputcontractid@odata.bind": `/msdyn_decisioncontracts(${catalog.contracts.prequeueInput})` });
  });

  test("an existing overflow ruleset is changed in place: Overwrite updates the callback rule, the voicemail rule's threshold is updated", async () => {
    const { source, writes } = recording();
    const [result] = await executePlan(await plan([HEAD, "Support – Voice,4,5,,90,,,chris@contoso.com"].join("\n"), { ...SKIP, existingRules: "overwrite" }), source, ids());
    expect(result.outcome).toBe("done");
    expect(writes.filter((w) => w.includes("decisionruleset") || w.startsWith("update queue"))).toEqual([
      "update msdyn_decisionruleset msdyn_rulesetdefinition", "update msdyn_decisionruleset msdyn_rulesetdefinition", "update msdyn_decisionruleset msdyn_rulesetdefinition"
    ]);
    const voice = await queue("Support – Voice");
    const vm = (await demoSource.loadCatalog()).voicemailActionId;
    expect(readRules(voice.prequeue!.definition).map((r) => [r.name, r.condition, r.value, r.actionId === vm])).toEqual([["Rule1", "estimatedWait", "5", true], ["Rule2", "callsWaiting", "4", true]]);
    expect(readRules(voice.inqueue!.definition).map((r) => [r.name, r.value])).toEqual([["Rule1", "90"]]);
  });

  test("Skip leaves the callback rule and says so", async () => {
    const [result] = await executePlan(await plan([HEAD, "Support – Voice,,5,,,,,chris@contoso.com"].join("\n")), demoSource, ids());
    expect(result.outcome).toBe("done");
    expect(result.notes).toEqual(["Left as it is (Skip): Estimated wait time, because the existing rule has another action."]);
    expect(readRules((await queue("Support – Voice")).prequeue!.definition)[0].actionId).not.toBe((await demoSource.loadCatalog()).voicemailActionId);
  });

  test("an existing voicemail queue is reused: no queue is created, only missing members are added", async () => {
    const { source, writes } = recording();
    await executePlan(await plan([HEAD, "Billing – Voice,5,,,,,Billing voicemail,dana@contoso.com|anna@contoso.com"].join("\n")), source, ids());
    expect(writes.slice(0, 2)).toEqual(["add member", "create msdyn_liveworkstream"]);
  });

  test("intake rules of several queues all end up in the hub, in file order", async () => {
    await executePlan(await plan(exampleCsv()), demoSource, ids());
    const hub = (await demoSource.loadCatalog()).hub!;
    expect(readIntakeRules(hub.definition).map((r) => r.name)).toEqual(["Voicemail – Sales – Voice", "Voicemail – Support – Voice", "Voicemail – Billing – Voice"]);
  });

  test("a failure stops that queue before its overflow is switched on, and doesn't stop the others", async () => {
    const results = await executePlan(await plan([HEAD, "Escalations – Voice,3,,,,,,anna@contoso.com", "Sales – Voice,3,,,,,,anna@contoso.com"].join("\n")), demoSource, ids());
    expect(results.map((r) => r.outcome)).toEqual(["partial", "done"]);
    expect(results[0].steps.map((s) => [s.label, s.status])).toEqual([["Voicemail queue", "created"], ["Member", "added"], ["Voicemail workstream", "created"], ["Intake rule", "added"], ["Overflow (before queueing)", "failed"]]);
    expect(results[0].notes[0]).toMatch(/upload the file again to finish/);
    expect((await queue("Escalations – Voice")).prequeue).toBeUndefined();
  });

  test("uploading again after a part-way run finishes it without creating anything twice", async () => {
    const failing: VoicemailSource = { ...demoSource, update: async (table, id, columns) => { if (table === "queue") throw new Error("Locked."); return demoSource.update(table, id, columns); } };
    const [first] = await executePlan(await plan([HEAD, "Sales – Voice,3,,,,,,anna@contoso.com"].join("\n")), failing, ids());
    expect(first.outcome).toBe("partial");
    const again = await plan([HEAD, "Sales – Voice,3,,,,,,anna@contoso.com"].join("\n"));
    expect([again.queues[0].voicemailQueue?.name, again.queues[0].voicemailWorkstream?.name, again.queues[0].intake, again.queues[0].members.length]).toEqual(["Sales – Voice Voicemail Queue", "Sales – Voice Voicemail", "keep", 0]);
    const { source, writes } = recording();
    const [second] = await executePlan(again, source, ids());
    expect(second.outcome).toBe("done");
    expect(writes).toEqual(["create msdyn_decisionruleset", "update queue msdyn_decisionrulesetid@odata.bind"]);
  });

  test("rules that don't read back are reported", async () => {
    const forgetful: VoicemailSource = { ...demoSource, loadDefinition: async (id) => { const d = await demoSource.loadDefinition(id); return d?.includes("queue_inqueue") ? d.replace(/<rule [\s\S]*<\/rule>/, "") : d; } };
    const [result] = await executePlan(await plan([HEAD, "Sales – Voice,,,,60,,,anna@contoso.com"].join("\n")), forgetful, ids());
    expect(result.outcome).toBe("partial");
    expect(result.notes[0]).toMatch(/1 of the overflow rules don't read back/);
  });

  test("blocked queues are never written to", async () => {
    const { source, writes } = recording();
    const results = await executePlan(await plan([HEAD, "Support – Chat,1,,,,,,"].join("\n")), source, ids());
    expect(results).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("the log has a row per record and per note", async () => {
    const p = await plan(exampleCsv());
    const results = await executePlan(p, demoSource, ids());
    const csv = runLogCsv(results, p.issues, { tool: "Voicemail Builder", mode: "demo", environment: "the sample environment", user: "Sample user", startedAt: "2026-10-14T10:00:00.000Z", finishedAt: "2026-10-14T10:01:00.000Z" }, SKIP);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toContain("Existing rules,Queue,Queue outcome,Entry,Record type,Record,Status,Record id,Time,Details");
    expect(lines[1]).toMatch(/,Skip,Sales – Voice,Done,Record,Voicemail queue,Sales – Voice Voicemail Queue,Created,/);
    expect(lines.length).toBe(1 + results.reduce((n, r) => n + r.steps.length + r.notes.length, 0) + p.issues.filter((i) => i.severity === "warning").length);
  });
});
