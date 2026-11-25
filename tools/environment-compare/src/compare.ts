// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { cellText } from "../../environment-snapshot/src/columns";
import { Row, Snapshot, SnapshotColumn, SnapshotTable } from "../../environment-snapshot/src/model";
import { rulesetText } from "../../environment-snapshot/src/rules";
import { SECTIONS } from "../../environment-snapshot/src/tables";

// Compares two snapshots, table by table and record by record. Pure: it reads nothing.
//
// Records are matched by name or by id, as chosen:
// - by name: the record's name (or, for link records without a name, the records they link); record
//   ids inside values (a rule's target queue, a lookup) are replaced by that record's name first, so a
//   rule that routes to "Sales – NL" is the same in both environments whatever the queue's id is;
// - by id: the record's id, and values exactly as stored. Fits environments filled from the same
//   solution or copied from each other.
// Ids, dates and owners always differ and are never compared. Phone numbers, users and memberships are
// compared but marked as expected to differ per environment.

export type MatchBy = "name" | "id";
export type ItemStatus = "onlyA" | "onlyB" | "different" | "same";

export interface SettingDiff {
  key: string;
  label: string;
  a: string;
  b: string;
  envSpecific: boolean;
}

export interface ItemDiff {
  key: string;
  name: string;
  status: ItemStatus;
  diffs: SettingDiff[];
  envSpecific: boolean;
  note?: string;
}

export interface TableDiff {
  logicalName: string;
  label: string;
  section: string;
  envSpecific: boolean;
  // Why a table has no rows to compare on one side.
  notes: string[];
  items: ItemDiff[];
}

export interface Comparison {
  a: { environment: string; takenAt: string; takenBy: string };
  b: { environment: string; takenAt: string; takenBy: string };
  matchBy: MatchBy;
  tables: TableDiff[];
}

// Tables and columns that hold what differs per environment by nature.
export const ENV_TABLES = new Set(["systemuser", "queuemembership", "teammembership", "systemuserroles", "bookableresource", "bookableresourcecharacteristic", "msdyn_bookableresourcecapacityprofile", "msdyn_ocphonenumber"]);
export const ENV_COLUMNS = new Set(["_msdyn_phonenumberid_value", "_msdyn_calleridphonenumberid_value", "_msdyn_bot_user_value", "msdyn_phonenumber"]);

// Never compared: they always differ between environments.
const ALWAYS_IGNORED = new Set(["createdon", "modifiedon", "_createdby_value", "_modifiedby_value", "_createdonbehalfby_value", "_modifiedonbehalfby_value", "_ownerid_value", "overriddencreatedon"]);

// Link records without a meaningful name of their own: matched by the records they link.
export const KEY_COLUMNS: Record<string, string[]> = {
  bookableresourcecharacteristic: ["_resource_value", "_characteristic_value"],
  msdyn_bookableresourcecapacityprofile: ["_msdyn_bookableresourceid_value", "_msdyn_capacityprofileid_value"],
  msdyn_liveworkstreamcapacityprofile: ["_msdyn_workstream_id_value", "_msdyn_capacityprofile_id_value"],
  msdyn_ocvoicechannellanguagesetting: ["_msdyn_ocvoicechannelsettingid_value", "_msdyn_languageid_value"],
  msdyn_ocliveworkstreamcontextvariable: ["_msdyn_liveworkstreamid_value", "msdyn_name"],
  msdyn_routingconfigurationstep: ["_msdyn_routingconfigurationid_value", "msdyn_name"],
  msdyn_assignmentconfiguration: ["_msdyn_queueid_value", "msdyn_name"],
  msdyn_assignmentconfigurationstep: ["_msdyn_assignmentconfigurationid_value", "msdyn_name"],
  queuemembership: ["queue", "agent"],
  teammembership: ["team", "agent"],
  systemuserroles: ["agent", "role", "businessunit"]
};
// The id columns of the tables Environment Snapshot makes itself.
const DERIVED_IDS: Record<string, string[]> = { queuemembership: ["queueid", "systemuserid"], teammembership: ["teamid", "systemuserid"], systemuserroles: ["systemuserid", "roleid"] };

const GUID = /\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?/gi;
const LOOKUP = /^_.*_value$/;

// Every record's name by id, to put names where ids are.
function namesOf(snapshot: Snapshot): Map<string, string> {
  const names = new Map<string, string>();
  snapshot.tables.forEach((t) => {
    if (!t.idKey || !t.nameKey) return;
    t.rows.forEach((r) => {
      const id = typeof r[t.idKey!] === "string" ? r[t.idKey!].toLowerCase() : undefined;
      const name = r[t.nameKey!];
      if (id && typeof name === "string" && name) names.set(id, name);
    });
  });
  return names;
}

// By name: ids become names ("(id)" when the snapshot doesn't have that record).
function withNames(value: string, names: Map<string, string>): string {
  return value.replace(GUID, (_all, id: string) => names.has(id.toLowerCase()) ? `"${names.get(id.toLowerCase())}"` : "(id)");
}

