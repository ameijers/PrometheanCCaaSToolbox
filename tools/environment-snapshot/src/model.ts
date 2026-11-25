// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// A snapshot: every configuration table of the environment, read once, with readable column labels.
// The PDF document and the Excel workbook are both built from it.

export type Row = Record<string, any>;

export interface SnapshotColumn {
  // The key in a row as Dataverse returns it: `msdyn_name`, or `_msdyn_defaultqueue_value` for a lookup.
  key: string;
  logicalName: string;
  label: string;
  // Dataverse attribute type (String, Lookup, Picklist, ...), or "Text" for a column this tool adds.
  type: string;
}

export type TableStatus = "ok" | "notFound" | "noPermission" | "error";

export interface SnapshotTable {
  logicalName: string;
  label: string;
  section: SectionId;
  // What the rows are, when not every row is read (e.g. "contact center queues only").
  scope?: string;
  status: TableStatus;
  message?: string;
  columns: SnapshotColumn[];
  rows: Row[];
  idKey?: string;
  nameKey?: string;
  // Columns left out on purpose: secrets (keys, passwords, tokens) are never in a snapshot.
  leftOut: string[];
  // Made by this tool from other reads (queue members, team members, security roles).
  derived?: boolean;
}

export type SectionId = "channels" | "workstreams" | "routing" | "queues" | "agents" | "experience" | "messages";

export interface Section {
  id: SectionId;
  title: string;
  description: string;
}

export interface Snapshot {
  environment: string;
  takenAt: string;   // ISO time
  takenBy: string;
  mode: "live" | "demo";
  tables: SnapshotTable[];
  warnings: string[];
}

// What a source can do: describe a table (null when it doesn't exist) and read its rows. Live, it's
// Dataverse (read-only); in the demo, a sample environment in memory.
export interface TableMeta {
  logicalName: string;
  label: string;
  primaryId: string;
  primaryName?: string;
  attributes: AttributeMeta[];
}

export interface AttributeMeta {
  logicalName: string;
  label?: string;
  type: string;          // AttributeType
  typeName?: string;     // AttributeTypeName.Value, e.g. MultiSelectPicklistType
  attributeOf?: string;
  readable: boolean;
}

export class SourceError extends Error {
  constructor(public readonly kind: Exclude<TableStatus, "ok">, message: string) {
    super(message);
  }
}

export interface SnapshotSource {
  mode: "live" | "demo";
  environment(): string;
  user(): string;
  describe(logicalName: string): Promise<TableMeta | null>;
  // Every row (all columns), optionally filtered with an OData $filter.
  rows(logicalName: string, filter?: string): Promise<Row[]>;
  // Rows whose `idColumn` is one of `ids`, with only the columns in `select`.
  rowsByIds(logicalName: string, idColumn: string, ids: string[], select: string[]): Promise<Row[]>;
}
