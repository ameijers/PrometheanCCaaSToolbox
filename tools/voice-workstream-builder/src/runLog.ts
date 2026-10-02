// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The part of a run log both writing tools share: every row says which tool wrote what, where, as whom
// and when, so a log file still makes sense on its own after it's been forwarded or archived.

export interface RunInfo {
  tool: string;
  mode: "live" | "demo";
  environment: string;
  user: string;
  startedAt: string;   // ISO
  finishedAt: string;  // ISO
  source?: string;     // e.g. the uploaded CSV's file name
}

export const RUN_HEADERS = ["Tool", "Environment", "User", "Run started", "Run finished", "Source"];

// Local time without the "T" and milliseconds, which Excel reads as a date/time.
export function logTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function runColumns(run: RunInfo): string[] {
  return [run.tool, run.mode === "demo" ? `${run.environment} (simulated)` : run.environment, run.user, logTime(run.startedAt), logTime(run.finishedAt), run.source ?? ""];
}

export function logFileName(prefix: string, run: RunInfo): string {
  return `${prefix}-log-${logTime(run.startedAt).replace(/[: ]/g, "").replace(/-/g, "")}.csv`;
}
