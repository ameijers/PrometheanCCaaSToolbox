import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { QueueSource } from "../src/dataSource";
import { demoSource, resetDemo } from "../src/demoData";
import { executePlan } from "../src/execute";
import { runLogCsv } from "../src/export";
import { resolvePlan } from "../src/resolve";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";
import { validateCsv } from "../src/validate";

async function examplePlan() {
  resetDemo();
  return resolvePlan(validateCsv(parseCsv(exampleCsv())), await demoSource.loadCatalog());
}

function recording(overrides: Partial<QueueSource> = {}) {
  const calls: string[] = [];
  const source: QueueSource = {
    ...demoSource,
    createQueue: async (payload) => { calls.push(`queue:${payload.name}`); return `q-${calls.length}`; },
    addMember: async (queueId, userId) => { calls.push(`member:${queueId}:${userId}`); },
    ...overrides
  };
  return { source, calls };
}

describe("executePlan", () => {
  test("creates each queue, then adds its members to that queue", async () => {
    const plan = await examplePlan();
    const { source, calls } = recording();
    const results = await executePlan(plan, source);
    expect(calls.slice(0, 3)).toEqual([`queue:Sales – NL`, `member:q-1:${plan.queues[0].refs.members[0].id}`, `member:q-1:${plan.queues[0].refs.members[1].id}`]);
    expect(calls.filter((c) => c.startsWith("queue:"))).toHaveLength(5);
    expect(results.map((r) => r.outcome)).toEqual(["created", "created", "created", "created", "created"]);
    expect(results[4].notes).toEqual(["No members yet. Add agents in the admin center before routing work to this queue."]);
  });

  test("a failed queue skips its members; a failed member makes the queue partial but others continue", async () => {
    const plan = await examplePlan();
    const bram = plan.queues[0].refs.members[1].id;
    const { source } = recording({
      createQueue: async (payload) => { if (payload.name === "Sales – Priority customers") throw new Error("Duplicate queue"); return "q"; },
      addMember: async (_q, userId) => { if (userId === bram) throw new Error("User is not a bookable resource"); }
    });
    const results = await executePlan(plan, source);
    expect(results[0].outcome).toBe("partial");
    expect(results[0].steps.map((s) => s.status)).toEqual(["created", "created", "failed"]);
    expect(results[0].notes.join(" ")).toMatch(/Some members weren't added/);
    expect(results[1]).toMatchObject({ outcome: "failed", steps: [{ status: "failed", error: "Duplicate queue" }, { status: "skipped" }] });
    expect(results[2].steps.filter((s) => s.status === "failed")).toHaveLength(1);
    expect(results[3].outcome).toBe("created");
  });

  test("flags a queue the platform didn't give an assignment contract, or one it couldn't check", async () => {
    const plan = await examplePlan();
    expect((await executePlan(plan, recording({ hasAssignmentContract: async () => false }).source))[0].notes[0]).toMatch(/didn't set up this queue's assignment/);
    expect((await executePlan(plan, recording({ hasAssignmentContract: async () => undefined }).source))[0].notes[0]).toMatch(/Couldn't check/);
  });

  test("the demo remembers created queues, so a second run hits the duplicate check", async () => {
    const plan = await examplePlan();
    await executePlan(plan, demoSource);
    const again = resolvePlan(validateCsv(parseCsv(exampleCsv())), await demoSource.loadCatalog());
    expect(again.issues.filter((i) => i.severity === "error" && i.column === "queue_name")).toHaveLength(5);
  });
});

describe("example file and run log", () => {
  test("the copy in examples/ is exactly what the Upload step offers", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8")).toBe(exampleCsv());
  });

  test("the log lists every queue and membership with ids and times, notes and accepted warnings", async () => {
    const plan = await examplePlan();
    const results = await executePlan(plan, demoSource);
    const log = parseCsv(runLogCsv(results, plan.issues, { tool: "Queue Builder", mode: "live", environment: "org", user: "Admin", startedAt: "2026-09-30T10:00:00Z", finishedAt: "2026-09-30T10:00:05Z", source: EXAMPLE_FILE_NAME }));
    const rows = log.records.map((r) => Object.fromEntries(log.headers.map((h, i) => [h, r.cells[i]])));
    const records = rows.filter((r) => r.Entry === "Record");
    expect(records.filter((r) => r["Record type"] === "Queue").map((r) => r.Status)).toEqual(["Created", "Created", "Created", "Created", "Created"]);
    expect(records.filter((r) => r["Record type"] === "Member")).toHaveLength(7);
    expect(records.every((r) => r["Record id"] && r.User === "Admin" && /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/.test(r.Time))).toBe(true);
    expect(rows.filter((r) => r.Entry === "Review warning").map((r) => r.Queue)).toEqual(["Case follow-up", "Case follow-up"]);
    expect(rows.some((r) => r.Entry === "Note" && r.Queue === "Case follow-up")).toBe(true);
  });
});
