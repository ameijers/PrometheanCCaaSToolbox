import { toCsv } from "../../voice-workstream-builder/src/csv";
import { RUN_HEADERS, RunInfo, logTime, runColumns } from "../../voice-workstream-builder/src/runLog";
import { Issue, UnitResult } from "./model";

// The run log: every business unit the run created (or failed or skipped), with its parent, id and
// time, the follow-up notes, and the warnings accepted at review — the same layout as the other
// creation tools' logs.

const STATUS: Record<UnitResult["status"], string> = { created: "Created", failed: "Failed", skipped: "Skipped" };

export function runLogCsv(results: UnitResult[], issues: Issue[], run: RunInfo): string {
  const base = runColumns(run);
  const rows: string[][] = [];
  results.forEach((r) => {
    rows.push([...base, "Business unit", r.name, r.parentName, STATUS[r.status], r.id ?? "", logTime(r.at), r.error ?? ""]);
    r.notes.forEach((n) => rows.push([...base, "Note", r.name, r.parentName, "", "", "", n]));
  });
  issues.filter((i) => i.severity === "warning").forEach((i) => rows.push([...base, "Review warning", i.unit ?? "", "", "", "", "", `${i.line ? `Line ${i.line}: ` : ""}${i.message}`]));
  return toCsv([...RUN_HEADERS, "Entry", "Business unit", "Parent", "Status", "Business unit id", "Time", "Details"], rows);
}

export function issuesToCsv(issues: Issue[]): string {
  return toCsv(["Severity", "Line", "Column", "Business unit", "Problem"], issues.map((i) => [i.severity === "error" ? "Error" : "Warning", i.line ? String(i.line) : "", i.column ?? "", i.unit ?? "", i.message]));
}
