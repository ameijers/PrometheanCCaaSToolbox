// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { Issue, ParsedPlan, QueueSpec } from "./model";
import { AssignmentMethod, QueueType, Visibility } from "./queueSchema";
import { COLUMN_BY_HEADER, normalizeHeader } from "./template";

// Turns a parsed CSV into queue specs plus every problem found, without looking at the environment.
// Names that point at existing records (operating hours, users) and duplicates against existing queues
// are checked afterwards by resolve.ts.

export function splitMembers(raw: string): string[] {
  return raw.split(/[|;,]/).map((m) => m.trim()).filter(Boolean);
}

export function validateCsv(csv: ParsedCsv): ParsedPlan {
  const issues: Issue[] = [];
  const headers = csv.headers.map(normalizeHeader);

  if (!headers.includes("queue_name")) {
    issues.push({ severity: "error", message: "The file has no queue_name column. Start from the example: its first line must be the column headers." });
    return { queues: [], issues, rowCount: csv.records.length };
  }
  const unknown = csv.headers.filter((h, i) => h && !COLUMN_BY_HEADER.has(headers[i]));
  if (unknown.length) issues.push({ severity: "warning", message: `Ignored column${unknown.length > 1 ? "s" : ""} not in the template: ${unknown.join(", ")}.` });
  const duplicated = headers.filter((h, i) => h && headers.indexOf(h) !== i);
  if (duplicated.length) issues.push({ severity: "error", message: `Column${duplicated.length > 1 ? "s" : ""} listed twice: ${[...new Set(duplicated)].join(", ")}.` });

  const seen = new Map<string, number>();
  const queues: QueueSpec[] = [];

  csv.records.forEach((record) => {
    const line = record.line;
    const cell = (h: string) => { const i = headers.indexOf(h); return i >= 0 ? (record.cells[i] ?? "").trim() : ""; };
    const name = cell("queue_name");
    const error = (column: string | undefined, message: string) => issues.push({ severity: "error", line, column, queue: name || undefined, message });
    const warning = (column: string | undefined, message: string) => issues.push({ severity: "warning", line, column, queue: name || undefined, message });

    const choice = <T extends string>(header: string): T => {
      const def = COLUMN_BY_HEADER.get(header)!;
      const value = cell(header) || def.defaultValue || "";
      const match = def.choices?.find((c) => c.toLowerCase() === value.toLowerCase());
      if (!match) { error(header, `"${value}" isn't a valid ${header}. Use one of: ${def.choices?.join(", ")}.`); return def.defaultValue as T; }
      return match as T;
    };

    if (!name) { error("queue_name", "queue_name is empty. Every row needs the name of the queue to create."); return; }
    const key = name.toLowerCase();
    if (seen.has(key)) error("queue_name", `"${name}" is also on line ${seen.get(key)}. Each row creates one queue, so names must be unique.`);
    else seen.set(key, line);

    const priorityRaw = cell("priority") || "1";
    let priority = 1;
    if (!/^\d+$/.test(priorityRaw) || Number(priorityRaw) < 1) error("priority", `"${priorityRaw}" isn't a valid priority. Use a whole number of 1 or higher (1 is the highest priority).`);
    else priority = Number(priorityRaw);

    const members = splitMembers(cell("members"));
    const memberKeys = members.map((m) => m.toLowerCase());
    const repeated = members.filter((m, i) => memberKeys.indexOf(m.toLowerCase()) !== i);
    if (repeated.length) warning("members", `Listed more than once: ${[...new Set(repeated)].join(", ")}. They're added once.`);

    const spec: QueueSpec = {
      line,
      name,
      type: choice<QueueType>("queue_type"),
      assignmentMethod: choice<AssignmentMethod>("assignment_method"),
      priority,
      visibility: choice<Visibility>("visibility"),
      operatingHours: cell("operating_hours") || undefined,
      description: cell("description") || undefined,
      members: members.filter((m, i) => memberKeys.indexOf(m.toLowerCase()) === i)
    };
    if (!spec.members.length) warning("members", `"${name}" has no members, so no agent gets work from it until members are added.`);
    if (spec.visibility === "Private" && !spec.members.length) warning("visibility", "A private queue without members is visible to nobody but administrators.");
    queues.push(spec);
  });

  if (!csv.records.length) issues.push({ severity: "error", message: "The file has a header line but no rows." });
  return { queues, issues, rowCount: csv.records.length };
}
