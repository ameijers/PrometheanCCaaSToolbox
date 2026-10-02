import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { Catalog, ExistingUnit, Issue, Plan, PlannedUnit } from "./model";
import { COLUMNS, COLUMN_BY_HEADER, normalizeHeader } from "./template";

// Turns the CSV into business units to create, in an order that creates every parent before its
// children. A parent can be an existing business unit or another row of the same file; loops and
// missing parents are errors. Nothing here talks to Dataverse: the existing business units are read
// beforehand.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^(https?:\/\/)?[^\s.]+\.[^\s]+$/i;

export function rootUnit(catalog: Catalog): ExistingUnit | undefined {
  return catalog.units.find((u) => !u.parentId);
}

export function buildPlan(csv: ParsedCsv, catalog: Catalog): Plan {
  const issues: Issue[] = [];
  const headers = csv.headers.map(normalizeHeader);
  const root = rootUnit(catalog);

  if (!headers.includes("name")) {
    issues.push({ severity: "error", message: "The file has no name column. Start from the example: its first line must be the column headers." });
    return { units: [], issues, rowCount: csv.records.length, root };
  }
  const unknown = csv.headers.filter((h, i) => h && !COLUMN_BY_HEADER.has(headers[i]));
  if (unknown.length) issues.push({ severity: "warning", message: `Ignored column${unknown.length > 1 ? "s" : ""} not in the template: ${unknown.join(", ")}.` });
  const duplicated = headers.filter((h, i) => h && headers.indexOf(h) !== i);
  if (duplicated.length) issues.push({ severity: "error", message: `Column${duplicated.length > 1 ? "s" : ""} listed twice: ${[...new Set(duplicated)].join(", ")}.` });
  if (!csv.records.length) issues.push({ severity: "error", message: "The file has a header line but no rows." });
  if (!root) issues.push({ severity: "error", message: "The environment's root business unit couldn't be found, so business units can't be placed under it." });

  const existingByName = new Map<string, ExistingUnit[]>();
  catalog.units.forEach((u) => existingByName.set(u.name.trim().toLowerCase(), [...(existingByName.get(u.name.trim().toLowerCase()) ?? []), u]));

  // Pass 1: read every row.
  const rows: PlannedUnit[] = [];
  const firstLine = new Map<string, number>();
  csv.records.forEach(({ line, cells }) => {
    const cell = (h: string) => { const i = headers.indexOf(h); return i >= 0 ? (cells[i] ?? "").trim() : ""; };
    const name = cell("name");
    const error = (column: string, message: string) => issues.push({ severity: "error", line, column, unit: name || undefined, message });
    if (!name) { error("name", "name is empty. Every row needs the name of the business unit to create."); return; }
    const key = name.toLowerCase();

    if (firstLine.has(key)) { error("name", `"${name}" is also on line ${firstLine.get(key)}. Each row creates one business unit, so names must be unique.`); return; }
    firstLine.set(key, line);
    if (existingByName.has(key)) error("name", `A business unit named "${name}" already exists. This tool only creates new business units; rename the row or remove it.`);

    const fields: Record<string, string> = {};
    COLUMNS.forEach((c) => {
      if (!c.column) return;
      const value = cell(c.header);
      if (!value) return;
      if (c.maxLength && value.length > c.maxLength) error(c.header, `${c.header} is ${value.length} characters; the maximum is ${c.maxLength}.`);
      fields[c.column] = value;
    });
    if (fields.emailaddress && !EMAIL.test(fields.emailaddress)) error("email", `"${fields.emailaddress}" isn't an email address.`);
    if (fields.websiteurl && !URL_PATTERN.test(fields.websiteurl)) error("website", `"${fields.websiteurl}" isn't a web address.`);

    const parentName = cell("parent_business_unit") || undefined;
    if (parentName && parentName.toLowerCase() === key) error("parent_business_unit", `"${name}" can't be its own parent.`);
    rows.push({ line, key, name, parentName, fields, depth: 0 });
  });

  // Pass 2: resolve parents. A row in the file wins over nothing; a name that is both a new row and an
  // existing business unit is already an error above.
  const planned = new Map(rows.map((r) => [r.key, r]));
  rows.forEach((row) => {
    const error = (message: string) => issues.push({ severity: "error", line: row.line, column: "parent_business_unit", unit: row.name, message });
    if (!row.parentName) { if (root) row.parent = { kind: "existing", unit: root }; return; }
    const wanted = row.parentName.toLowerCase();
    if (wanted === row.key) return;
    if (planned.has(wanted)) { row.parent = { kind: "planned", key: wanted }; return; }
    const matches = existingByName.get(wanted) ?? [];
    if (matches.length > 1) return error(`${matches.length} business units are named "${row.parentName}", so it's not clear which one is meant.`);
    if (!matches.length) return error(`No business unit named "${row.parentName}" exists, and it isn't created in this file either.`);
    if (matches[0].disabled) return error(`The parent "${row.parentName}" is disabled. Enable it first, or choose another parent.`);
    row.parent = { kind: "existing", unit: matches[0] };
  });

  // Pass 3: depth and loops. Walk up each row's chain of parents in this file; the depth is the number
  // of steps to an existing business unit. A chain that comes back on itself is a loop.
  const loops = new Set<string>();
  rows.forEach((row) => {
    const seen: PlannedUnit[] = [];
    let current: PlannedUnit | undefined = row;
    while (current && current.parent?.kind === "planned") {
      if (seen.includes(current)) {
        const loop = seen.slice(seen.indexOf(current));
        const names = loop.map((r) => r.name);
        loop.forEach((r) => {
          if (loops.has(r.key)) return;
          loops.add(r.key);
          issues.push({ severity: "error", line: r.line, column: "parent_business_unit", unit: r.name, message: `"${r.name}" is part of a loop of parents (${[...names, names[0]].join(" → ")}). Every chain must end at an existing business unit.` });
        });
        // A row above the loop, not in it, can't be created either.
        if (!loops.has(row.key)) {
          loops.add(row.key);
          issues.push({ severity: "error", line: row.line, column: "parent_business_unit", unit: row.name, message: `"${row.name}" can't be created: its parents lead into a loop (${names.join(" → ")}).` });
        }
        return;
      }
      seen.push(current);
      current = planned.get(current.parent.key);
    }
    row.depth = seen.length + 1;
  });

  // Creation order: parents first (shallower first), and within a level in file order. Rows whose
  // parent couldn't be resolved, or that hang from such a row, have nowhere to go and aren't planned.
  const placeable = (r: PlannedUnit): boolean => !loops.has(r.key) && !!r.parent && (r.parent.kind === "existing" || placeable(planned.get(r.parent.key)!));
  const units = rows.filter((r) => placeable(r)).sort((a, b) => a.depth - b.depth || a.line - b.line);
  return { units, issues, rowCount: csv.records.length, root };
}

// The name of a planned unit's parent, for display and the log.
export function parentLabel(unit: PlannedUnit, plan: Plan): string {
  if (!unit.parent) return unit.parentName ?? "—";
  if (unit.parent.kind === "existing") return unit.parent.unit.name;
  return plan.units.find((u) => u.key === (unit.parent as { key: string }).key)?.name ?? unit.parentName ?? "—";
}
