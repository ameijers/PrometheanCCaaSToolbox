// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { CHECKS, CheckId, Confidence, EdgeSpec, Finding, RecordRow, RelatedRecord, Snapshot, TableData, extractIds, lookupValueKey, normalizeId, recordKey } from "./model";
import { isSubjectTable, tableLabel } from "./referenceMap";

// The generic reference-graph engine. Pure: takes a Snapshot (everything read from Dataverse, or
// demo data) and computes who keeps whom in use. Entity-specific rules (rules.ts) layer functional
// checks on top of the graph built here.

// `user` keeps the record this ref is filed under in use: for a "reference" edge the user is the
// row holding the lookup; for a "parent" edge the user is the parent the row belongs to.
export interface UsageRef {
  edge: EdgeSpec;
  user: RecordRow;
}

export interface OutRef {
  edge: EdgeSpec;
  targetId: string;
  target?: RecordRow;
}

export interface EdgeAvailability {
  available: boolean;
  reason?: string;
}

export interface ReferenceGraph {
  snapshot: Snapshot;
  byId: Map<string, RecordRow>;
  users: Map<string, UsageRef[]>;
  outbound: Map<string, OutRef[]>;
  neighbors: Map<string, Set<string>>;
  byKey: Map<string, RecordRow>;
  edgeAvailability: (edge: EdgeSpec) => EdgeAvailability;
  alive: (row: RecordRow) => boolean;
}

function okTable(snapshot: Snapshot, logicalName: string): TableData | undefined {
  const table = snapshot.tables[logicalName];
  return table && table.status === "ok" ? table : undefined;
}

// Resolves an edge's `to` list, expanding "*" to every in-scope subject table except the source.
export function edgeTargets(snapshot: Snapshot, edge: EdgeSpec): string[] {
  if (!edge.to.includes("*")) return edge.to;
  return Object.values(snapshot.tables).filter((t) => isSubjectTable(t.spec) && t.spec.logicalName !== edge.from).map((t) => t.spec.logicalName);
}

function edgeToken(edge: EdgeSpec): string {
  return edge.kind === "lookup" ? lookupValueKey(edge.field) : edge.field;
}

export function edgeAvailability(snapshot: Snapshot, edge: EdgeSpec): EdgeAvailability {
  const from = snapshot.tables[edge.from];
  if (!from || from.status !== "ok") return { available: false, reason: `${tableLabel(edge.from)} (${edge.from}) could not be read` };
  if (from.droppedColumns.includes(edgeToken(edge)) || from.droppedColumns.includes(edge.field)) {
    return { available: false, reason: `column “${edge.field}” on ${edge.from} isn't available in this environment` };
  }
  if (!edgeTargets(snapshot, edge).some((t) => okTable(snapshot, t))) return { available: false, reason: `no target table of “${edge.description}” could be read` };
  return { available: true };
}

