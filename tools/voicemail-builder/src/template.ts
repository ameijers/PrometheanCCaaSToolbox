// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "../../voice-workstream-builder/src/csv";

// The CSV contract: one row per voice queue. This list drives the example file, validation and the
// in-app column reference.

export interface ColumnDef {
  header: string;
  required?: boolean;
  description: string;
}

export const COLUMNS: ColumnDef[] = [
  { header: "queue_name", required: true, description: "The voice queue whose overflow goes to voicemail, by name." },
  { header: "calls_waiting", description: "Voicemail when this many calls are waiting in the queue, or more. Checked before the call joins the queue." },
  { header: "estimated_wait_minutes", description: "Voicemail when the estimated wait is this many minutes, or more. Checked before the call joins the queue." },
  { header: "out_of_hours", description: "Yes: voicemail outside the queue's operating hours. Needs operating hours on the queue." },
  { header: "wait_time_seconds", description: "Voicemail once a caller has waited this many seconds in the queue, or more." },
  { header: "voicemail_workstream_name", description: "The record workstream for this queue's voicemails. Empty: \"<queue_name> Voicemail\". Reused if it exists." },
  { header: "voicemail_queue_name", description: "The record queue the voicemails land in. Empty: \"<queue_name> Voicemail Queue\". Reused if it exists." },
  { header: "members", description: "Agents who handle the voicemails, by sign-in name, separated by |. Added to the voicemail queue." }
];

export const COLUMN_BY_HEADER = new Map(COLUMNS.map((c) => [c.header, c]));

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// The example offered in the Upload step (and kept in examples/). Every name in it exists in the
// sample environment.
const EXAMPLE_ROWS: Record<string, string>[] = [
  { queue_name: "Sales – Voice", calls_waiting: "10", out_of_hours: "Yes", wait_time_seconds: "120", members: "anna@contoso.com|bram@contoso.com" },
  { queue_name: "Support – Voice", estimated_wait_minutes: "5", wait_time_seconds: "180", members: "chris@contoso.com" },
  { queue_name: "Billing – Voice", calls_waiting: "5", voicemail_workstream_name: "Billing voicemail", voicemail_queue_name: "Billing voicemail", members: "dana@contoso.com" }
];

export const EXAMPLE_FILE_NAME = "voicemail-example.csv";

export function exampleCsv(): string {
  const headers = COLUMNS.map((c) => c.header);
  return toCsv(headers, EXAMPLE_ROWS.map((row) => headers.map((h) => row[h] ?? "")));
}

export function emptyTemplateCsv(): string {
  return toCsv(COLUMNS.map((c) => c.header), []);
}
