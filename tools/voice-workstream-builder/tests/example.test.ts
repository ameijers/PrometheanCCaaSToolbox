// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../src/csv";
import { demoSource, resetDemo } from "../src/demoData";
import { executePlan } from "../src/execute";
import { runLogCsv } from "../src/export";
import { resolvePlan } from "../src/resolve";
import { COLUMNS, EXAMPLE_FILE_NAME, templateCsv } from "../src/template";
import { validateCsv } from "../src/validate";

describe("example CSV", () => {
  test("the copy in examples/ is exactly what the Upload step offers", () => {
    const file = fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8");
    expect(file).toBe(templateCsv());
  });

  test("it uses every column and shows every transcript/recording option and a channel without a number", () => {
    const csv = parseCsv(templateCsv());
    expect(csv.headers).toEqual(COLUMNS.map((c) => c.header));
    const col = (h: string) => csv.records.map((r) => r.cells[csv.headers.indexOf(h)]);
    expect(new Set(col("transcript_recording").filter(Boolean))).toEqual(new Set(["None", "Transcript", "Transcript and Recording"]));
    expect(col("transcript_recording_start")).toContain("Manual");
    expect(col("phone_number").some((n, i) => !n && col("channel_name")[i])).toBe(true);
  });
});

describe("run log", () => {
  test("lists every record with its id and time, the notes, and the accepted warnings, with who/where/when on every row", async () => {
    resetDemo();
    const plan = resolvePlan(validateCsv(parseCsv(templateCsv())), await demoSource.loadCatalog());
    const results = await executePlan(plan, demoSource);
    const log = parseCsv(runLogCsv(results, plan.issues, { tool: "Voice Workstream Builder", mode: "demo", environment: "the sample environment", user: "Sample user", startedAt: "2026-09-30T10:00:00Z", finishedAt: "2026-09-30T10:01:00Z", source: EXAMPLE_FILE_NAME }));
    const rows = log.records.map((r) => Object.fromEntries(log.headers.map((h, i) => [h, r.cells[i]])));

    expect(log.headers.slice(0, 6)).toEqual(["Tool", "Environment", "User", "Run started", "Run finished", "Source"]);
    expect(rows.every((r) => r.User === "Sample user" && r.Source === EXAMPLE_FILE_NAME && r.Environment === "the sample environment (simulated)")).toBe(true);
    const records = rows.filter((r) => r.Entry === "Record");
    expect(records).toHaveLength(results.reduce((n, w) => n + w.steps.length, 0));
    expect(records.every((r) => r.Status === "Created" && r["Record id"] && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r.Time))).toBe(true);
    expect(rows.filter((r) => r.Entry === "Note").map((r) => r.Details).join(" ")).toMatch(/"Sales – EN" has no phone number yet/);
    expect(rows.filter((r) => r.Entry === "Review warning").map((r) => r.Workstream)).toEqual(["Escalations – Voice"]);
  });
});
