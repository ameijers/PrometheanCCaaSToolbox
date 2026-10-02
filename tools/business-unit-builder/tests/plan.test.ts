import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { UnitSource } from "../src/dataSource";
import { demoSource, resetDemo } from "../src/demoData";
import { executePlan, unitPayload } from "../src/execute";
import { runLogCsv } from "../src/export";
import { Catalog } from "../src/model";
import { buildPlan, parentLabel } from "../src/plan";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";

let catalog: Catalog;
beforeEach(async () => { resetDemo(); catalog = await demoSource.loadCatalog(); });

const plan = (lines: string[]) => buildPlan(parseCsv(lines.join("\n")), catalog);
const errors = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "error");
const id = (name: string) => catalog.units.find((u) => u.name === name)!.id;

describe("buildPlan", () => {
  test("the example: no issues, and parents always before children whatever the row order", () => {
    const p = buildPlan(parseCsv(exampleCsv()), catalog);
    expect(p.issues).toEqual([]);
    expect(p.units.map((u) => [u.name, u.depth, parentLabel(u, p)])).toEqual([
      ["Contact Center", 1, "Contoso"],
      ["Sales – Partners", 1, "Sales"],
      ["Contact Center NL", 2, "Contact Center"],
      ["Contact Center BE", 2, "Contact Center"],
      ["Contact Center NL – Inbound", 3, "Contact Center NL"],
      ["Contact Center NL – Outbound", 3, "Contact Center NL"]
    ]);
  });

  test("an empty parent means the root business unit", () => {
    const p = plan(["name,parent_business_unit", "Top,"]);
    expect(p.units[0].parent).toEqual({ kind: "existing", unit: catalog.units[0] });
  });

  test("names: required, unique in the file, new in the environment (case-insensitive)", () => {
    const p = plan(["name,parent_business_unit", ",Sales", "A,", "a,", "service,"]);
    expect(errors(p).map((e) => [e.line, e.column])).toEqual([[2, "name"], [4, "name"], [5, "name"]]);
    expect(errors(p).map((e) => e.message)).toEqual([
      expect.stringMatching(/^name is empty/),
      expect.stringMatching(/^"a" is also on line 3/),
      expect.stringMatching(/^A business unit named "service" already exists/)
    ]);
  });

  test("parents: unknown, disabled, ambiguous and self are errors", () => {
    catalog.units.push({ id: "dup1", name: "Twin", parentId: id("Contoso"), disabled: false }, { id: "dup2", name: "Twin", parentId: id("Contoso"), disabled: false });
    const p = plan(["name,parent_business_unit", "A,Nowhere", "B,Legacy", "C,twin", "D,D"]);
    expect(errors(p).map((e) => e.line)).toEqual([5, 2, 3, 4]);
    expect(errors(p).map((e) => e.message)).toEqual([
      "\"D\" can't be its own parent.",
      expect.stringMatching(/^No business unit named "Nowhere" exists/),
      expect.stringMatching(/^The parent "Legacy" is disabled/),
      expect.stringMatching(/^2 business units are named "twin"/)
    ]);
  });

  test("a row whose parent can't be resolved isn't planned, and neither is anything below it", () => {
    const p = plan(["name,parent_business_unit", "A,Legacy", "B,A", "C,Sales"]);
    expect(errors(p).map((e) => e.line)).toEqual([2]);
    expect(p.units.map((u) => u.name)).toEqual(["C"]);
  });

  test("loops in the file are errors, including rows hanging below a loop", () => {
    const p = plan(["name,parent_business_unit", "A,B", "B,A", "C,A", "D,Sales"]);
    expect(errors(p).map((e) => e.line).sort()).toEqual([2, 3, 4]);
    expect(errors(p).find((e) => e.line === 2)!.message).toMatch(/loop of parents \(A → B → A\)|loop of parents \(B → A → B\)/);
    expect(errors(p).find((e) => e.line === 4)!.message).toMatch(/lead into a loop/);
    expect(p.units.map((u) => u.name)).toEqual(["D"]);
  });

  test("field lengths, email and website are checked", () => {
    const p = plan(["name,cost_center,email,website", `${"x".repeat(161)},${"c".repeat(101)},not-an-email,not a site`]);
    expect(errors(p).map((e) => e.column)).toEqual(["name", "cost_center", "email", "website"]);
  });

  test("file-level problems", () => {
    expect(errors(plan(["title", "x"]))[0].message).toMatch(/no name column/);
    expect(errors(plan(["name"]))[0].message).toMatch(/no rows/);
    expect(plan(["name,surprise", "A,1"]).issues[0]).toMatchObject({ severity: "warning" });
  });
});