interface Side { snapshot: Snapshot; names: Map<string, string>; labels: Record<string, string>; }

// Context variables by display name, to word rules as the snapshot document does.
function variableLabels(snapshot: Snapshot): Record<string, string> {
  const variables = snapshot.tables.find((t) => t.logicalName === "msdyn_ocliveworkstreamcontextvariable")?.rows ?? [];
  return Object.fromEntries(variables.filter((v) => v.msdyn_displayname && v.msdyn_name).map((v) => [String(v.msdyn_name), String(v.msdyn_displayname)]));
}

function isIgnored(table: SnapshotTable, column: SnapshotColumn, matchBy: MatchBy): boolean {
  if (ALWAYS_IGNORED.has(column.key) || column.key === table.idKey) return true;
  if (matchBy === "name") {
    if (column.type === "Uniqueidentifier" || /uniquename$/i.test(column.logicalName)) return true;
    if (table.derived && /id$/.test(column.key)) return true;
    // A ruleset's disabled rules are listed by rule id; the worded rules say which rules are off.
    if (table.logicalName === "msdyn_decisionruleset" && column.key === "msdyn_disabledrules") return true;
  }
  return false;
}

// A value as it's compared and shown.
function value(table: SnapshotTable, row: Row, column: SnapshotColumn, side: Side, matchBy: MatchBy): string {
  if (table.logicalName === "msdyn_decisionruleset" && column.key === "msdyn_rulesetdefinition") {
    const worded = rulesetText(row.msdyn_rulesetdefinition, row.msdyn_disabledrules, side.names, side.labels);
    if (matchBy === "name" && worded) {
      return [`${worded.hitPolicy === "first" ? "First match" : "Every match"}`, ...worded.rules.map((r, i) => `${i + 1}. ${r.name}${r.enabled ? "" : " (off)"}: when ${r.when} → ${r.then}`)].join("\n");
    }
    if (matchBy === "name") return withNames(String(row.msdyn_rulesetdefinition ?? ""), side.names);
    return String(row.msdyn_rulesetdefinition ?? "");
  }
  const text = cellText(row, column);
  if (matchBy === "id" && LOOKUP.test(column.key)) {
    const id = row[column.key];
    return typeof id === "string" && id ? (text && text !== id ? `${text} (${id.toLowerCase()})` : id.toLowerCase()) : "";
  }
  return matchBy === "name" ? withNames(text, side.names) : text;
}

function keyOf(table: SnapshotTable, row: Row, side: Side, matchBy: MatchBy, columns: SnapshotColumn[]): string {
  if (matchBy === "id") {
    if (table.derived) return (DERIVED_IDS[table.logicalName] ?? []).map((k) => String(row[k] ?? "")).join("|");
    const id = table.idKey ? row[table.idKey] : undefined;
    return typeof id === "string" ? id.toLowerCase() : JSON.stringify(row);
  }
  const keys = KEY_COLUMNS[table.logicalName];
  const textOf = (key: string) => {
    const column = columns.find((c) => c.key === key) ?? { key, logicalName: key, label: key, type: "" };
    return withNames(cellText(row, column), side.names).trim().toLowerCase();
  };
  if (keys) return keys.map(textOf).join(" · ");
  if (table.nameKey && typeof row[table.nameKey] === "string" && row[table.nameKey]) return textOf(table.nameKey);
  return columns.filter((c) => LOOKUP.test(c.key)).map((c) => textOf(c.key)).join(" · ");
}

function displayName(table: SnapshotTable, row: Row, side: Side, columns: SnapshotColumn[]): string {
  const keys = KEY_COLUMNS[table.logicalName];
  const textOf = (key: string) => withNames(cellText(row, columns.find((c) => c.key === key) ?? { key, logicalName: key, label: key, type: "" }), side.names);
  if (keys) return keys.map(textOf).filter(Boolean).join(" · ");
  if (table.nameKey && row[table.nameKey]) return withNames(String(row[table.nameKey]), side.names);
  return columns.filter((c) => LOOKUP.test(c.key)).map((c) => textOf(c.key)).filter(Boolean).join(" · ") || "(no name)";
}

