import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { ColumnDef, findOne, readRows } from "../src/columns";
import { Plan } from "../src/model";
import { runLogCsv, runPlan } from "../src/runner";

const COLUMNS: ColumnDef[] = [
  { header: "name", required: true, description: "" },
  { header: "kind", choices: ["Owner", "Entra ID security group"], defaultValue: "Owner", description: "" },
  { header: "roles", list: true, description: "" }
];

describe("readRows", () => {
  test("choices are case-insensitive with a default; lists are split and de-duplicated", () => {
    const { rows, issues } = readRows(parseCsv("Name,KIND,roles\nA,owner,Basic User|Agent|basic user\nB,,"), COLUMNS, "name");
    expect(rows.map((r) => [r.cell("name"), r.choice("kind"), r.list("roles")])).toEqual([["A", "Owner", ["Basic User", "Agent"]], ["B", "Owner", []]]);
    expect(issues).toEqual([{ severity: "warning", line: 2, column: "roles", item: "A", message: "Listed more than once: basic user. Used once." }]);
  });

  test("invalid choices, missing key column, unknown and repeated columns, no rows", () => {
    const bad = readRows(parseCsv("name,kind\nA,Access"), COLUMNS, "name");
    bad.rows[0].choice("kind");
    expect(bad.issues[0]).toMatchObject({ severity: "error", line: 2, column: "kind" });
    expect(readRows(parseCsv("title\nx"), COLUMNS, "name").issues[0].message).toMatch(/no name column/);
    expect(readRows(parseCsv("name,extra,kind,Kind\nA,1,,"), COLUMNS, "name").issues.map((i) => i.severity)).toEqual(["warning", "error"]);
    expect(readRows(parseCsv("name"), COLUMNS, "name").issues[0].message).toMatch(/no rows/);
  });

  test("findOne reports none, one or ambiguous", () => {
    const records = [{ n: "Sales" }, { n: "sales " }, { n: "Service" }];
    expect(findOne(records, "service", (r) => [r.n])).toEqual({ record: records[2], count: 1 });
    expect(findOne(records, "SALES", (r) => [r.n]).count).toBe(2);
    expect(findOne(records, "x", (r) => [r.n])).toEqual({ record: undefined, count: 0 });
  });
});

describe("runPlan", () => {
  const plan = (failOn?: string): Plan => ({
    rowCount: 2, issues: [{ severity: "warning", line: 2, item: "A", message: "Heads up" }],
    items: [
      { key: "a", line: 2, title: "A", facts: [], actions: [
        { key: "parent", label: "Create", target: "A", status: "todo", run: async () => { if (failOn === "parent") throw new Error("boom"); return "id-a"; } },
        { key: "child", label: "Assign", target: "R1", status: "todo", dependsOn: "parent", run: async (ctx) => { expect(ctx.id("parent")).toBe("id-a"); } },
        { key: "independent", label: "Add", target: "Q", status: "todo", run: async () => undefined },
        { key: "kept", label: "Assign", target: "R2", status: "noChange", reason: "Already assigned" }
      ] },
      { key: "b", line: 3, title: "B", facts: [], actions: [{ key: "x", label: "Assign", target: "R", status: "noChange" }] }
    ]
  });

  test("runs todo actions in order, passes ids to dependants, reports noChange without running", async () => {
    const progress: number[] = [];
    const results = await runPlan(plan(), (p) => progress.push(p.done));
    expect(results.map((r) => r.outcome)).toEqual(["done", "noChange"]);
    expect(results[0].actions.map((a) => a.status)).toEqual(["done", "done", "done", "noChange"]);
    expect(results[0].actions[0].id).toBe("id-a");
    expect(progress[progress.length - 1]).toBe(3);
  });

  test("a failure skips only its dependants; independent actions still run", async () => {
    const results = await runPlan(plan("parent"));
    expect(results[0].outcome).toBe("partial");
    expect(results[0].actions.map((a) => a.status)).toEqual(["failed", "skipped", "done", "noChange"]);
    expect(results[0].actions[0].error).toBe("boom");
  });

  test("the log has one row per action plus accepted warnings", async () => {
    const results = await runPlan(plan());
    const log = parseCsv(runLogCsv(results, plan().issues, { tool: "T", mode: "live", environment: "org", user: "Admin", startedAt: "2026-10-02T10:00:00Z", finishedAt: "2026-10-02T10:00:01Z" }, "Team"));
    expect(log.headers.slice(6)).toEqual(["Team", "Outcome", "Action", "Target", "Status", "Record id", "Time", "Details"]);
    expect(log.records.map((r) => r.cells[10])).toEqual(["Done", "Done", "Done", "Already in place", "Already in place", ""]);
    expect(log.records[5].cells[8]).toBe("Review warning");
  });
});

describe("the shared kit never writes", () => {
  const dir = path.resolve(__dirname, "../src");
  test.each(fs.readdirSync(dir))("%s", (file) => {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    ["createRecord", "updateRecord", "deleteRecord", "execute(", "fetch(", "method:"].forEach((token) => expect(text.includes(token)).toBe(false));
  });
});
