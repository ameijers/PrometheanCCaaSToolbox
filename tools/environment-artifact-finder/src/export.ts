// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { DISCLAIMER } from "./analyze";
import { CHECK_TYPE_LABELS, CONFIDENCE_LABELS, Finding } from "./model";
import { tableLabel } from "./referenceMap";

// Client-side exports of the current findings list, so a review can be handed to whoever owns the
// records. The disclaimer travels with every export — a CSV forwarded on its own must not read as a
// delete list.

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

export function findingsToCsv(findings: Finding[]): string {
  const header = ["Entity", "Table", "Record id", "Record name", "Category", "Check type", "Confidence", "Why flagged", "Explanation", "Evidence", "Suggested next step"];
  const lines = findings.map((f) => [tableLabel(f.table), f.table, f.recordId, f.recordName, f.category, CHECK_TYPE_LABELS[f.checkType], CONFIDENCE_LABELS[f.confidence], f.title, f.explanation, f.evidence.join(" | "), f.nextStep].map(csvCell).join(","));
  return [csvCell(`NOTE: ${DISCLAIMER}`), header.join(","), ...lines].join("\n");
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function findingsToMarkdown(findings: Finding[], scannedAt: string, mode: "live" | "demo"): string {
  const rows = findings.map((f) => `| ${mdCell(tableLabel(f.table))} | ${mdCell(f.recordName)} | ${mdCell(f.title)} | ${CONFIDENCE_LABELS[f.confidence]} | ${mdCell(f.nextStep)} |`);
  return [
    "# Environment Artifact Finder — cleanup candidates",
    "",
    `Scanned ${mode === "demo" ? "the sample environment" : "a live environment"} at ${scannedAt}. ${findings.length} finding(s).`,
    "",
    `> **Review before removing anything.** ${DISCLAIMER}`,
    "",
    "| Entity | Record | Why flagged | Confidence | Suggested next step |",
    "| --- | --- | --- | --- | --- |",
    ...rows
  ].join("\n");
}

export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
