import { toCsv } from "../../voice-workstream-builder/src/csv";
import { describeCapture } from "../../voice-workstream-builder/src/recordingSettings";
import { RUN_HEADERS, RunInfo, logTime, runColumns } from "../../voice-workstream-builder/src/runLog";
import { describeFieldChange } from "./change";
import { ApplyResult } from "./model";

// The run log of a bulk change: which channels changed, from what to what, when, and which failed —
// enough to answer "what did we change on the 30th, and who did it?" or to redo the change elsewhere.

const STATUS_LABELS: Record<ApplyResult["status"], string> = { updated: "Updated", failed: "Failed", notVerified: "Updated, not confirmed" };

export function runLogCsv(results: ApplyResult[], run: RunInfo, action: string): string {
  const base = runColumns(run);
  const rows = results.map((r) => [
    ...base, action, r.change.channel.workstreamName, r.change.channel.name, r.change.channel.id, r.change.channel.phoneNumber ?? "",
    STATUS_LABELS[r.status], describeCapture(r.change.before), describeCapture(r.change.after),
    r.change.changedFields.map((f) => describeFieldChange(r.change, f)).join(" | "), logTime(r.at), r.error ?? ""
  ]);
  return toCsv([...RUN_HEADERS, "Action", "Workstream", "Channel", "Channel id", "Phone number", "Status", "Before", "After", "Changes", "Time", "Error"], rows);
}
