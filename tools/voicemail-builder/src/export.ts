// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "../../voice-workstream-builder/src/csv";
import { RUN_HEADERS, RunInfo, logTime, runColumns } from "../../voice-workstream-builder/src/runLog";
import { Issue, QueueResult, Settings } from "./model";

// The run log: every record the run created or changed per voice queue (or that failed or was
// skipped), with ids and times, the follow-up notes, and the warnings accepted at review — the same
// layout as the other creation tools' logs.

const LOG_HEADERS = [...RUN_HEADERS, "Existing rules", "Queue", "Queue outcome", "Entry", "Record type", "Record", "Status", "Record id", "Time", "Details"];
export const OUTCOME_LABELS: Record<QueueResult["outcome"], string> = { done: "Done", partial: "Partly done", failed: "Not done" };
const STATUS: Record<string, string> = { created: "Created", updated: "Updated", added: "Added", failed: "Failed", skipped: "Skipped" };

export function runLogCsv(results: QueueResult[], issues: Issue[], run: RunInfo, settings: Settings): string {
  const base = [...runColumns(run), settings.existingRules === "overwrite" ? "Overwrite" : "Skip"];
  const rows: string[][] = [];
  results.forEach((r) => {
    r.steps.forEach((s) => rows.push([...base, r.name, OUTCOME_LABELS[r.outcome], "Record", s.label, s.name, STATUS[s.status], s.id ?? "", logTime(s.at), s.error ?? ""]));
    r.notes.forEach((n) => rows.push([...base, r.name, OUTCOME_LABELS[r.outcome], "Note", "", "", "", "", "", n]));
  });
  issues.filter((i) => i.severity === "warning").forEach((i) => rows.push([...base, i.queue ?? "", "", "Review warning", "", i.column ?? "", "", "", "", `${i.line ? `Line ${i.line}: ` : ""}${i.message}`]));
  return toCsv(LOG_HEADERS, rows);
}

export function issuesToCsv(issues: Issue[]): string {
  return toCsv(["Severity", "Line", "Column", "Queue", "Problem"], issues.map((i) => [i.severity === "error" ? "Error" : "Warning", i.line ? String(i.line) : "", i.column ?? "", i.queue ?? "", i.message]));
}
