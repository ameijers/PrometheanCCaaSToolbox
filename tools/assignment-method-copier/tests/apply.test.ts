// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { applyCopies, undoChanges } from "../src/apply";
import { CopierSource } from "../src/dataSource";
import { demoSource, resetDemo } from "../src/demoData";
import { runLogCsv } from "../src/export";
import { MatchOptions, Method, QueueCopy, QueueRow } from "../src/model";
import { planCopies, rulesOf } from "../src/plan";

const LEAST_ACTIVE = 192350003, CUSTOM = 192350002;

// The sample environment is the fake: it stores what's written and applies the same table and column
// limits as the live source. `recording` wraps it to see the writes in order.
function recording(): { source: CopierSource; writes: string[] } {
  const writes: string[] = [];
  const source: CopierSource = {
    ...demoSource,
    create: async (table, payload) => { writes.push(`create ${table}`); return demoSource.create(table, payload); },
    update: async (table, id, columns) => { writes.push(`update ${table} ${Object.keys(columns).join(",")}=${Object.values(columns).join(",")}`); return demoSource.update(table, id, columns); }
  };
  return { source, writes };
}

async function plan(targetNames: string[], activate: boolean, match?: MatchOptions): Promise<QueueCopy[]> {
  const queues = await demoSource.loadQueues();
  const from = queues.find((q) => q.name === "Sales – NL")!;
  const method = await demoSource.loadMethod(from.methods[0].id);
  const targets = targetNames.map((name) => queues.find((q) => q.name === name)!);
  const onQueues: Record<string, Method> = {};
  for (const m of targets.flatMap((q) => q.methods)) onQueues[m.id] = await demoSource.loadMethod(m.id);
  let n = 0;
  return planCopies({ queue: from, method }, targets, { activate, match }, () => `00000000-0000-4000-a000-${String(++n).padStart(12, "0")}`, onQueues);
}

const BOTH: MatchOptions = { byName: true, byRules: true };

async function queueNamed(name: string): Promise<QueueRow> {
  return (await demoSource.loadQueues()).find((q) => q.name === name)!;
}

beforeEach(() => resetDemo());

