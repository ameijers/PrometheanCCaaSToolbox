import { toCsv } from "./csv";
import { Issue, WorkstreamResult } from "./model";
import { RUN_HEADERS, RunInfo, logTime, runColumns } from "./runLog";

// Downloadable records of a run. The run log lists every record the run created (or failed or skipped)
// with its id and time, the follow-up notes per workstream, and the warnings that were accepted at
// review — enough to find, audit or remove what was created. The issues file is for fixing a CSV.

const LOG_HEADERS = [...RUN_HEADERS, "Workstream", "Workstream outcome", "Entry", "Record type", "Record", "Status", "Record id", "Time", "Details"];

const OUTCOME: Record<WorkstreamResult["outcome"], string> = { created: "Created", partial: "Partly created", failed: "Not created" };
const STATUS: Record<string, string> = { created: "Created", failed: "Failed", skipped: "Skipped" };

export function runLogCsv(results: WorkstreamResult[], issues: Issue[], run: RunInfo): string {
  const base = runColumns(run);
  const rows: string[][] = [];
  results.forEach((r) => {
    r.steps.forEach((s) => rows.push([...base, r.name, OUTCOME[r.outcome], "Record", s.label, s.name, STATUS[s.status], s.id ?? "", logTime(s.at), s.error ?? ""]));
    r.notes.forEach((n) => rows.push([...base, r.name, OUTCOME[r.outcome], "Note", "", "", "", "", "", n]));
  });
  issues.filter((i) => i.severity === "warning").forEach((i) => rows.push([...base, i.workstream ?? "", "", "Review warning", "", i.column ?? "", "", "", "", `${i.line ? `Line ${i.line}: ` : ""}${i.message}`]));
  return toCsv(LOG_HEADERS, rows);
}

export function issuesToCsv(issues: Issue[]): string {
  const rows = issues.map((i) => [i.severity === "error" ? "Error" : "Warning", i.line ? String(i.line) : "", i.column ?? "", i.workstream ?? "", i.message]);
  return toCsv(["Severity", "Line", "Column", "Workstream", "Problem"], rows);
}
