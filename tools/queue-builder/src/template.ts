// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "../../voice-workstream-builder/src/csv";
import { ASSIGNMENT_METHODS, QUEUE_TYPES, VISIBILITY } from "./queueSchema";

// The CSV contract: one row per queue. This list drives the example file, validation and the in-app
// column reference.

export interface ColumnDef {
  header: string;
  required?: boolean;
  choices?: readonly string[];
  defaultValue?: string;
  description: string;
}

export const COLUMNS: ColumnDef[] = [
  { header: "queue_name", required: true, description: "Name of the advanced queue. Must not exist in the environment yet." },
  { header: "queue_type", choices: Object.keys(QUEUE_TYPES), defaultValue: "Voice", description: "Voice, Messaging (chat, SMS, social) or Record (cases, emails and other records). Can't be changed after the queue is created." },
  { header: "assignment_method", choices: Object.keys(ASSIGNMENT_METHODS), defaultValue: "Least active", description: "Least active: the agent who has been idle longest. Highest capacity: the agent with the most free capacity. Advanced round robin: agents in turn, by queue order." },
  { header: "priority", defaultValue: "1", description: "Whole number, 1 or higher. A lower number is a higher priority: agents get work from priority 1 queues first." },
  { header: "visibility", choices: Object.keys(VISIBILITY), defaultValue: "Private", description: "Private: only members see the queue and its items. Public: everyone can see it." },
  { header: "operating_hours", description: "Name of an operating hours record. Blank means the queue is always open." },
  { header: "description", description: "Free text, shown on the queue record." },
  { header: "members", description: "Agents to add to the queue, by sign-in name (e.g. anna@contoso.com), separated by |. Blank creates the queue without members." }
];

export const COLUMN_BY_HEADER = new Map(COLUMNS.map((c) => [c.header, c]));

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// The example offered in the Upload step (and kept in examples/). Every name in it exists in the
// sample environment.
const EXAMPLE_ROWS: Record<string, string>[] = [
  { queue_name: "Sales – NL", queue_type: "Voice", assignment_method: "Least active", priority: "1", visibility: "Private", operating_hours: "Workdays", description: "Dutch-speaking sales calls", members: "anna@contoso.com|bram@contoso.com" },
  { queue_name: "Sales – Priority customers", queue_type: "Voice", assignment_method: "Highest capacity", priority: "1", operating_hours: "Workdays", members: "anna@contoso.com" },
  { queue_name: "Support – Overflow", queue_type: "Voice", assignment_method: "Advanced round robin", priority: "5", visibility: "Public", operating_hours: "24/7", members: "bram@contoso.com|chris@contoso.com|dana@contoso.com" },
  { queue_name: "Support – Chat", queue_type: "Messaging", assignment_method: "Highest capacity", priority: "2", members: "chris@contoso.com" },
  { queue_name: "Case follow-up", queue_type: "Record", assignment_method: "Advanced round robin", priority: "10", description: "Cases waiting for a callback" }
];

export const EXAMPLE_FILE_NAME = "advanced-queues-example.csv";

export function exampleCsv(): string {
  const headers = COLUMNS.map((c) => c.header);
  return toCsv(headers, EXAMPLE_ROWS.map((row) => headers.map((h) => row[h] ?? "")));
}

export function emptyTemplateCsv(): string {
  return toCsv(COLUMNS.map((c) => c.header), []);
}
