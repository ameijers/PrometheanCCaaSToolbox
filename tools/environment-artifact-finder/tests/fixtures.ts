import { CURATED_EDGES, TABLES } from "../src/referenceMap";
import { EdgeSpec, RecordRow, Snapshot, TableData, TableSpec, TableStatus, isActive, normalizeId } from "../src/model";

// Builds a Snapshot directly from raw rows, bypassing any data source — for testing the engine and
// rules as the pure functions they are. Row ids are taken from `<table>id` (or the spec's primaryId)
// and names from `name`; statecode drives `active` exactly as in scan.ts.

export function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export interface TableInput {
  rows?: Record<string, unknown>[];
  status?: TableStatus;
  droppedColumns?: string[];
  partial?: boolean;
  discovery?: "ok" | "unavailable" | "notRun";
  spec?: Partial<TableSpec>;
}

function specFor(logicalName: string, overrides?: Partial<TableSpec>): TableSpec {
  const base = TABLES.find((t) => t.logicalName === logicalName) ?? { logicalName, label: logicalName, verification: "assumed" as const, enabled: true, check: "generic" as const, notes: "" };
  return { ...base, ...overrides };
}

export function makeSnapshot(tables: Record<string, TableInput>, edges: EdgeSpec[] = CURATED_EDGES): Snapshot {
  const out: Record<string, TableData> = {};
  Object.entries(tables).forEach(([logicalName, input]) => {
    const spec = specFor(logicalName, input.spec);
    const primaryId = spec.primaryId ?? `${logicalName}id`;
    const rows: RecordRow[] = (input.rows ?? []).map((raw) => {
      const rowId = normalizeId(raw[primaryId]) ?? normalizeId(raw.id);
      if (!rowId) throw new Error(`fixture row in ${logicalName} has no id`);
      return { table: logicalName, id: rowId, name: String(raw.name ?? raw[spec.primaryName ?? "name"] ?? rowId), active: isActive(raw), raw };
    });
    out[logicalName] = {
      spec,
      status: input.status ?? "ok",
      primaryId,
      primaryName: spec.primaryName,
      rows,
      droppedColumns: input.droppedColumns ?? [],
      partial: input.partial ?? false,
      discovery: input.discovery ?? "ok"
    };
  });
  return { mode: "demo", scannedAt: "2026-09-27T12:00:00Z", tables: out, edges, warnings: [] };
}

// Unified-routing decision XML in the shape Visual Routing Tester verified live.
export function queueRoutingXml(queueIds: string[], conditionVariable = "Language"): string {
  const rules = queueIds.map((queueId, index) => `<rule id="r${index}" name="Rule ${index}"><logical operator="AND"><condition operator="=="><lhs>liveworkitemcontext.${conditionVariable}</lhs><rhs>x</rhs></condition></logical><action><setattribute><lhs>assign_to.queue</lhs><rhs>{${queueId.toUpperCase()}}</rhs></setattribute></action></rule>`).join("");
  return `<decision hit-policy="first"><rules>${rules}</rules></decision>`;
}

export function overflowXml(overflowActionId: string): string {
  return `<decision hit-policy="first"><rules><rule id="o1" name="Long wait"><logical operator="AND"><condition operator="&gt;"><lhs>queue_prequeue.estimatedwaittimeinminutes</lhs><rhs>10</rhs></condition></logical><action><setattribute><lhs>overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs><rhs>${overflowActionId}</rhs></setattribute></action></rule></rules></decision>`;
}

export const EMPTY_DECISION_XML = `<decision hit-policy="first"><rules></rules></decision>`;

export function edge(partial: Partial<EdgeSpec> & Pick<EdgeSpec, "from" | "field" | "to">): EdgeSpec {
  return { id: `${partial.from}.${partial.field}`, kind: "lookup", semantics: "reference", verification: "discovered", description: `${partial.from}.${partial.field}`, ...partial };
}
