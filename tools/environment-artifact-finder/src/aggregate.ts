import { TableCoverage } from "./analyze";
import { CONFIDENCE_ORDER, Category, CheckType, Confidence, Finding } from "./model";
import { tableLabel } from "./referenceMap";

export interface EntitySummary {
  table: string;
  label: string;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface Summary {
  total: number;
  byConfidence: Record<Confidence, number>;
  byCategory: Record<Category, number>;
  byEntity: EntitySummary[];
  // Distinct records with at least one High-confidence finding — the dashboard's "if you cleaned up
  // every High-confidence item, this many records would go" estimate. Broken-reference findings are
  // excluded: the usual fix there is to repoint the reference, not to remove the record.
  highConfidenceRecords: number;
  highValueCount: number;
  tablesScanned: number;
  tablesUnavailable: number;
  tablesNotEvaluated: number;
}

export function summarize(findings: Finding[], coverage: TableCoverage[]): Summary {
  const byConfidence: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  const byCategory: Record<Category, number> = { A: 0, B: 0 };
  const entities = new Map<string, EntitySummary>();
  findings.forEach((f) => {
    byConfidence[f.confidence] += 1;
    byCategory[f.category] += 1;
    const entry = entities.get(f.table) ?? { table: f.table, label: tableLabel(f.table), high: 0, medium: 0, low: 0, total: 0 };
    entry[f.confidence] += 1;
    entry.total += 1;
    entities.set(f.table, entry);
  });
  const highRecords = new Set(findings.filter((f) => f.confidence === "high" && f.checkType !== "broken").map((f) => `${f.table}:${f.recordId}`));
  const highValue = new Set(findings.filter((f) => f.highValueNote && f.marksDead).map((f) => `${f.table}:${f.recordId}`));
  return {
    total: findings.length,
    byConfidence,
    byCategory,
    byEntity: [...entities.values()].sort((a, b) => b.high - a.high || b.total - a.total || a.label.localeCompare(b.label)),
    highConfidenceRecords: highRecords.size,
    highValueCount: highValue.size,
    tablesScanned: coverage.filter((c) => c.status === "ok").length,
    tablesUnavailable: coverage.filter((c) => c.status !== "ok" && c.status !== "disabled").length,
    tablesNotEvaluated: coverage.filter((c) => c.structural && !c.structural.evaluated).length
  };
}

export interface FindingFilter {
  search: string;
  table: string | "all";
  confidence: Confidence | "all";
  checkType: CheckType | "all";
  category: Category | "all";
}

export const EMPTY_FILTER: FindingFilter = { search: "", table: "all", confidence: "all", checkType: "all", category: "all" };

export function filterFindings(findings: Finding[], filter: FindingFilter): Finding[] {
  const query = filter.search.trim().toLowerCase();
  return findings.filter((f) => (filter.table === "all" || f.table === filter.table)
    && (filter.confidence === "all" || f.confidence === filter.confidence)
    && (filter.checkType === "all" || f.checkType === filter.checkType)
    && (filter.category === "all" || f.category === filter.category)
    && (!query || f.recordName.toLowerCase().includes(query) || f.title.toLowerCase().includes(query) || tableLabel(f.table).toLowerCase().includes(query) || f.recordId.includes(query)));
}

export type SortKey = "entity" | "name" | "reason" | "confidence";

export function sortFindings(findings: Finding[], key: SortKey, ascending: boolean): Finding[] {
  const value = (f: Finding): string | number => {
    if (key === "entity") return tableLabel(f.table);
    if (key === "name") return f.recordName;
    if (key === "reason") return f.title;
    return CONFIDENCE_ORDER.indexOf(f.confidence);
  };
  return [...findings].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return (ascending ? cmp : -cmp) || a.recordName.localeCompare(b.recordName);
  });
}
