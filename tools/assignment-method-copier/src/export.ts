// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "../../voice-workstream-builder/src/csv";
import { RUN_HEADERS, RunInfo, logTime, runColumns } from "../../voice-workstream-builder/src/runLog";
import { CopyResult } from "./model";
import { STRATEGY_LABELS } from "./schema";

// The run log of a copy: which queues got the method, what was created on each, whether the queue was
// switched over, and which failed — enough to answer "which queues did we change, and who did it?".

export const STATUS_LABELS: Record<CopyResult["status"], string> = { copied: "Done", notVerified: "Done, not confirmed", partial: "Stopped part-way", failed: "Failed" };

export function runLogCsv(results: CopyResult[], run: RunInfo, action: string, from: string): string {
  const base = runColumns(run);
  const rows = results.map((r) => [
    ...base, action, from, r.copy.queue.name, r.copy.queue.id, STATUS_LABELS[r.status], r.copy.methodName, r.methodId ?? "",
    STRATEGY_LABELS[r.copy.before.strategy] ?? String(r.copy.before.strategy), r.activated ? "Yes" : "No",
    r.created.map((c) => `${c.table} ${c.id}`).join(" | "), logTime(r.at), r.error ?? ""
  ]);
  return toCsv([...RUN_HEADERS, "Action", "Copied from", "Queue", "Queue id", "Status", "Method", "Method id", "Method before", "In use on the queue", "Records created", "Time", "Error"], rows);
}
