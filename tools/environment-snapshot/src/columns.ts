// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { AttributeMeta, Row, SnapshotColumn, TableMeta } from "./model";

// Which columns of a table go into a snapshot, and how a value reads.
//
// In: every readable column, with its display name. Out:
// - secrets: API keys, passwords, tokens, connection strings (workstreams carry API keys, for one);
// - helper columns Dataverse derives from another column (a lookup's name, a choice's label: the value
//   itself already reads as that label);
// - system bookkeeping that says nothing about the configuration (row version, import sequence,
//   solution-layer details) and file or image contents.

const SECRET = /(apikey|api_key|secret|password|passwd|token|connectionstring|clientsecret|privatekey|sharedkey|accesskey|signingkey)/i;

const NOISE = new Set([
  "versionnumber", "importsequencenumber", "overriddencreatedon", "timezoneruleversionnumber", "utcconversiontimezonecode",
  "exchangerate", "componentstate", "componentidunique", "overwritetime", "solutionid", "ismanaged", "iscustomizable",
  "owninguser", "owningteam", "owningbusinessunit", "traversedpath", "stageid", "processid"
]);

const SKIPPED_TYPES = new Set(["EntityName", "ManagedProperty", "CalendarRules", "PartyList"]);
const SKIPPED_TYPE_NAMES = new Set(["ImageType", "FileType"]);

// Settings about a secret that aren't secret themselves: when a token expires, a key's version.
const ABOUT_A_SECRET = /(expirationtime|expirytime|expiration|versionnumber)$/i;

export function isSecret(logicalName: string): boolean {
  return SECRET.test(logicalName) && !ABOUT_A_SECRET.test(logicalName);
}

function keep(attribute: AttributeMeta): boolean {
  if (!attribute.readable || attribute.attributeOf) return false;
  if (NOISE.has(attribute.logicalName) || attribute.logicalName.endsWith("_base")) return false;
  if (SKIPPED_TYPES.has(attribute.type) || (attribute.typeName && SKIPPED_TYPE_NAMES.has(attribute.typeName))) return false;
  // Virtual columns are helpers, except multi-select choices.
  if (attribute.type === "Virtual" && attribute.typeName !== "MultiSelectPicklistType") return false;
  return true;
}

const LOOKUP_TYPES = new Set(["Lookup", "Owner", "Customer"]);

// The key a column has in a row: lookups come back as `_<name>_value`.
export function rowKey(attribute: AttributeMeta): string {
  return LOOKUP_TYPES.has(attribute.type) ? `_${attribute.logicalName}_value` : attribute.logicalName;
}

// Columns in a sensible order: the name first, then the rest by label, the record's own id last.
export function chooseColumns(meta: TableMeta): { columns: SnapshotColumn[]; leftOut: string[] } {
  const leftOut = meta.attributes.filter((a) => a.readable && !a.attributeOf && isSecret(a.logicalName)).map((a) => a.logicalName).sort();
  const columns = meta.attributes
    .filter((a) => keep(a) && !isSecret(a.logicalName))
    .map((a): SnapshotColumn => ({ key: rowKey(a), logicalName: a.logicalName, label: a.label?.trim() || a.logicalName, type: a.type }));
  const rank = (c: SnapshotColumn) => c.logicalName === meta.primaryName ? 0 : c.logicalName === meta.primaryId ? 2 : 1;
  columns.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  return { columns, leftOut };
}

const FORMATTED = "@OData.Community.Display.V1.FormattedValue";

// How a value reads: Dataverse's own label (a choice's text, a lookup's name, a date in the user's
// format) when there is one, otherwise the value itself.
export function cellText(row: Row, column: SnapshotColumn): string {
  const formatted = row[`${column.key}${FORMATTED}`];
  if (typeof formatted === "string" && formatted !== "") return formatted;
  const value = row[column.key];
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// A value by column name, readable; for code that knows which column it wants.
export function text(row: Row, key: string): string {
  return cellText(row, { key, logicalName: key, label: key, type: "" });
}

export function lookupId(row: Row, logicalName: string): string | undefined {
  const value = row[`_${logicalName}_value`];
  return typeof value === "string" && value ? value.replace(/[{}]/g, "").toLowerCase() : undefined;
}

export function idOf(row: Row, key: string | undefined): string | undefined {
  const value = key ? row[key] : undefined;
  return typeof value === "string" && value ? value.replace(/[{}]/g, "").toLowerCase() : undefined;
}