describe("applyCopies", () => {
  test("creates the method switched off, then each ruleset with its step, and switches the queue last", async () => {
    const { source, writes } = recording();
    const [result] = await applyCopies(await plan(["Sales – EN"], true), source);
    expect(writes).toEqual([
      "create msdyn_assignmentconfiguration",
      "create msdyn_decisionruleset", "create msdyn_assignmentconfigurationstep",
      "create msdyn_decisionruleset", "create msdyn_assignmentconfigurationstep",
      "update msdyn_assignmentconfiguration msdyn_isactiveconfiguration=true",
      "update queue msdyn_assignmentstrategy=192350002"
    ]);
    expect(result).toMatchObject({ status: "copied", activated: true });
    expect(result.created.map((c) => c.table)).toEqual(["msdyn_assignmentconfiguration", "msdyn_decisionruleset", "msdyn_assignmentconfigurationstep", "msdyn_decisionruleset", "msdyn_assignmentconfigurationstep"]);

    const queue = await queueNamed("Sales – EN");
    expect(queue.strategy).toBe(CUSTOM);
    expect(queue.methods).toEqual([{ id: result.methodId, name: "Skills first", active: true }]);
    const copied = await demoSource.loadMethod(result.methodId!);
    expect(copied.steps.map((s) => [s.type, s.order, s.ruleset?.inputContractId])).toEqual([[192350000, 1, queue.inputContractId], [192350002, 2, queue.inputContractId]]);
    // The prioritization ruleset's output follows the queue; the assignment ruleset keeps the shared contract.
    expect(copied.steps[0].ruleset?.outputContractId).toBe(queue.inputContractId);
    expect(copied.steps[1].ruleset?.outputContractId).toBe("00000000-0000-4000-9000-000000000001");
  });

  test("copy only leaves the queue on its method", async () => {
    const { source, writes } = recording();
    const [result] = await applyCopies(await plan(["Sales – EN"], false), source);
    expect(writes.some((w) => w.startsWith("update"))).toBe(false);
    expect(result).toMatchObject({ status: "copied", activated: false });
    const queue = await queueNamed("Sales – EN");
    expect(queue.strategy).toBe(LEAST_ACTIVE);
    expect(queue.methods).toEqual([{ id: result.methodId, name: "Skills first", active: false }]);
  });

  test("a queue already on a custom method has it switched off, not removed", async () => {
    const { source, writes } = recording();
    const before = await queueNamed("Support – Voice");
    const [result] = await applyCopies(await plan(["Support – Voice"], true), source);
    expect(writes.slice(-3)).toEqual([
      "update msdyn_assignmentconfiguration msdyn_isactiveconfiguration=false",
      "update msdyn_assignmentconfiguration msdyn_isactiveconfiguration=true",
      "update queue msdyn_assignmentstrategy=192350002"
    ]);
    const after = await queueNamed("Support – Voice");
    expect(after.methods).toEqual([{ ...before.methods[0], active: false }, { id: result.methodId, name: "Skills first", active: true }]);
  });

  test("a failure part-way never switches the queue, and doesn't stop the other queues", async () => {
    const { source, writes } = recording();
    const results = await applyCopies(await plan(["Legacy callbacks", "Billing"], true), source);
    expect(results.map((r) => r.status)).toEqual(["partial", "copied"]);
    expect(results[0].activated).toBe(false);
    expect(results[0].error).toMatch(/^Simulated failure.*delete the copy there/);
    expect(results[0].created.map((c) => c.table)).toEqual(["msdyn_assignmentconfiguration"]);
    const locked = await queueNamed("Legacy callbacks");
    expect(locked.strategy).toBe(LEAST_ACTIVE);
    expect(locked.methods).toEqual([{ id: results[0].methodId, name: "Skills first", active: false }]);
    expect(writes.filter((w) => w.startsWith("update queue")).length).toBe(1);
  });

  test("a failure on the first write is reported as failed with nothing created", async () => {
    const source: CopierSource = { ...demoSource, create: async () => { throw new Error("No privilege."); } };
    const [result] = await applyCopies(await plan(["Billing"], true), source);
    expect(result).toMatchObject({ status: "failed", error: "No privilege.", created: [], activated: false });
  });

  test("blocked queues are never written to", async () => {
    const { source, writes } = recording();
    const results = await applyCopies(await plan(["Imported voice queue", "Support – Chat"], true), source);
    expect(results).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("a copy that reads back differently is reported, not called done", async () => {
    const tampered: CopierSource = { ...demoSource, loadMethod: async (id) => { const m = await demoSource.loadMethod(id); m.steps[1].ruleset!.definition = "<decision />"; return m; } };
    const [changed] = await applyCopies(await plan(["Billing"], true), tampered);
    expect(changed.status).toBe("notVerified");
    expect(changed.error).toMatch(/the rules of "Assignment" read back differently/);

    resetDemo();
    const notSwitched: CopierSource = { ...demoSource, update: async () => undefined };
    const [result] = await applyCopies(await plan(["Billing"], true), notSwitched);
    expect(result.status).toBe("notVerified");
    expect(result.error).toMatch(/the queue isn't set to a custom method; the copy isn't the queue's only active method/);

    resetDemo();
    const unreadable: CopierSource = { ...demoSource, loadMethod: async () => { throw new Error("gone"); } };
    expect((await applyCopies(await plan(["Billing"], true), unreadable))[0].error).toMatch(/couldn't be read back/);
  });

  test("whitespace differences in the rules aren't a mismatch", async () => {
    const reformatted: CopierSource = { ...demoSource, loadMethod: async (id) => { const m = await demoSource.loadMethod(id); m.steps.forEach((s) => { s.ruleset!.definition = s.ruleset!.definition.replace(/\n\s*/g, "\r\n"); }); return m; } };
    expect((await applyCopies(await plan(["Billing"], true), reformatted))[0].status).toBe("copied");
  });
});

describe("a method already on the queue", () => {
  test("with the same name: its rules are rewritten, the missing ruleset added, and the queue left on it", async () => {
    const { source, writes } = recording();
    const [copy] = await plan(["Sales – BE"], true, BOTH);
    expect(copy.status).toBe("update");
    const [result] = await applyCopies([copy], source);
    // Already in use, so no switch; nothing new except the prioritization ruleset it lacked.
    expect(writes).toEqual([
      "update msdyn_decisionruleset msdyn_rulesetdefinition,msdyn_disabledrules=" + String(copy.existing!.updates[0].columns.msdyn_rulesetdefinition) + ",",
      "create msdyn_decisionruleset", "create msdyn_assignmentconfigurationstep"
    ]);
    expect(result).toMatchObject({ status: "copied", activated: false, methodId: copy.existing!.id });
    expect(result.updated.map((u) => u.name)).toEqual(["Assignment"]);

    const queue = await queueNamed("Sales – BE");
    expect(queue.methods).toEqual([{ id: copy.existing!.id, name: "Skills first", active: true }]);
    const method = await demoSource.loadMethod(copy.existing!.id);
    expect(method.steps.map((s) => s.type)).toEqual([192350002, 192350000]);
    const rules = rulesOf(method.steps[0].ruleset!.definition);
    // "Exact skill match" does the same as before and keeps its id; "Closest skill match" is new.
    expect(rules.map((r) => r.name)).toEqual(["Exact skill match", "Closest skill match"]);
    expect(rules[0].id).toBe("3b0f6f0e-2a51-4c8e-9a49-1d7f3c5b2e10");
    expect(method.steps[1].ruleset!.inputContractId).toBe(queue.inputContractId);
  });

  test("with the same rules under another name: nothing is copied, and it's switched on if asked", async () => {
    const { source, writes } = recording();
    const [copyOnly] = await plan(["Sales – FR"], false, BOTH);
    expect(copyOnly.status).toBe("upToDate");
    expect(await applyCopies([copyOnly], source)).toEqual([]);

    const [use] = await plan(["Sales – FR"], true, BOTH);
    expect(use).toMatchObject({ status: "update", activate: true, steps: [] });
    expect(use.existing).toMatchObject({ name: "Sales routing", matchedBy: "rules", updates: [] });
    const [result] = await applyCopies([use], source);
    expect(writes).toEqual(["update msdyn_assignmentconfiguration msdyn_isactiveconfiguration=true", "update queue msdyn_assignmentstrategy=192350002"]);
    expect(result).toMatchObject({ status: "copied", activated: true });
    expect((await queueNamed("Sales – FR")).methods).toEqual([{ id: use.existing!.id, name: "Sales routing", active: true }]);
  });

  test("without matching, both get a new copy as before", async () => {
    const copies = await plan(["Sales – BE", "Sales – FR"], true);
    expect(copies.map((c) => [c.status, c.methodName])).toEqual([["copy", "Skills first (2)"], ["copy", "Skills first"]]);
  });

  test("undo puts the rules back and the queue on the method it used", async () => {
    const before = await demoSource.loadMethod((await queueNamed("Sales – BE")).methods[0].id);
    const results = await applyCopies([...await plan(["Sales – BE"], true, BOTH), ...await plan(["Sales – FR"], true, BOTH)], demoSource);
    const undone = await undoChanges(results, demoSource);
    expect(undone.map((r) => [r.status, r.activated, r.updated.length])).toEqual([["copied", false, 0], ["copied", false, 0]]);

    const be = await demoSource.loadMethod(before.id);
    expect(be.steps.find((s) => s.ruleset?.id === before.steps[0].ruleset!.id)!.ruleset!.definition).toBe(before.steps[0].ruleset!.definition);
    const fr = await queueNamed("Sales – FR");
    expect(fr.strategy).toBe(LEAST_ACTIVE);
    expect(fr.methods[0].active).toBe(false);
  });

  test("a failure part-way through an update says what to do, and never switches the queue", async () => {
    const failing: CopierSource = { ...demoSource, create: async () => { throw new Error("No privilege."); } };
    const [result] = await applyCopies(await plan(["Sales – BE"], true, BOTH), failing);
    expect(result.status).toBe("partial");
    expect(result.updated).toHaveLength(1);
    expect(result.error).toMatch(/^No privilege\. "Skills first" was only partly updated.*Undo changes/);
  });

  test("an update that reads back differently is reported", async () => {
    const tampered: CopierSource = { ...demoSource, loadMethod: async (id) => { const m = await demoSource.loadMethod(id); m.steps.forEach((s) => { if (s.ruleset) s.ruleset.definition = "<decision />"; }); return m; } };
    const [result] = await applyCopies(await plan(["Sales – BE"], true, BOTH), tampered);
    expect(result.status).toBe("notVerified");
    expect(result.error).toMatch(/^Updated, but the rules of "Assignment" read back differently; the ruleset "Prioritization" isn't there as planned/);
  });

  test("the run log says what was updated and how", async () => {
    const results = await applyCopies(await plan(["Sales – BE"], true, BOTH), demoSource);
    const csv = runLogCsv(results, { tool: "Assignment Method Copier", mode: "demo", environment: "the sample environment", user: "Sample user", startedAt: "2026-11-19T08:00:00.000Z", finishedAt: "2026-11-19T08:00:05.000Z" }, "Copy", "Skills first (Sales – NL)");
    const row = csv.trim().split(/\r?\n/)[1];
    expect(row).toMatch(/Sales – BE,.*,Done,Updated \(same name\),Skills first,/);
    expect(row).toContain("msdyn_decisionruleset ");
    expect(row).toContain("Assignment ruleset \"\"Assignment\"\": adds \"\"Closest skill match\"\"; removes \"\"Any available agent\"\".");
  });
});

describe("undoChanges", () => {
  test("puts each queue back on the method it used, and keeps the copy switched off", async () => {
    const supportBefore = await queueNamed("Support – Voice");
    const results = await applyCopies(await plan(["Sales – EN", "Support – Voice"], true), demoSource);
    const reverted = await undoChanges(results, demoSource);
    expect(reverted.map((r) => [r.status, r.activated])).toEqual([["copied", false], ["copied", false]]);

    const sales = await queueNamed("Sales – EN");
    expect(sales.strategy).toBe(LEAST_ACTIVE);
    expect(sales.methods).toEqual([{ id: results[0].methodId, name: "Skills first", active: false }]);
    const support = await queueNamed("Support – Voice");
    expect(support.strategy).toBe(CUSTOM);
    expect(support.methods).toEqual([supportBefore.methods[0], { id: results[1].methodId, name: "Skills first", active: false }]);
  });

  test("only queues that were switched are touched", async () => {
    const results = await applyCopies([...await plan(["Legacy callbacks"], true), ...await plan(["Billing"], false)], demoSource);
    const { source, writes } = recording();
    expect(await undoChanges(results, source)).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("a failed undo says so", async () => {
    const results = await applyCopies(await plan(["Billing"], true), demoSource);
    const failing: CopierSource = { ...demoSource, update: async () => { throw new Error("Locked."); } };
    const [reverted] = await undoChanges(results, failing);
    expect(reverted).toMatchObject({ status: "failed", activated: true });
    expect(reverted.error).toMatch(/Couldn't undo completely: Locked\./);
  });
});

describe("run log", () => {
  test("has one row per queue with what was created", async () => {
    const results = await applyCopies(await plan(["Billing", "Legacy callbacks"], true), demoSource);
    const csv = runLogCsv(results, { tool: "Assignment Method Copier", mode: "demo", environment: "the sample environment", user: "Sample user", startedAt: "2026-10-13T08:00:00.000Z", finishedAt: "2026-10-13T08:00:05.000Z" }, "Copy", "Skills first (Sales – NL)");
    const lines = csv.trim().split(/\r?\n/);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Copied from,Queue,Queue id,Status,Change,Method,Method id,Method before,In use on the queue,Records created,Rulesets updated,Rule changes");
    expect(lines[1]).toMatch(/Copy,Skills first \(Sales – NL\),Billing,.*,Done,New copy,Skills first,.*,Least active,Yes,msdyn_assignmentconfiguration /);
    expect(lines[2]).toMatch(/Legacy callbacks,.*,Stopped part-way,New copy,Skills first,.*,Least active,No,/);
  });
});
