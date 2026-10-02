// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { SCAN_SETTINGS } from "./config";
import { DataAccessError, DataSource, DescribeResult, TableMetadata } from "./dataSource";
import { EdgeSpec, RecordRow, Snapshot, TableData, TableSpec, isActive, lookupValueKey, normalizeId } from "./model";
import { CURATED_EDGES, SYSTEM_LOOKUPS, TABLES, isSubjectTable, tableLabel } from "./referenceMap";

export interface ScanProgress {
  message: string;
  done: number;
  total: number;
}

export interface ScanOptions {
  tables?: TableSpec[];
  curatedEdges?: EdgeSpec[];
  onProgress?: (progress: ScanProgress) => void;
}

// Runs `worker` over `items` with at most `limit` in flight — the scan reads ~30 tables, and
// firing them all at once is an easy way to hit Dataverse's API limits.
async function mapLimited<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

// Turns live relationship metadata into edges: every lookup from one in-scope subject table to
// another becomes a relationship, classified by the source table's keptAliveBy (parent) or not
// (reference). Ownership/audit lookups and lookups already in the curated map are skipped.
export function discoverEdges(specs: TableSpec[], metadata: Map<string, TableMetadata | null>, curated: EdgeSpec[]): EdgeSpec[] {
  const subjects = new Set(specs.filter((s) => s.enabled && isSubjectTable(s)).map((s) => s.logicalName));
  const curatedKeys = new Set(curated.map((e) => `${e.from}.${e.field}`));
  const byKey = new Map<string, EdgeSpec>();
  specs.filter((s) => subjects.has(s.logicalName)).forEach((spec) => {
    (metadata.get(spec.logicalName)?.lookups ?? []).forEach((lookup) => {
      const key = `${spec.logicalName}.${lookup.attribute}`;
      if (SYSTEM_LOOKUPS.has(lookup.attribute) || !subjects.has(lookup.target) || curatedKeys.has(key)) return;
      const existing = byKey.get(key);
      if (existing) {
        // A polymorphic lookup (one column, several target tables) becomes one edge with several targets.
        if (!existing.to.includes(lookup.target)) existing.to.push(lookup.target);
        return;
      }
      const parent = (spec.keptAliveBy ?? []).includes(lookup.target);
      byKey.set(key, {
        id: `discovered:${key}`,
        kind: "lookup",
        from: spec.logicalName,
        field: lookup.attribute,
        to: [lookup.target],
        semantics: parent ? "parent" : "reference",
        verification: "discovered",
        description: parent ? `${tableLabel(spec.logicalName)} belongs to ${tableLabel(lookup.target).toLowerCase()} (${lookup.attribute})` : `${tableLabel(spec.logicalName)} → ${tableLabel(lookup.target).toLowerCase()} (${lookup.attribute})`
      });
    });
  });
  return [...byKey.values()];
}

function selectFor(spec: TableSpec, primaryId: string, primaryName: string | undefined, edges: EdgeSpec[]): { select: string[]; expand: { navigation: string; idField: string }[] } {
  const own = edges.filter((e) => e.from === spec.logicalName);
  const select = [
    primaryId,
    ...(primaryName ? [primaryName] : []),
    "statecode",
    ...(spec.select ?? []),
    ...own.filter((e) => e.kind === "lookup" && !e.expandIdField).map((e) => lookupValueKey(e.field)),
    ...own.filter((e) => e.kind === "content").map((e) => e.field)
  ];
  const expand = own.filter((e) => e.kind === "lookup" && e.expandIdField).map((e) => ({ navigation: e.field, idField: e.expandIdField! }));
  return { select: [...new Set(select)], expand };
}

