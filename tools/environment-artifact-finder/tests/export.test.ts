// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { DISCLAIMER } from "../src/analyze";
import { findingsToCsv, findingsToMarkdown } from "../src/export";
import { CHECKS, Finding } from "../src/model";

const finding: Finding = {
  id: "x", checkId: "structural.orphan", table: "cts_servicenumber", recordId: "abc", recordName: "Line, \"spare\"",
  category: "A", checkType: CHECKS["structural.orphan"].checkType, confidence: "high", confidenceReason: "", title: "Nothing references it",
  explanation: "Nothing | uses it", evidence: ["a", "b"], nextStep: "Review it.", related: [], marksDead: true
};

describe("exports", () => {
  test("CSV escapes quotes and commas, and opens with the disclaimer", () => {
    const csv = findingsToCsv([finding]).split("\n");
    expect(csv[0]).toContain("Every finding is a candidate for review");
    expect(csv[2]).toContain("\"Line, \"\"spare\"\"\"");
    expect(csv[2]).toContain("a | b");
  });

  test("Markdown carries the disclaimer and escapes table pipes", () => {
    const md = findingsToMarkdown([finding], "2026-09-27", "demo");
    expect(md).toContain(DISCLAIMER);
    expect(md).toContain("sample environment");
    expect(md).toContain("| Service number | Line, \"spare\" | Nothing references it | High | Review it. |");
  });
});
