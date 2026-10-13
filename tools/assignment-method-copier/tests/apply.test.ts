// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { applyCopies, switchBack } from "../src/apply";
import { CopierSource } from "../src/dataSource";
import { demoSource, resetDemo } from "../src/demoData";
import { runLogCsv } from "../src/export";
import { QueueCopy, QueueRow } from "../src/model";
import { planCopies } from "../src/plan";

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

async function plan(targetNames: string[], activate: boolean, fromName = "Sales – NL"): Promise<QueueCopy[]> {
  const queues = await demoSource.loadQueues();
  const from = queues.find((q) => q.name === fromName)!;
  const method = await demoSource.loadMethod(from.methods[0].id);
  let n = 0;
  return planCopies({ queue: from, method }, targetNames.map((name) => queues.find((q) => q.name === name)!), { activate }, () => `rule-${++n}`);
}

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

describe("switchBack", () => {
  test("puts each queue back on the method it used, and keeps the copy switched off", async () => {
    const supportBefore = await queueNamed("Support – Voice");
    const results = await applyCopies(await plan(["Sales – EN", "Support – Voice"], true), demoSource);
    const reverted = await switchBack(results, demoSource);
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
    expect(await switchBack(results, source)).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("a failed switch back says so", async () => {
    const results = await applyCopies(await plan(["Billing"], true), demoSource);
    const failing: CopierSource = { ...demoSource, update: async () => { throw new Error("Locked."); } };
    const [reverted] = await switchBack(results, failing);
    expect(reverted).toMatchObject({ status: "failed", activated: true });
    expect(reverted.error).toMatch(/Couldn't switch back completely: Locked\./);
  });
});

describe("run log", () => {
  test("has one row per queue with what was created", async () => {
    const results = await applyCopies(await plan(["Billing", "Legacy callbacks"], true), demoSource);
    const csv = runLogCsv(results, { tool: "Assignment Method Copier", mode: "demo", environment: "the sample environment", user: "Sample user", startedAt: "2026-10-13T08:00:00.000Z", finishedAt: "2026-10-13T08:00:05.000Z" }, "Copy", "Skills first (Sales – NL)");
    const lines = csv.trim().split(/\r?\n/);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Copied from,Queue,Queue id,Status,Method,Method id,Method before,In use on the queue,Records created");
    expect(lines[1]).toMatch(/Copy,Skills first \(Sales – NL\),Billing,.*,Done,Skills first,.*,Least active,Yes,msdyn_assignmentconfiguration /);
    expect(lines[2]).toMatch(/Legacy callbacks,.*,Stopped part-way,Skills first,.*,Least active,No,/);
  });
});