export async function scanEnvironment(source: DataSource, options: ScanOptions = {}): Promise<Snapshot> {
  const specs = options.tables ?? TABLES;
  const curated = options.curatedEdges ?? CURATED_EDGES;
  const enabled = specs.filter((s) => s.enabled);
  const total = enabled.length * 2;
  let done = 0;
  const report = (message: string) => options.onProgress?.({ message, done, total });
  const warnings: string[] = [];

  // Phase 1 — which tables exist, their primary columns, and their lookups.
  const described = new Map<string, DescribeResult>();
  await mapLimited(enabled, SCAN_SETTINGS.readConcurrency, async (spec) => {
    report(`Reading table definitions (${spec.logicalName})…`);
    let result: DescribeResult;
    try { result = await source.describeTable(spec.logicalName); } catch (error) { result = { status: "error", message: error instanceof Error ? error.message : String(error) }; }
    described.set(spec.logicalName, result);
    done += 1;
  });
  const metadata = new Map<string, TableMetadata | null>();
  described.forEach((result, name) => { if (result.status === "ok") metadata.set(name, result.metadata); });
  if ([...metadata.values()].some((m) => m === null)) warnings.push("Relationship metadata couldn't be read, so relationships for tables without verified schema weren't discovered. Findings that depend on them are lower confidence.");

  // Phase 2 — the reference graph's edges: curated ones whose tables are enabled, plus discovered ones.
  const enabledNames = new Set(enabled.map((s) => s.logicalName));
  const curatedInScope = curated.filter((e) => enabledNames.has(e.from) && (e.to.includes("*") || e.to.some((t) => enabledNames.has(t))))
    .map((e) => ({ ...e, to: e.to.includes("*") ? e.to : e.to.filter((t) => enabledNames.has(t)) }));
  const edges = [...curatedInScope, ...discoverEdges(specs, metadata, curatedInScope)];

  // Phase 3 — read every table that exists.
  const tables: Record<string, TableData> = {};
  specs.filter((s) => !s.enabled).forEach((spec) => {
    tables[spec.logicalName] = { spec, status: "disabled", primaryId: spec.primaryId ?? `${spec.logicalName}id`, rows: [], droppedColumns: [], partial: false, discovery: "notRun" };
  });
  await mapLimited(enabled, SCAN_SETTINGS.readConcurrency, async (spec) => {
    const describedResult = described.get(spec.logicalName)!;
    const meta = describedResult.status === "ok" ? describedResult.metadata : null;
    const primaryId = meta?.primaryId ?? spec.primaryId ?? `${spec.logicalName}id`;
    const primaryName = meta ? meta.primaryName : spec.primaryName;
    const base = { spec, primaryId, primaryName, rows: [] as RecordRow[], droppedColumns: [] as string[], partial: false, discovery: (meta ? "ok" : "unavailable") as TableData["discovery"] };
    if (describedResult.status !== "ok") {
      tables[spec.logicalName] = { ...base, status: describedResult.status, message: describedResult.message, discovery: "notRun" };
      done += 1;
      return;
    }
    report(`Reading ${tableLabel(spec.logicalName).toLowerCase()} records (${spec.logicalName})…`);
    try {
      const { select, expand } = selectFor(spec, primaryId, primaryName, edges);
      const result = await source.readTable({ logicalName: spec.logicalName, select, expand, filter: spec.filter });
      const rows = result.rows.flatMap((raw): RecordRow[] => {
        const id = normalizeId(raw[primaryId]);
        if (!id) return [];
        const name = (primaryName && typeof raw[primaryName] === "string" && raw[primaryName]) || (typeof raw.name === "string" && raw.name) || id;
        return [{ table: spec.logicalName, id, name: String(name), active: isActive(raw), raw }];
      });
      tables[spec.logicalName] = { ...base, status: "ok", rows, droppedColumns: result.droppedColumns, partial: !!spec.filter && result.filterApplied };
    } catch (error) {
      const kind = error instanceof DataAccessError ? error.kind : "error";
      tables[spec.logicalName] = { ...base, status: kind, message: error instanceof Error ? error.message : String(error) };
    }
    done += 1;
  });
  report("Analyzing…");

  return { mode: source.mode, scannedAt: new Date().toISOString(), tables, edges, warnings };
}