// Records grouped by key. When a name isn't unique on a side, its links are added to the key; records
// that still share one are paired in order and noted.
function index(table: SnapshotTable, side: Side, matchBy: MatchBy, columns: SnapshotColumn[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  table.rows.forEach((row) => {
    let key = keyOf(table, row, side, matchBy, columns);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  if (matchBy === "name" && !KEY_COLUMNS[table.logicalName] && [...groups.values()].some((g) => g.length > 1)) {
    const refined = new Map<string, Row[]>();
    groups.forEach((rows, key) => rows.forEach((row) => {
      const extended = rows.length > 1 ? `${key} · ${columns.filter((c) => LOOKUP.test(c.key) && !ALWAYS_IGNORED.has(c.key)).map((c) => withNames(cellText(row, c), side.names).toLowerCase()).join(" · ")}` : key;
      refined.set(extended, [...(refined.get(extended) ?? []), row]);
    }));
    return refined;
  }
  return groups;
}

function compareTable(logicalName: string, a: SnapshotTable | undefined, b: SnapshotTable | undefined, sideA: Side, sideB: Side, matchBy: MatchBy): TableDiff {
  const base = (a ?? b)!;
  const envTable = ENV_TABLES.has(logicalName);
  const notes: string[] = [];
  const statusNote = (t: SnapshotTable | undefined, side: string) => {
    if (!t) notes.push(`Not in snapshot ${side}.`);
    else if (t.status === "notFound") notes.push(`Not in environment ${side}.`);
    else if (t.status !== "ok") notes.push(`Couldn't be read in ${side}: ${t.message ?? t.status}.`);
  };
  statusNote(a, "A");
  statusNote(b, "B");
  const unreadable = (t: SnapshotTable | undefined) => !t || (t.status !== "ok" && t.status !== "notFound");
  const result: TableDiff = { logicalName, label: base.label, section: SECTIONS.find((s) => s.id === base.section)?.title ?? base.section, envSpecific: envTable, notes, items: [] };
  // Without a reading on one side, "only in" would be wrong; the table is reported, not compared.
  if (unreadable(a) || unreadable(b)) return result;

  const columns = [...(a?.columns ?? [])];
  (b?.columns ?? []).forEach((c) => { if (!columns.some((x) => x.key === c.key)) columns.push(c); });
  const compared = columns.filter((c) => !isIgnored(base, c, matchBy));
  const left = index(a!, sideA, matchBy, columns);
  const right = index(b!, sideB, matchBy, columns);
  const keys = [...new Set([...left.keys(), ...right.keys()])];

  keys.forEach((key) => {
    const rowsA = left.get(key) ?? [];
    const rowsB = right.get(key) ?? [];
    const pairs = Math.max(rowsA.length, rowsB.length);
    const note = rowsA.length > 1 || rowsB.length > 1 ? "Several records share this name; they're compared in order." : undefined;
    for (let i = 0; i < pairs; i++) {
      const rowA = rowsA[i];
      const rowB = rowsB[i];
      const name = rowA ? displayName(a!, rowA, sideA, columns) : displayName(b!, rowB!, sideB, columns);
      if (!rowA || !rowB) {
        result.items.push({ key: `${key}#${i}`, name, status: rowA ? "onlyA" : "onlyB", diffs: [], envSpecific: envTable, note });
        continue;
      }
      const diffs: SettingDiff[] = compared.flatMap((column): SettingDiff[] => {
        const va = value(a!, rowA, column, sideA, matchBy);
        const vb = value(b!, rowB, column, sideB, matchBy);
        return va === vb ? [] : [{ key: column.key, label: column.label, a: va, b: vb, envSpecific: envTable || ENV_COLUMNS.has(column.key) }];
      });
      result.items.push({ key: `${key}#${i}`, name, status: diffs.length ? "different" : "same", diffs, envSpecific: envTable, note });
    }
  });
  const order: Record<ItemStatus, number> = { different: 0, onlyA: 1, onlyB: 2, same: 3 };
  result.items.sort((x, y) => order[x.status] - order[y.status] || x.name.localeCompare(y.name));
  return result;
}

export function compareSnapshots(a: Snapshot, b: Snapshot, matchBy: MatchBy): Comparison {
  const sideA: Side = { snapshot: a, names: namesOf(a), labels: variableLabels(a) };
  const sideB: Side = { snapshot: b, names: namesOf(b), labels: variableLabels(b) };
  const names = [...a.tables.map((t) => t.logicalName), ...b.tables.map((t) => t.logicalName).filter((n) => !a.tables.some((t) => t.logicalName === n))];
  const meta = (s: Snapshot) => ({ environment: s.environment, takenAt: s.takenAt, takenBy: s.takenBy });
  return {
    a: meta(a), b: meta(b), matchBy,
    tables: names.map((n) => compareTable(n, a.tables.find((t) => t.logicalName === n), b.tables.find((t) => t.logicalName === n), sideA, sideB, matchBy))
  };
}

// What's left to show with environment-specific differences hidden: those tables go, those settings
// are dropped, and a record whose only differences were environment-specific counts as the same.
export function withoutEnvSpecific(comparison: Comparison): Comparison {
  return {
    ...comparison,
    tables: comparison.tables.filter((t) => !t.envSpecific).map((t) => ({
      ...t,
      items: t.items.map((item) => {
        if (item.status !== "different") return item;
        const diffs = item.diffs.filter((d) => !d.envSpecific);
        return { ...item, diffs, status: diffs.length ? "different" : "same" } as ItemDiff;
      })
    }))
  };
}

export function counts(items: ItemDiff[]): Record<ItemStatus, number> {
  const result: Record<ItemStatus, number> = { onlyA: 0, onlyB: 0, different: 0, same: 0 };
  items.forEach((i) => { result[i.status]++; });
  return result;
}
