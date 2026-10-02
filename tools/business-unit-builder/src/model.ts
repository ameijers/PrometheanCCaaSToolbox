// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  message: string;
  line?: number;
  column?: string;
  unit?: string;
}

// An existing business unit, read before review.
export interface ExistingUnit {
  id: string;
  name: string;
  parentId?: string;   // undefined for the root business unit
  disabled: boolean;
}

export interface Catalog {
  units: ExistingUnit[];
}

// Where a new business unit hangs: under an existing one, or under another row of the same file.
export type ParentRef = { kind: "existing"; unit: ExistingUnit } | { kind: "planned"; key: string };

export interface PlannedUnit {
  line: number;
  key: string;                    // lowercased name
  name: string;
  parentName?: string;            // as written; undefined = the root
  parent?: ParentRef;             // resolved; undefined when it couldn't be
  fields: Record<string, string>; // businessunit column -> value, only the filled-in ones
  depth: number;                  // 1 = directly under an existing business unit
}

export interface Plan {
  // In creation order: every parent before its children.
  units: PlannedUnit[];
  issues: Issue[];
  rowCount: number;
  root?: ExistingUnit;
}

export function errorCount(issues: Issue[]): number {
  return issues.filter((i) => i.severity === "error").length;
}

// --- execution results -----------------------------------------------------------------------------

export type UnitStatus = "created" | "failed" | "skipped";

export interface UnitResult {
  name: string;
  parentName: string;
  status: UnitStatus;
  id?: string;
  error?: string;
  at?: string;
  notes: string[];
}
