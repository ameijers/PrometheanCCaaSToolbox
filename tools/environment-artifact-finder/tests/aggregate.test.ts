import { EMPTY_FILTER, filterFindings, sortFindings, summarize } from "../src/aggregate";
import { TableCoverage } from "../src/analyze";
import { CHECKS, CheckId, Finding } from "../src/model";

function finding(checkId: CheckId, table: string, recordId: string, confidence: Finding["confidence"], extra: Partial<Finding> = {}): Finding {
  const def = CHECKS[checkId];
  return { id: `${checkId}:${recordId}`, checkId, table, recordId, recordName: `Record ${recordId}`, category: def.category, checkType: def.checkType, confidence, confidenceReason: "", title: def.title, explanation: "", evidence: [], nextStep: "", related: [], marksDead: true, ...extra };
}

const coverage = (status: TableCoverage["status"], evaluated?: boolean): TableCoverage => ({ table: "t", label: "t", verification: "verified", check: "generic", status, rowCount: 0, structural: evaluated === undefined ? undefined : { evaluated, gaps: [] }, inbound: [], droppedColumns: [], discovery: "ok", notes: "" });

describe("category and check-type assignment", () => {
  test("every check in the registry belongs to exactly the category its check type implies", () => {
    Object.entries(CHECKS).forEach(([checkId, def]) => {
      expect(def.category).toBe(def.checkType === "housekeeping" ? "B" : "A");
      expect(checkId.startsWith("housekeeping.")).toBe(def.checkType === "housekeeping");
    });
  });
});

describe("summarize", () => {
  const findings = [
    finding("structural.orphan", "msdyn_operatinghour", "1", "high"),
    finding("queue.noMembersNoRoutes", "queue", "2", "high"),
    finding("broken.inactiveTarget", "msdyn_routingconfigurationstep", "3", "high", { marksDead: false }),
    finding("structural.orphan", "cts_servicenumber", "4", "high", { highValueNote: "billed" }),
    finding("record.inactive", "cts_servicenumber", "4", "medium", { highValueNote: "billed" }),
    finding("housekeeping.bulkDeleteOld", "bulkdeleteoperation", "5", "low", { marksDead: false })
  ];

  test("counts by confidence, category and entity", () => {
    const summary = summarize(findings, [coverage("ok", true), coverage("notFound"), coverage("disabled"), coverage("ok", false)]);
    expect(summary.byConfidence).toEqual({ high: 4, medium: 1, low: 1 });
    expect(summary.byCategory).toEqual({ A: 5, B: 1 });
    expect(summary.byEntity.find((e) => e.table === "cts_servicenumber")).toMatchObject({ high: 1, medium: 1, total: 2 });
    expect(summary).toMatchObject({ tablesScanned: 2, tablesUnavailable: 1, tablesNotEvaluated: 1 });
  });

  test("the High-confidence cleanup estimate counts distinct records and leaves out broken references", () => {
    expect(summarize(findings, []).highConfidenceRecords).toBe(3);
  });

  test("high-value records (e.g. billed numbers) are counted once", () => {
    expect(summarize(findings, []).highValueCount).toBe(1);
  });
});

describe("filter and sort", () => {
  const findings = [
    finding("structural.orphan", "msdyn_operatinghour", "b", "medium", { recordName: "Holiday hours" }),
    finding("queue.unreachable", "queue", "a", "high", { recordName: "Returns" }),
    finding("housekeeping.userQueryInactive", "userquery", "c", "low", { recordName: "My view" })
  ];

  test("filters combine", () => {
    expect(filterFindings(findings, { ...EMPTY_FILTER, category: "A", confidence: "medium" }).map((f) => f.recordName)).toEqual(["Holiday hours"]);
    expect(filterFindings(findings, { ...EMPTY_FILTER, search: "returns" }).map((f) => f.recordName)).toEqual(["Returns"]);
    expect(filterFindings(findings, { ...EMPTY_FILTER, checkType: "housekeeping" })).toHaveLength(1);
    expect(filterFindings(findings, { ...EMPTY_FILTER, table: "queue" })).toHaveLength(1);
  });

  test("sorts by confidence severity, then name", () => {
    expect(sortFindings(findings, "confidence", true).map((f) => f.confidence)).toEqual(["high", "medium", "low"]);
    expect(sortFindings(findings, "name", false).map((f) => f.recordName)).toEqual(["Returns", "My view", "Holiday hours"]);
  });
});