export function buildGraph(snapshot: Snapshot): ReferenceGraph {
  const byId = new Map<string, RecordRow>();
  const byKey = new Map<string, RecordRow>();
  Object.values(snapshot.tables).forEach((table) => {
    if (table.status !== "ok") return;
    table.rows.forEach((row) => { byId.set(row.id, row); byKey.set(recordKey(row.table, row.id), row); });
  });

  const users = new Map<string, UsageRef[]>();
  const outbound = new Map<string, OutRef[]>();
  const neighbors = new Map<string, Set<string>>();
  const push = <T>(map: Map<string, T[]>, key: string, value: T) => map.set(key, [...(map.get(key) ?? []), value]);
  const link = (a: string, b: string) => {
    neighbors.set(a, (neighbors.get(a) ?? new Set<string>()).add(b));
    neighbors.set(b, (neighbors.get(b) ?? new Set<string>()).add(a));
  };
  const availabilityCache = new Map<string, EdgeAvailability>();
  const availability = (edge: EdgeSpec) => {
    if (!availabilityCache.has(edge.id)) availabilityCache.set(edge.id, edgeAvailability(snapshot, edge));
    return availabilityCache.get(edge.id)!;
  };

  snapshot.edges.forEach((edge) => {
    if (!availability(edge).available) return;
    const targets = new Set(edgeTargets(snapshot, edge));
    okTable(snapshot, edge.from)!.rows.forEach((row) => {
      const fromKey = recordKey(row.table, row.id);
      const ids = edge.kind === "lookup" ? [normalizeId(row.raw[lookupValueKey(edge.field)])].filter((id): id is string => !!id) : extractIds(row.raw[edge.field]).filter((id) => id !== row.id);
      ids.forEach((id) => {
        const target = byId.get(id);
        const targetMatches = target && targets.has(target.table);
        // Unresolved content ids are dropped: a GUID in rule XML can be anything (a user, a
        // value, a record in a table this tool doesn't read). Unresolved lookups are kept — that's
        // a broken reference.
        if (edge.kind === "content" && !targetMatches) return;
        push(outbound, fromKey, { edge, targetId: id, target: targetMatches ? target : undefined });
        if (!target || !targetMatches) return;
        const targetKey = recordKey(target.table, target.id);
        link(fromKey, targetKey);
        if (edge.semantics === "reference") push(users, targetKey, { edge, user: row });
        else push(users, fromKey, { edge, user: target });
      });
    });
  });

  // Alive = active, and — if the table belongs to parents — attached to at least one alive parent.
  // If any parent relationship of a table can't be evaluated, its rows are treated as alive
  // (conservative: an unknown can never be the reason something is reported).
  const aliveMemo = new Map<string, boolean>();
  const parentEdgesByTable = new Map<string, EdgeSpec[]>();
  snapshot.edges.filter((edge) => edge.semantics === "parent").forEach((edge) => parentEdgesByTable.set(edge.from, [...(parentEdgesByTable.get(edge.from) ?? []), edge]));
  const alive = (row: RecordRow): boolean => {
    const key = recordKey(row.table, row.id);
    const memo = aliveMemo.get(key);
    if (memo !== undefined) return memo;
    aliveMemo.set(key, false); // cycle guard: a record can't keep itself alive
    let result = row.active;
    const parentEdges = parentEdgesByTable.get(row.table) ?? [];
    if (result && parentEdges.length && parentEdges.every((edge) => availability(edge).available)) {
      const parents = (outbound.get(key) ?? []).filter((ref) => ref.edge.semantics === "parent" && ref.target);
      result = parents.some((ref) => alive(ref.target!));
    }
    aliveMemo.set(key, result);
    return result;
  };

  return { snapshot, byId, byKey, users, outbound, neighbors, edgeAvailability: availability, alive };
}

// Every edge through which a record of `table` can be kept in use (whether or not it was readable).
export function inboundEdges(snapshot: Snapshot, table: string): EdgeSpec[] {
  return snapshot.edges.filter((edge) => (edge.semantics === "reference" && edgeTargets(snapshot, edge).includes(table)) || (edge.semantics === "parent" && edge.from === table));
}

export interface StructuralCoverage {
  evaluated: boolean;
  reason?: string;
  availableEdges: EdgeSpec[];
  unavailable: { edge: EdgeSpec; reason: string }[];
  // Reasons a "nothing references this" result can't be High confidence for this table.
  gaps: string[];
}

export function structuralCoverage(snapshot: Snapshot, graph: ReferenceGraph, table: string): StructuralCoverage {
  const data = snapshot.tables[table];
  const edges = inboundEdges(snapshot, table);
  const availableEdges = edges.filter((edge) => graph.edgeAvailability(edge).available);
  const unavailable = edges.filter((edge) => !graph.edgeAvailability(edge).available).map((edge) => ({ edge, reason: graph.edgeAvailability(edge).reason ?? "unavailable" }));
  const gaps = unavailable.map((u) => `Couldn't check “${u.edge.description}”: ${u.reason}.`);
  (data?.spec.expectedReferencers ?? []).forEach((referencer) => {
    const ref = snapshot.tables[referencer];
    if (!ref || ref.status !== "ok") gaps.push(`${tableLabel(referencer)} (${referencer}) is expected to reference these records but couldn't be read${ref ? ` (${ref.status})` : ""}.`);
  });
  const undiscovered = Object.values(snapshot.tables).filter((t) => t.status === "ok" && isSubjectTable(t.spec) && t.discovery === "unavailable").map((t) => t.spec.logicalName);
  if (undiscovered.length) gaps.push(`Relationship metadata couldn't be read for ${undiscovered.join(", ")}, so lookups from those tables may be missing.`);

  if (!edges.length) return { evaluated: false, reason: "No relationship to this table is known (none configured, none discovered), so its records can't be judged unused.", availableEdges, unavailable, gaps };
  if (!availableEdges.length) return { evaluated: false, reason: "None of the relationships to this table could be read.", availableEdges, unavailable, gaps };
  return { evaluated: true, availableEdges, unavailable, gaps };
}

