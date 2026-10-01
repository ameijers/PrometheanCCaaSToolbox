import { toCsv } from "../../voice-workstream-builder/src/csv";
import { RUN_HEADERS, RunInfo, logTime, runColumns } from "../../voice-workstream-builder/src/runLog";
import { Issue, QueueResult } from "./model";

// The run log: every queue and membership the run created (or failed or skipped), with ids (the queue's
// id, or for a member the user's id) and times,
// the follow-up notes, and the warnings accepted at review — the same layout as Voice Workstream
// Builder's log.

const LOG_HEADERS = [...RUN_HEADERS, "Queue", "Queue outcome", "Entry", "Record type", "Record", "Status", "Record id", "Time", "Details"];
const OUTCOME: Record<QueueResult["outcome"], string> = { created: "Created", partial: "Partly created", failed: "Not created" };
const STATUS: Record<string, string> = { created: "Created", failed: "Failed", skipped: "Skipped" };

export function runLogCsv(results: QueueResult[], issues: Issue[], run: RunInfo): string {
  const base = runColumns(run);
  const rows: string[][] = [];
  results.forEach((r) => {
    r.steps.forEach((s) => rows.push([...base, r.name, OUTCOME[r.outcome], "Record", s.label, s.name, s.status === "created" && s.kind === "member" ? "Added" : STATUS[s.status], s.id ?? "", logTime(s.at), s.error ?? ""]));
    r.notes.forEach((n) => rows.push([...base, r.name, OUTCOME[r.outcome], "Note", "", "", "", "", "", n]));
  });
  issues.filter((i) => i.severity === "warning").forEach((i) => rows.push([...base, i.queue ?? "", "", "Review warning", "", i.column ?? "", "", "", "", `${i.line ? `Line ${i.line}: ` : ""}${i.message}`]));
  return toCsv(LOG_HEADERS, rows);
}

export function issuesToCsv(issues: Issue[]): string {
  return toCsv(["Severity", "Line", "Column", "Queue", "Problem"], issues.map((i) => [i.severity === "error" ? "Error" : "Warning", i.line ? String(i.line) : "", i.column ?? "", i.queue ?? "", i.message]));
}