describe("payload and execution", () => {
  test("only filled-in columns are written, plus the parent bind", () => {
    const p = plan(["name,parent_business_unit,division,city,phone", "A,Sales,Customer Service,Utrecht,"]);
    expect(unitPayload(p.units[0], "p1")).toEqual({ name: "A", divisionname: "Customer Service", address1_city: "Utrecht", "parentbusinessunitid@odata.bind": "/businessunits(p1)" });
  });

  test("creates parents first and binds children to the new parent's id", async () => {
    const calls: Record<string, unknown>[] = [];
    const source: UnitSource = { ...demoSource, createUnit: async (payload) => { calls.push(payload); return `bu-${calls.length}`; } };
    const p = buildPlan(parseCsv(exampleCsv()), catalog);
    const results = await executePlan(p, source);
    expect(results.map((r) => r.status)).toEqual(Array(6).fill("created"));
    expect(calls[0]).toMatchObject({ name: "Contact Center", "parentbusinessunitid@odata.bind": `/businessunits(${id("Contoso")})` });
    expect(calls[1]).toMatchObject({ name: "Sales – Partners", "parentbusinessunitid@odata.bind": `/businessunits(${id("Sales")})` });
    expect(calls[2]).toMatchObject({ name: "Contact Center NL", "parentbusinessunitid@odata.bind": "/businessunits(bu-1)" });
    expect(calls[4]).toMatchObject({ name: "Contact Center NL – Inbound", "parentbusinessunitid@odata.bind": "/businessunits(bu-3)" });
  });

  test("a failed parent skips its whole branch; other branches continue", async () => {
    const source: UnitSource = { ...demoSource, createUnit: async (payload) => { if (payload.name === "Contact Center NL") throw new Error("A business unit with this name exists."); return `bu-${payload.name}`; } };
    const results = await executePlan(buildPlan(parseCsv(exampleCsv()), catalog), source);
    expect(results.map((r) => [r.name, r.status])).toEqual([
      ["Contact Center", "created"], ["Sales – Partners", "created"], ["Contact Center NL", "failed"],
      ["Contact Center BE", "created"], ["Contact Center NL – Inbound", "skipped"], ["Contact Center NL – Outbound", "skipped"]
    ]);
    expect(results[4].error).toMatch(/parent "Contact Center NL" wasn't created/);
  });

  test("flags a missing default team, or one it couldn't check", async () => {
    const p = plan(["name", "A"]);
    expect((await executePlan(p, { ...demoSource, hasDefaultTeam: async () => false }))[0].notes[0]).toMatch(/No default team/);
    resetDemo(); catalog = await demoSource.loadCatalog();
    expect((await executePlan(plan(["name", "A"]), { ...demoSource, hasDefaultTeam: async () => undefined }))[0].notes[0]).toMatch(/Couldn't check/);
  });

  test("the demo remembers what it created, so a second run hits the duplicate check", async () => {
    await executePlan(buildPlan(parseCsv(exampleCsv()), catalog), demoSource);
    const again = buildPlan(parseCsv(exampleCsv()), await demoSource.loadCatalog());
    expect(again.issues.filter((i) => i.column === "name")).toHaveLength(6);
  });
});

describe("example file and run log", () => {
  test("the copy in examples/ is exactly what the Upload step offers", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8")).toBe(exampleCsv());
  });

  test("the log has one row per business unit with parent, status, id and time", async () => {
    const p = buildPlan(parseCsv(exampleCsv()), catalog);
    const results = await executePlan(p, demoSource);
    const log = parseCsv(runLogCsv(results, p.issues, { tool: "Business Unit Builder", mode: "live", environment: "org", user: "Admin", startedAt: "2026-10-02T09:00:00Z", finishedAt: "2026-10-02T09:00:05Z", source: EXAMPLE_FILE_NAME }));
    const rows = log.records.map((r) => Object.fromEntries(log.headers.map((h, i) => [h, r.cells[i]])));
    expect(rows).toHaveLength(6);
    expect(rows[2]).toMatchObject({ Entry: "Business unit", "Business unit": "Contact Center NL", Parent: "Contact Center", Status: "Created", User: "Admin" });
    expect(rows.every((r) => r["Business unit id"] && /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/.test(r.Time))).toBe(true);
  });
});
