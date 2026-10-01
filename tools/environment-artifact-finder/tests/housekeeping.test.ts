import { housekeepingFindings, normalizeFetchXml } from "../src/housekeeping";
import { id, makeSnapshot } from "./fixtures";

const NOW = new Date("2026-09-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("bulk-delete jobs", () => {
  const job = (n: number, extra: Record<string, unknown>) => ({ bulkdeleteoperationid: id(n), name: `Job ${n}`, statecode: 3, statuscode: 30, isrecurring: false, modifiedon: daysAgo(400), ...extra });

  test("only finished, non-recurring jobs older than the threshold are reported, always Low / Category B", () => {
    const findings = housekeepingFindings(makeSnapshot({ bulkdeleteoperation: { rows: [
      job(1, {}),
      job(2, { statuscode: 31, modifiedon: daysAgo(200) }),
      job(3, { modifiedon: daysAgo(10) }),
      job(4, { statecode: 0, statuscode: 10 }),
      job(5, { isrecurring: true })
    ] } }), NOW);
    expect(findings.map((f) => f.recordId)).toEqual([id(1), id(2)]);
    expect(findings.every((f) => f.category === "B" && f.checkType === "housekeeping" && f.confidence === "low")).toBe(true);
    expect(findings[1].evidence).toContain("Status: Failed.");
  });
});

describe("saved views", () => {
  const DISABLED_USER = id(10);
  const ACTIVE_USER = id(11);
  const defaultFetch = `<fetch><entity name="queue"><attribute name="name" /><filter><condition attribute="statecode" operator="eq" value="0" /></filter></entity></fetch>`;
  const view = (n: number, extra: Record<string, unknown>) => ({ userqueryid: id(n), name: `View ${n}`, statecode: 0, returnedtypecode: "queue", _ownerid_value: ACTIVE_USER, fetchxml: "<fetch><entity name=\"queue\"><attribute name=\"queueid\" /></entity></fetch>", ...extra });
  const tables = (views: Record<string, unknown>[]) => ({
    userquery: { rows: views },
    systemuser: { rows: [{ systemuserid: DISABLED_USER, fullname: "Former Agent", name: "Former Agent", isdisabled: true }] },
    savedquery: { rows: [{ savedqueryid: id(20), name: "Active Queues", isdefault: true, querytype: 0, returnedtypecode: "queue", fetchxml: defaultFetch }] }
  });

  test("owner disabled, duplicate of the default view (ignoring whitespace), and deactivated are each reported", () => {
    const findings = housekeepingFindings(makeSnapshot(tables([
      view(1, { _ownerid_value: DISABLED_USER }),
      view(2, { fetchxml: defaultFetch.replace(/></g, ">\n    <").toUpperCase() }),
      view(3, { statecode: 1 }),
      view(4, {})
    ])), NOW);
    expect(findings.map((f) => `${f.checkId}@${f.recordId}`)).toEqual([
      `housekeeping.userQueryDisabledOwner@${id(1)}`,
      `housekeeping.userQueryDuplicatesDefault@${id(2)}`,
      `housekeeping.userQueryInactive@${id(3)}`
    ]);
    expect(findings[0].explanation).toContain("Former Agent");
  });

  test("views on tables outside the Contact Center scope are never reported", () => {
    const findings = housekeepingFindings(makeSnapshot(tables([view(5, { returnedtypecode: "account", _ownerid_value: DISABLED_USER, statecode: 1 })])), NOW);
    expect(findings).toEqual([]);
  });

  test("the disabled-owner check is skipped when users couldn't be read", () => {
    const snapshot = makeSnapshot({ ...tables([view(1, { _ownerid_value: DISABLED_USER })]), systemuser: { status: "noPermission" } });
    expect(housekeepingFindings(snapshot, NOW)).toEqual([]);
  });

  test("fetchxml normalization ignores whitespace and case only", () => {
    expect(normalizeFetchXml("<a>\n  <b x='1' />\n</a>")).toBe(normalizeFetchXml("<A><B X='1' /></A>"));
    expect(normalizeFetchXml("<a><b x='1'/></a>")).not.toBe(normalizeFetchXml("<a><b x='2'/></a>"));
  });
});