export function relatedRecords(graph: ReferenceGraph, row: RecordRow): RelatedRecord[] {
  const key = recordKey(row.table, row.id);
  const related: RelatedRecord[] = [];
  const seen = new Set<string>();
  const add = (target: RecordRow, relation: string) => {
    const id = `${target.table}:${target.id}:${relation}`;
    if (seen.has(id)) return;
    seen.add(id);
    related.push({ table: target.table, id: target.id, name: target.name, active: target.active, relation });
  };
  (graph.users.get(key) ?? []).forEach((ref) => add(ref.user, ref.edge.semantics === "parent" ? `Belongs to (${ref.edge.description})` : `Uses it (${ref.edge.description})`));
  (graph.outbound.get(key) ?? []).forEach((ref) => { if (ref.target && ref.edge.semantics === "reference") add(ref.target, `It points to (${ref.edge.description})`); });
  return related;
}

function describeUser(graph: ReferenceGraph, ref: UsageRef): string {
  const state = !ref.user.active ? "deactivated" : graph.alive(ref.user) ? "in use" : "belongs to nothing active";
  return `${tableLabel(ref.user.table)} “${ref.user.name}” — ${ref.edge.description} — ${state}`;
}

export const REVIEW_STEP = "Review it in the maker portal / admin center before removing it. Confirm nothing outside this scan (flows, apps, bots, scripts, other solutions) depends on it.";

function structuralFinding(graph: ReferenceGraph, row: RecordRow, checkId: CheckId, confidence: Confidence, confidenceReason: string, evidence: string[], explanation: string): Finding {
  const spec = graph.snapshot.tables[row.table].spec;
  const def = CHECKS[checkId];
  return {
    id: `${checkId}:${row.table}:${row.id}`,
    checkId,
    table: row.table,
    recordId: row.id,
    recordName: row.name,
    category: def.category,
    checkType: def.checkType,
    confidence,
    confidenceReason,
    title: def.title,
    explanation,
    evidence,
    nextStep: REVIEW_STEP,
    related: relatedRecords(graph, row),
    highValueNote: spec.highValueNote,
    marksDead: true
  };
}

// The generic structural check, for every table with check mode "generic". `deadKeys` are record
// keys that rules.ts has already concluded do nothing (e.g. an unreachable queue); records used
// only by those — or by other structural findings — are reported as usedOnlyByCandidates, to a
// fixed point, so a chain of leftovers (ruleset → overflow action → …) surfaces as a whole.
export function structuralFindings(snapshot: Snapshot, graph: ReferenceGraph, deadKeys: Set<string> = new Set()): Finding[] {
  const findings: Finding[] = [];
  const dead = new Set(deadKeys);
  const candidates: { row: RecordRow; coverage: StructuralCoverage }[] = [];

  Object.values(snapshot.tables).forEach((table) => {
    if (table.status !== "ok" || table.spec.check !== "generic") return;
    const coverage = structuralCoverage(snapshot, graph, table.spec.logicalName);
    if (!coverage.evaluated) return;
    const checked = `Checked ${coverage.availableEdges.length} relationship(s): ${[...new Set(coverage.availableEdges.map((e) => `${e.description} (${e.from}${e.kind === "content" ? ", by id in " + e.field : "." + e.field})`))].join("; ")}.`;

    table.rows.forEach((row) => {
      const key = recordKey(row.table, row.id);
      const refs = graph.users.get(key) ?? [];
      const aliveRefs = refs.filter((ref) => graph.alive(ref.user));
      if (!refs.length) {
        const high = !coverage.gaps.length;
        findings.push(structuralFinding(graph, row, "structural.orphan",
          high ? "high" : "medium",
          high ? "Every known relationship to this table was checked and none points to this record." : "No reference was found, but some relationships couldn't be checked (see evidence).",
          [checked, "Nothing found pointing to this record.", ...coverage.gaps],
          `No ${tableLabel(row.table).toLowerCase()} record, routing rule or other configuration read by this scan uses “${row.name}”.`));
        dead.add(key);
      } else if (!aliveRefs.length) {
        findings.push(structuralFinding(graph, row, "structural.onlyInactiveUsers", "medium",
          "It is referenced, but only by deactivated or detached records — they could be reactivated.",
          [checked, ...refs.map((ref) => describeUser(graph, ref)), ...coverage.gaps],
          `Only deactivated records, or records that no longer belong to anything active, point to “${row.name}”.`));
        dead.add(key);
      } else {
        candidates.push({ row, coverage });
      }
    });
  });

  // Fixed point: a record whose every in-use user is itself a candidate becomes one too.
  let changed = true;
  while (changed) {
    changed = false;
    candidates.forEach(({ row }) => {
      const key = recordKey(row.table, row.id);
      if (dead.has(key)) return;
      const aliveRefs = (graph.users.get(key) ?? []).filter((ref) => graph.alive(ref.user));
      if (!aliveRefs.every((ref) => dead.has(recordKey(ref.user.table, ref.user.id)))) return;
      findings.push(structuralFinding(graph, row, "structural.usedOnlyByCandidates", "medium",
        "Everything still using it is itself flagged by this scan; it only becomes unused if those are removed first.",
        aliveRefs.map((ref) => `${describeUser(graph, ref)}, but flagged by this scan`),
        `“${row.name}” is only used by records this scan also flags. Review those first — if they go, this goes with them.`));
      dead.add(key);
      changed = true;
    });
  }
  return findings;
}

