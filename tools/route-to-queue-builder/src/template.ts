// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "../../voice-workstream-builder/src/csv";

// The CSV contract: one row per rule. This list drives the example file, validation and the in-app
// column reference. The context variable and the default ruleset name are entered on the page.

export interface ColumnDef {
  header: string;
  required?: boolean;
  description: string;
}

export const COLUMNS: ColumnDef[] = [
  { header: "workstream_name", required: true, description: "The workstream whose route-to-queue rules get this rule, by name." },
  { header: "rule_name", required: true, description: "Name of the rule, as shown in the admin center. Must be unique within the workstream's ruleset." },
  { header: "menu_value", required: true, description: "The value the context variable must equal for this rule, e.g. the menu option chosen in the IVR. Compared as text, exactly." },
  { header: "queue_name", required: true, description: "The advanced queue the conversation is routed to, by name." }
];

export const COLUMN_BY_HEADER = new Map(COLUMNS.map((c) => [c.header, c]));

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// The example offered in the Upload step (and kept in examples/). Every name in it exists in the
// sample environment.
const EXAMPLE_ROWS: Record<string, string>[] = [
  { workstream_name: "Sales – Voice", rule_name: "Route to new sales", menu_value: "NewOrder", queue_name: "Sales – NL" },
  { workstream_name: "Sales – Voice", rule_name: "Route to order status", menu_value: "OrderStatus", queue_name: "Sales – Orders" },
  { workstream_name: "Support – Voice", rule_name: "Route to returns", menu_value: "Returns", queue_name: "Support – Returns" },
  { workstream_name: "Support – Voice", rule_name: "Route to technical support", menu_value: "Technical", queue_name: "Support – Technical" },
  { workstream_name: "Billing – Voice", rule_name: "Route to invoices", menu_value: "Invoice", queue_name: "Billing" }
];

export const EXAMPLE_FILE_NAME = "route-to-queue-example.csv";

export function exampleCsv(): string {
  const headers = COLUMNS.map((c) => c.header);
  return toCsv(headers, EXAMPLE_ROWS.map((row) => headers.map((h) => row[h] ?? "")));
}

export function emptyTemplateCsv(): string {
  return toCsv(COLUMNS.map((c) => c.header), []);
}
