// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ReferenceGraph, brokenReferenceFindings, buildGraph, inboundEdges, structuralCoverage, structuralFindings } from "./engine";
import { housekeepingFindings } from "./housekeeping";
import { CONFIDENCE_ORDER, EdgeSpec, Finding, Snapshot, TableCheckMode, TableStatus, Verification, recordKey } from "./model";
import { TABLES } from "./referenceMap";
import { runRules } from "./rules";

// Shown in the UI on every view, and in every export — not just in the docs.
export const DISCLAIMER = "Every finding is a candidate for review, never a confirmed \"safe to delete\". This tool only reads Dataverse, and can't see every place a record might be used: Power Automate flows, canvas and custom pages, Copilot Studio bots, plug-ins and scripts, other solutions, security configuration and code components can all depend on a record without any trace in the tables scanned here.";

export interface EdgeCoverage {
  description: string;
  from: string;
  field: string;
  kind: EdgeSpec["kind"];
  verification: Verification;
  semantics: EdgeSpec["semantics"];
  available: boolean;
  reason?: string;
}

export interface TableCoverage {
  table: string;
  label: string;
  verification: Verification;
  check: TableCheckMode;
  status: TableStatus;
  message?: string;
  rowCount: number;
  // Whether the generic "nothing references it" check could run (generic tables only).
  structural?: { evaluated: boolean; reason?: string; gaps: string[] };
  inbound: EdgeCoverage[];
  droppedColumns: string[];
  discovery: "ok" | "unavailable" | "notRun";
  notes: string;
}

export interface AnalysisResult {
  snapshot: Snapshot;
  graph: ReferenceGraph;
  findings: Finding[];
  coverage: TableCoverage[];
  // Checks skipped because the data they need couldn't be read.
  skipped: string[];
}

function edgeCoverage(graph: ReferenceGraph, edge: EdgeSpec): EdgeCoverage {
  const availability = graph.edgeAvailability(edge);
  return { description: edge.description, from: edge.from, field: edge.field, kind: edge.kind, verification: edge.verification, semantics: edge.semantics, available: availability.available, reason: availability.reason };
}

export function analyze(snapshot: Snapshot, now: Date = new Date()): AnalysisResult {
  const graph = buildGraph(snapshot);
  const rules = runRules(snapshot, graph);
  const deadKeys = new Set(rules.findings.filter((f) => f.marksDead).map((f) => recordKey(f.table, f.recordId)));
  const findings = [
    ...structuralFindings(snapshot, graph, deadKeys),
    ...rules.findings,
    ...brokenReferenceFindings(snapshot, graph),
    ...housekeepingFindings(snapshot, now)
  ].sort((a, b) => CONFIDENCE_ORDER.indexOf(a.confidence) - CONFIDENCE_ORDER.indexOf(b.confidence) || a.table.localeCompare(b.table) || a.recordName.localeCompare(b.recordName));

  const order = (name: string) => { const index = TABLES.findIndex((t) => t.logicalName === name); return index < 0 ? TABLES.length : index; };
  const coverage = Object.values(snapshot.tables).sort((a, b) => order(a.spec.logicalName) - order(b.spec.logicalName)).map((table): TableCoverage => {
    const name = table.spec.logicalName;
    const structural = table.spec.check === "generic" && table.status === "ok" ? structuralCoverage(snapshot, graph, name) : undefined;
    return {
      table: name,
      label: table.spec.label,
      verification: table.spec.verification,
      check: table.spec.check,
      status: table.status,
      message: table.message,
      rowCount: table.rows.length,
      structural: structural && { evaluated: structural.evaluated, reason: structural.reason, gaps: structural.gaps },
      inbound: inboundEdges(snapshot, name).map((edge) => edgeCoverage(graph, edge)),
      droppedColumns: table.droppedColumns,
      discovery: table.discovery,
      notes: table.spec.notes
    };
  });

  return { snapshot, graph, findings, coverage, skipped: rules.notes };
}