// Lookups from tables marked reportBrokenRefs to records that don't exist or are deactivated.
// Only "reference" lookups: a missing or deactivated *parent* means the record is detached, which
// the structural check already reports — repeating it here would double-count it.
export function brokenReferenceFindings(snapshot: Snapshot, graph: ReferenceGraph): Finding[] {
  const findings: Finding[] = [];
  Object.values(snapshot.tables).forEach((table) => {
    if (table.status !== "ok" || !table.spec.reportBrokenRefs) return;
    const edges = snapshot.edges.filter((edge) => edge.from === table.spec.logicalName && edge.kind === "lookup" && edge.semantics === "reference" && graph.edgeAvailability(edge).available);
    table.rows.forEach((row) => {
      (graph.outbound.get(recordKey(row.table, row.id)) ?? []).forEach((ref) => {
        if (!edges.includes(ref.edge)) return;
        const targetTables = edgeTargets(snapshot, ref.edge).map((t) => snapshot.tables[t]);
        if (!ref.target) {
          // Only claim "missing" when every possible target table was read; a partial (filtered)
          // target table gets hedged wording.
          if (targetTables.some((t) => !t || t.status !== "ok")) return;
          const partial = targetTables.some((t) => t.partial);
          findings.push(brokenFinding(graph, row, "broken.missingTarget", "medium",
            "The id couldn't be found, but a record outside your read access looks the same as a deleted one.",
            [`${ref.edge.description} (${ref.edge.field}) = ${ref.targetId}`, partial ? `No such record among the ${targetTables.map((t) => tableLabel(t.spec.logicalName)).join("/")} records this scan reads (it only reads a filtered subset).` : `No ${targetTables.map((t) => tableLabel(t.spec.logicalName)).join("/")} record with that id was found.`],
            `“${row.name}” points to a ${ref.edge.description.toLowerCase()} that no longer exists (or that you can't read).`, ref.edge.id));
        } else if (!ref.target.active) {
          findings.push(brokenFinding(graph, row, "broken.inactiveTarget", "high",
            "The target record was read and its state is deactivated.",
            [`${ref.edge.description} (${ref.edge.field}) → ${tableLabel(ref.target.table)} “${ref.target.name}”, which is deactivated.`],
            `“${row.name}” points to “${ref.target.name}”, which is deactivated.`, ref.edge.id));
        }
      });
    });
  });
  return findings;
}

function brokenFinding(graph: ReferenceGraph, row: RecordRow, checkId: CheckId, confidence: Confidence, confidenceReason: string, evidence: string[], explanation: string, edgeId: string): Finding {
  const def = CHECKS[checkId];
  return {
    id: `${checkId}:${row.table}:${row.id}:${edgeId}`,
    checkId,
    table: row.table,
    recordId: row.id,
    recordName: row.name,
    category: def.category,
    checkType: def.checkType,
    confidence,
    confidenceReason,
    title: def.title,
    explanation,
    evidence,
    nextStep: "Review whether this record should point somewhere else, or is itself a leftover of the removed record. " + REVIEW_STEP,
    related: relatedRecords(graph, row),
    marksDead: false
  };
}
