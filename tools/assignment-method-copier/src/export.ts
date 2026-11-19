// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "../../voice-workstream-builder/src/csv";
import { RUN_HEADERS, RunInfo, logTime, runColumns } from "../../voice-workstream-builder/src/runLog";
import { CopyResult } from "./model";
import { describeClearing, describeUpdate } from "./plan";
import { STRATEGY_LABELS } from "./schema";

// The run log of a copy: which queues got the method or had it updated, what was created and rewritten
// on each, whether the queue was switched over, and which failed — enough to answer "which queues did
// we change, and who did it?".

export const STATUS_LABELS: Record<CopyResult["status"], string> = { copied: "Done", notVerified: "Done, not confirmed", partial: "Stopped part-way", failed: "Failed" };

function change(r: CopyResult): string {
  const first = r.copy.cleared.length ? ", rules removed first" : "";
  if (!r.copy.existing) return `New copy${first}`;
  return `Updated (same ${r.copy.existing.matchedBy === "rules" ? "rules" : "name"})${first}`;
}

export function runLogCsv(results: CopyResult[], run: RunInfo, action: string, from: string): string {
  const base = runColumns(run);
  const rows = results.map((r) => [
    ...base, action, from, r.copy.queue.name, r.copy.queue.id, STATUS_LABELS[r.status], change(r), r.copy.methodName, r.methodId ?? "",
    STRATEGY_LABELS[r.copy.before.strategy] ?? String(r.copy.before.strategy), r.activated ? "Yes" : "No",
    r.created.map((c) => `${c.table} ${c.id}`).join(" | "),
    r.updated.map((u) => `msdyn_decisionruleset ${u.id}`).join(" | "),
    [...describeClearing(r.copy.cleared), ...(r.copy.existing ? describeUpdate(r.copy.existing, r.copy.steps) : [])].join(" "),
    logTime(r.at), r.error ?? ""
  ]);
  return toCsv([...RUN_HEADERS, "Action", "Copied from", "Queue", "Queue id", "Status", "Change", "Method", "Method id", "Method before", "In use on the queue", "Records created", "Rulesets updated", "Rule changes", "Time", "Error"], rows);
}
