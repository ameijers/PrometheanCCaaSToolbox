// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Snapshot, SnapshotTable } from "./model";

// The snapshot file: a snapshot saved as JSON, to compare later with Environment Compare. It holds the
// rows as read (secrets were already dropped on read), with their readable labels, so a comparison can
// match records by name or by id.

export const FILE_FORMAT = "promethean-ccaas-snapshot";
export const FILE_VERSION = 1;

export interface SnapshotFile {
  format: typeof FILE_FORMAT;
  version: number;
  snapshot: Snapshot;
}

export function toFile(snapshot: Snapshot): string {
  const file: SnapshotFile = { format: FILE_FORMAT, version: FILE_VERSION, snapshot };
  return JSON.stringify(file);
}

const isTable = (t: any): t is SnapshotTable =>
  t && typeof t.logicalName === "string" && typeof t.label === "string" && Array.isArray(t.columns) && Array.isArray(t.rows) && typeof t.status === "string";

// Reads a snapshot file. Throws with a plain message when it isn't one.
export function fromFile(text: string): Snapshot {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This isn't a snapshot file: it can't be read as JSON. Download one with Environment Snapshot (Download snapshot file).");
  }
  if (parsed?.format !== FILE_FORMAT) throw new Error("This isn't a snapshot file from Environment Snapshot.");
  if (typeof parsed.version !== "number" || parsed.version > FILE_VERSION) throw new Error(`This snapshot file is from a newer version of Environment Snapshot (file version ${parsed.version}). Update the toolbox to compare it.`);
  const snapshot = parsed.snapshot;
  if (!snapshot || typeof snapshot.environment !== "string" || typeof snapshot.takenAt !== "string" || !Array.isArray(snapshot.tables) || !snapshot.tables.every(isTable)) {
    throw new Error("This snapshot file is incomplete or damaged.");
  }
  return { ...snapshot, warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [] };
}
