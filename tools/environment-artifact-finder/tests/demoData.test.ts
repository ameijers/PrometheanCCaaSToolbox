import { analyze } from "../src/analyze";
import { DEMO_IDS, demoSource } from "../src/demoData";
import { CHECKS, CheckId } from "../src/model";
import { scanEnvironment } from "../src/scan";

// The demo runs the real scan + analysis over the sample data source, so these tests double as an
// end-to-end check of the whole pipeline.
async function demo() {
  return analyze(await scanEnvironment(demoSource));
}

describe("demo dataset", () => {
  test("exercises every check at least once", async () => {
    const { findings } = await demo();
    const seen = new Set(findings.map((f) => f.checkId));
    const missing = (Object.keys(CHECKS) as CheckId[]).filter((id) => !seen.has(id));
    expect(missing).toEqual([]);
  });

  test("clean records produce no findings, and non-Omnichannel queues are ignored", async () => {
    const { findings } = await demo();
    const flagged = new Set(findings.map((f) => f.recordId));
    expect(DEMO_IDS.cleanRecords.filter((id) => flagged.has(id))).toEqual([]);
    expect(flagged.has(DEMO_IDS.personalQueue)).toBe(false);
  });

  test("both worked examples from the brief are present", async () => {
    const { findings } = await demo();
    expect(findings.find((f) => f.recordId === DEMO_IDS.unusedQueue)).toMatchObject({ checkId: "queue.noMembersNoRoutes", confidence: "high" });
    expect(findings.find((f) => f.recordId === DEMO_IDS.billingWorkstream)?.checkId).toBe("workstream.voiceNoNumber");
  });

  test("the spare service number is a High-confidence orphan carrying the billed-number note", async () => {
    const { findings } = await demo();
    const spare = findings.find((f) => f.recordId === DEMO_IDS.spareNumber);
    expect(spare).toMatchObject({ checkId: "structural.orphan", confidence: "high" });
    expect(spare?.highValueNote).toMatch(/billed/);
  });

  test("shows every level of degradation on the Coverage tab", async () => {
    const { coverage } = await demo();
    const status = (table: string) => coverage.find((c) => c.table === table)?.status;
    expect(status("msdyn_templateruleset")).toBe("notFound");
    expect(status("msdyn_oclocalizationdata")).toBe("noPermission");
    expect(status("msdyn_ocphonenumber")).toBe("disabled");
    expect(coverage.find((c) => c.table === "cts_servicenumber")?.inbound.some((e) => e.verification === "discovered")).toBe(true);
  });

  test("findings use the three confidence levels and both categories", async () => {
    const { findings } = await demo();
    expect(new Set(findings.map((f) => f.confidence))).toEqual(new Set(["high", "medium", "low"]));
    expect(new Set(findings.map((f) => f.category))).toEqual(new Set(["A", "B"]));
  });
});
