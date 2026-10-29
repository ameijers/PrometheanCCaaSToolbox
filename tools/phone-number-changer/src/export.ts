// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "../../voice-workstream-builder/src/csv";
import { RUN_HEADERS, RunInfo, logTime, runColumns } from "../../voice-workstream-builder/src/runLog";
import { ApplyResult, KIND_LABELS, PhoneNumber } from "./model";
import { numberLabel } from "./plan";

// The run log: which channel got which number, from what, when, and what failed — to answer "who
// moved this number, and when?" or to put it back.

const STATUS_LABELS: Record<ApplyResult["status"], string> = { updated: "Updated", failed: "Failed", skipped: "Skipped", notVerified: "Updated, not confirmed" };

export function runLogCsv(results: ApplyResult[], numbers: PhoneNumber[], run: RunInfo, action: string): string {
  const byId = new Map(numbers.map((n) => [n.id, n]));
  const label = (id: string | undefined) => numberLabel(byId, id);
  const base = runColumns(run);
  const rows = results.map((r) => [
    ...base, action, KIND_LABELS[r.change.channel.kind], r.change.channel.workstreamName, r.change.channel.name, r.change.channel.id, STATUS_LABELS[r.status],
    label(r.change.before.numberId), label(r.change.after.numberId),
    r.change.callerId ? label(r.change.before.callerIdId) : "", r.change.callerId ? label(r.change.after.callerIdId) : "",
    r.readBack ? label(r.readBack.numberId) : "", logTime(r.at), r.error ?? ""
  ]);
  return toCsv([...RUN_HEADERS, "Action", "Kind", "Workstream", "Channel", "Channel id", "Status", "Number before", "Number after", "Caller ID before", "Caller ID after", "Number read back", "Time", "Error"], rows);
}
