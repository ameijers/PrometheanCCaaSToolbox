// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "../../voice-workstream-builder/src/csv";
import { RUN_HEADERS, RunInfo, logTime, runColumns } from "../../voice-workstream-builder/src/runLog";
import { Issue, Settings, WorkstreamResult } from "./model";

// The run log: every record the run created or changed per workstream (or that failed or was skipped),
// with ids and times, the follow-up notes, and the warnings accepted at review — the same layout as the
// other creation tools' logs.

const LOG_HEADERS = [...RUN_HEADERS, "Context variable", "Workstream", "Workstream outcome", "Entry", "Record type", "Record", "Status", "Record id", "Time", "Details"];
export const OUTCOME_LABELS: Record<WorkstreamResult["outcome"], string> = { done: "Done", partial: "Partly done", failed: "Not done" };
const STATUS: Record<string, string> = { created: "Created", updated: "Updated", failed: "Failed", skipped: "Skipped" };

export function runLogCsv(results: WorkstreamResult[], issues: Issue[], run: RunInfo, settings: Settings): string {
  const base = [...runColumns(run), settings.variable.trim()];
  const rows: string[][] = [];
  results.forEach((r) => {
    r.steps.forEach((s) => rows.push([...base, r.name, OUTCOME_LABELS[r.outcome], "Record", s.label, s.name, STATUS[s.status], s.id ?? "", logTime(s.at), s.error ?? ""]));
    r.notes.forEach((n) => rows.push([...base, r.name, OUTCOME_LABELS[r.outcome], "Note", "", "", "", "", "", n]));
  });
  issues.filter((i) => i.severity === "warning").forEach((i) => rows.push([...base, i.workstream ?? "", "", "Review warning", "", i.column ?? "", "", "", "", `${i.line ? `Line ${i.line}: ` : ""}${i.message}`]));
  return toCsv(LOG_HEADERS, rows);
}

export function issuesToCsv(issues: Issue[]): string {
  return toCsv(["Severity", "Line", "Column", "Workstream", "Problem"], issues.map((i) => [i.severity === "error" ? "Error" : "Warning", i.line ? String(i.line) : "", i.column ?? "", i.workstream ?? "", i.message]));
}
