import { ParsedCsv, toCsv } from "../../voice-workstream-builder/src/csv";
import { Issue } from "./model";

// CSV column definitions and a row reader shared by the provisioning tools. Each tool lists its
// columns once; the list drives the example file, the in-app reference and validation.

export interface ColumnDef {
  header: string;
  required?: boolean;
  choices?: readonly string[];
  defaultValue?: string;
  empty?: string;        // what an empty cell means, for the reference ("not set", "the root", …)
  list?: boolean;        // several values separated by |
  description: string;
}

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function splitList(raw: string): string[] {
  return raw.split(/[|;]/).map((v) => v.trim()).filter(Boolean);
}

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Row {
  line: number;
  cell(header: string): string;
  has(header: string): boolean;
  // A choice column: the canonical value, or the default when empty. Invalid values are reported.
  choice(header: string): string;
  // A list column, de-duplicated case-insensitively (repeats are reported as a warning).
  list(header: string): string[];
}

export interface ReadResult {
  rows: Row[];
  issues: Issue[];
}

// Reads the CSV against the tool's columns: file-level checks (key column present, unknown or repeated
// columns, no rows) and a Row accessor per record that reports cell problems against the row's item.
export function readRows(csv: ParsedCsv, columns: ColumnDef[], keyColumn: string): ReadResult {
  const issues: Issue[] = [];
  const byHeader = new Map(columns.map((c) => [c.header, c]));
  const headers = csv.headers.map(normalizeHeader);
  if (!headers.includes(keyColumn)) {
    issues.push({ severity: "error", message: `The file has no ${keyColumn} column. Start from the example: its first line must be the column headers.` });
    return { rows: [], issues };
  }
  const unknown = csv.headers.filter((h, i) => h && !byHeader.has(headers[i]));
  if (unknown.length) issues.push({ severity: "warning", message: `Ignored column${unknown.length > 1 ? "s" : ""} not in the template: ${unknown.join(", ")}.` });
  const duplicated = headers.filter((h, i) => h && headers.indexOf(h) !== i);
  if (duplicated.length) issues.push({ severity: "error", message: `Column${duplicated.length > 1 ? "s" : ""} listed twice: ${[...new Set(duplicated)].join(", ")}.` });
  if (!csv.records.length) issues.push({ severity: "error", message: "The file has a header line but no rows." });

  const rows = csv.records.map(({ line, cells }): Row => {
    const cell = (h: string) => { const i = headers.indexOf(h); return i >= 0 ? (cells[i] ?? "").trim() : ""; };
    const item = () => cell(keyColumn) || undefined;
    return {
      line,
      cell,
      has: (h) => cell(h) !== "",
      choice: (h) => {
        const def = byHeader.get(h)!;
        const value = cell(h) || def.defaultValue || "";
        const match = def.choices?.find((c) => c.toLowerCase() === value.toLowerCase());
        if (!match) { issues.push({ severity: "error", line, column: h, item: item(), message: `"${value}" isn't a valid ${h}. Use one of: ${def.choices?.join(", ")}.` }); return def.defaultValue ?? ""; }
        return match;
      },
      list: (h) => {
        const def = byHeader.get(h)!;
        const values = splitList(cell(h) || def.defaultValue || "");
        const seen = new Set<string>();
        const repeated: string[] = [];
        const unique = values.filter((v) => { const k = v.toLowerCase(); if (seen.has(k)) { repeated.push(v); return false; } seen.add(k); return true; });
        if (repeated.length) issues.push({ severity: "warning", line, column: h, item: item(), message: `Listed more than once: ${[...new Set(repeated)].join(", ")}. Used once.` });
        return unique;
      }
    };
  });
  return { rows, issues };
}

export function exampleCsvFrom(columns: ColumnDef[], rows: Record<string, string>[]): string {
  const headers = columns.map((c) => c.header);
  return toCsv(headers, rows.map((row) => headers.map((h) => row[h] ?? "")));
}

export function emptyCsvFrom(columns: ColumnDef[]): string {
  return toCsv(columns.map((c) => c.header), []);
}

// Matching by name, case-insensitively: one match, none, or ambiguous.
export function findOne<T>(records: T[], wanted: string, keys: (r: T) => (string | undefined)[]): { record?: T; count: number } {
  const w = wanted.trim().toLowerCase();
  const matches = records.filter((r) => keys(r).some((k) => k?.trim().toLowerCase() === w));
  return { record: matches.length === 1 ? matches[0] : undefined, count: matches.length };
}
