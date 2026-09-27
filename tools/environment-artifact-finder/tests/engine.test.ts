import { brokenReferenceFindings, buildGraph, structuralCoverage, structuralFindings } from "../src/engine";
import { CURATED_EDGES } from "../src/referenceMap";
import { recordKey } from "../src/model";
import { edge, id, makeSnapshot } from "./fixtures";

const OH_USED = id(1);
const OH_UNUSED = id(2);
const QUEUE = id(10);

function findingsFor(snapshotTables: Parameters<typeof makeSnapshot>[0], edges = CURATED_EDGES, dead?: Set<string>) {
  const snapshot = makeSnapshot(snapshotTables, edges);
  const graph = buildGraph(snapshot);
  return { snapshot, graph, findings: structuralFindings(snapshot, graph, dead) };
}

// Every table with a known relationship to operating hours must be readable for a High-confidence
// orphan — including rulesets, whose XML could mention any record by id.
const baseReferencers = {
  msdyn_liveworkstream: { rows: [] },
  msdyn_decisionruleset: { rows: [] },
  queue: { rows: [{ queueid: QUEUE, name: "Sales", statecode: 0, _msdyn_operatinghourid_value: OH_USED }] }
};

describe("structural orphan detection (lookup edges)", () => {
  test("a record referenced by an active record is not flagged; an unreferenced one is a High-confidence orphan", () => {
    const { findings } = findingsFor({
      ...baseReferencers,
      msdyn_operatinghour: { rows: [{ msdyn_operatinghourid: OH_USED, name: "Standard" }, { msdyn_operatinghourid: OH_UNUSED, name: "Holiday 2019" }] }
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ checkId: "structural.orphan", recordId: OH_UNUSED, confidence: "high", category: "A", checkType: "structural" });
    expect(findings[0].evidence.join(" ")).toContain("Queue operating hours");
  });

  test("referenced only by a deactivated record → onlyInactiveUsers, Medium", () => {
    const { findings } = findingsFor({
      msdyn_liveworkstream: { rows: [] },
      queue: { rows: [{ queueid: QUEUE, name: "Old", statecode: 1, _msdyn_operatinghourid_value: OH_USED }] },
      msdyn_operatinghour: { rows: [{ msdyn_operatinghourid: OH_USED, name: "Standard" }] }
    });
    expect(findings).toEqual([expect.objectContaining({ checkId: "structural.onlyInactiveUsers", confidence: "medium" })]);
    expect(findings[0].evidence.some((e) => e.includes("deactivated"))).toBe(true);
  });

  test("a relationship whose column isn't available lowers an orphan to Medium and says why", () => {
    const { findings } = findingsFor({
      msdyn_liveworkstream: { rows: [] },
      queue: { rows: [{ queueid: QUEUE, name: "Sales" }], droppedColumns: ["_msdyn_operatinghourid_value"] },
      msdyn_operatinghour: { rows: [{ msdyn_operatinghourid: OH_UNUSED, name: "Holiday" }] }
    }, [...CURATED_EDGES, edge({ from: "msdyn_liveworkstream", field: "msdyn_operatinghourid", to: ["msdyn_operatinghour"] })]);
    expect(findings).toEqual([expect.objectContaining({ checkId: "structural.orphan", confidence: "medium" })]);
    expect(findings[0].evidence.join(" ")).toMatch(/Couldn't check “Queue operating hours”/);
  });

  test("an expected referencer table that couldn't be read lowers an orphan to Medium", () => {
    const { findings } = findingsFor({
      queue: { rows: [] },
      msdyn_liveworkstream: { status: "noPermission" },
      msdyn_operatinghour: { rows: [{ msdyn_operatinghourid: OH_UNUSED, name: "Holiday" }] }
    });
    expect(findings[0].confidence).toBe("medium");
    expect(findings[0].evidence.join(" ")).toContain("expected to reference these records but couldn't be read (noPermission)");
  });

  test("a table with no known relationships is not evaluated at all (never flags every record)", () => {
    const { snapshot, graph, findings } = findingsFor({ cts_openinghour: { rows: [{ cts_openinghourid: id(3), name: "Main" }] } });
    expect(findings).toEqual([]);
    expect(structuralCoverage(snapshot, graph, "cts_openinghour")).toMatchObject({ evaluated: false });
  });

  test("a table whose every relationship is unreadable is not evaluated", () => {
    const { findings } = findingsFor({
      queue: { status: "notFound" },
      msdyn_operatinghour: { rows: [{ msdyn_operatinghourid: OH_UNUSED, name: "Holiday" }] }
    });
    expect(findings).toEqual([]);
  });
});

describe("junction and parent (keptAliveBy) edges", () => {
  const WS_ACTIVE = id(20);
  const WS_INACTIVE = id(21);
  const CP_A = id(30);
  const CP_B = id(31);
  const CP_C = id(32);
  const junctionEdges = [
    ...CURATED_EDGES,
    edge({ from: "msdyn_liveworkstreamcapacityprofile", field: "msdyn_liveworkstreamid", to: ["msdyn_liveworkstream"], semantics: "parent" }),
    edge({ from: "msdyn_liveworkstreamcapacityprofile", field: "msdyn_capacityprofileid", to: ["msdyn_capacityprofile"] })
  ];
  const tables = {
    msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: WS_ACTIVE, name: "Chat", statecode: 0 }, { msdyn_liveworkstreamid: WS_INACTIVE, name: "Legacy", statecode: 1 }] },
    msdyn_bookableresourcecapacityprofile: { rows: [] },
    msdyn_capacityprofile: { rows: [{ msdyn_capacityprofileid: CP_A, name: "Chat profile" }, { msdyn_capacityprofileid: CP_B, name: "Legacy profile" }, { msdyn_capacityprofileid: CP_C, name: "Unused" }] },
    msdyn_liveworkstreamcapacityprofile: {
      rows: [
        { msdyn_liveworkstreamcapacityprofileid: id(40), name: "Chat link", _msdyn_liveworkstreamid_value: WS_ACTIVE, _msdyn_capacityprofileid_value: CP_A },
        { msdyn_liveworkstreamcapacityprofileid: id(41), name: "Legacy link", _msdyn_liveworkstreamid_value: WS_INACTIVE, _msdyn_capacityprofileid_value: CP_B }
      ]
    }
  };

  test("a target linked through a junction row counts as used only when the junction's owner is alive", () => {
    const { findings } = findingsFor(tables, junctionEdges);
    const byRecord = new Map(findings.map((f) => [f.recordId, f.checkId]));
    expect(byRecord.has(CP_A)).toBe(false);
    expect(byRecord.get(CP_B)).toBe("structural.onlyInactiveUsers");
    expect(byRecord.get(CP_C)).toBe("structural.orphan");
  });

  test("a junction row whose owner is deactivated is itself reported (dangling junction)", () => {
    const { findings } = findingsFor(tables, junctionEdges);
    expect(findings.find((f) => f.recordId === id(41))?.checkId).toBe("structural.onlyInactiveUsers");
    expect(findings.find((f) => f.recordId === id(40))).toBeUndefined();
  });

  test("a child whose parent lookup is empty belongs to nothing → orphan", () => {
    const { findings } = findingsFor({
      msdyn_liveworkstream: { rows: [] },
      msdyn_routingconfiguration: { rows: [{ msdyn_routingconfigurationid: id(50), name: "Detached" }] }
    });
    expect(findings).toEqual([expect.objectContaining({ recordId: id(50), checkId: "structural.orphan" })]);
  });

  test("alive-ness follows the whole parent chain (step → config → workstream)", () => {
    const snapshot = makeSnapshot({
      msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: WS_INACTIVE, name: "Legacy", statecode: 1 }] },
      msdyn_routingconfiguration: { rows: [{ msdyn_routingconfigurationid: id(50), name: "Config", _msdyn_liveworkstreamid_value: WS_INACTIVE }] },
      msdyn_routingconfigurationstep: { rows: [{ msdyn_routingconfigurationstepid: id(51), name: "Step", _msdyn_routingconfigurationid_value: id(50) }] }
    });
    const graph = buildGraph(snapshot);
    expect(graph.alive(graph.byKey.get(recordKey("msdyn_routingconfigurationstep", id(51)))!)).toBe(false);
  });

  test("a parent relationship that can't be evaluated keeps the child alive (conservative)", () => {
    const snapshot = makeSnapshot({
      msdyn_liveworkstream: { rows: [] },
      msdyn_routingconfiguration: { rows: [{ msdyn_routingconfigurationid: id(50), name: "Config" }], droppedColumns: ["_msdyn_liveworkstreamid_value"] }
    });
    const graph = buildGraph(snapshot);
    expect(graph.alive(graph.byKey.get(recordKey("msdyn_routingconfiguration", id(50)))!)).toBe(true);
  });
});

describe("content (id-mention) edges", () => {
  test("a skill mentioned by id in a ruleset's XML counts as used; the ruleset's own id doesn't count as a self-reference", () => {
    const RS = id(60);
    const { findings } = findingsFor({
      bookableresourcecharacteristic: { rows: [] },
      msdyn_decisionruleset: { rows: [{ msdyn_decisionrulesetid: RS, name: "Skills", msdyn_rulesetdefinition: `<decision id="${RS}"><rhs>{${id(70).toUpperCase()}}</rhs></decision>` }] },
      characteristic: { rows: [{ characteristicid: id(70), name: "Spanish" }, { characteristicid: id(71), name: "Mandarin" }] }
    });
    expect(findings.filter((f) => f.table === "characteristic").map((f) => f.recordId)).toEqual([id(71)]);
  });
});

describe("transitive propagation", () => {
  const RS_ORPHAN = id(80);
  const OA = id(81);
  const tables = {
    queue: { rows: [] },
    msdyn_routingconfigurationstep: { rows: [] },
    msdyn_decisionruleset: { rows: [{ msdyn_decisionrulesetid: RS_ORPHAN, name: "Old overflow", msdyn_rulesetdefinition: `<rhs>${OA}</rhs>` }] },
    msdyn_overflowactionconfig: { rows: [{ msdyn_overflowactionconfigid: OA, name: "Voicemail" }] }
  };

  test("a record used only by an orphan is reported as usedOnlyByCandidates", () => {
    const { findings } = findingsFor(tables);
    expect(findings.find((f) => f.recordId === RS_ORPHAN)?.checkId).toBe("structural.orphan");
    expect(findings.find((f) => f.recordId === OA)).toMatchObject({ checkId: "structural.usedOnlyByCandidates", confidence: "medium" });
  });

  test("records rules.ts marked dead (e.g. an unreachable queue) propagate too", () => {
    const Q = id(90);
    const { findings } = findingsFor({
      queue: { rows: [{ queueid: Q, name: "Unreachable", _msdyn_operatinghourid_value: OH_USED }] },
      msdyn_liveworkstream: { rows: [] },
      msdyn_operatinghour: { rows: [{ msdyn_operatinghourid: OH_USED, name: "Legacy hours" }] }
    }, CURATED_EDGES, new Set([recordKey("queue", Q)]));
    expect(findings).toEqual([expect.objectContaining({ recordId: OH_USED, checkId: "structural.usedOnlyByCandidates" })]);
  });
});

describe("broken references", () => {
  const CP = id(100);
  const tables = (junctionRows: Record<string, unknown>[], cpStatus: "ok" | "notFound" = "ok") => ({
    msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: id(101), name: "Sales", statecode: 0 }] },
    msdyn_capacityprofile: { status: cpStatus, rows: [{ msdyn_capacityprofileid: CP, name: "Old profile", statecode: 1 }] },
    msdyn_liveworkstreamcapacityprofile: { rows: junctionRows }
  });
  const edges = [
    edge({ from: "msdyn_liveworkstreamcapacityprofile", field: "msdyn_liveworkstreamid", to: ["msdyn_liveworkstream"], semantics: "parent" }),
    edge({ from: "msdyn_liveworkstreamcapacityprofile", field: "msdyn_capacityprofileid", to: ["msdyn_capacityprofile"] })
  ];

  function broken(t: ReturnType<typeof tables>) {
    const snapshot = makeSnapshot(t, edges);
    return brokenReferenceFindings(snapshot, buildGraph(snapshot));
  }

  test("a lookup to a deactivated record is broken (High); to a missing record is broken (Medium)", () => {
    const findings = broken(tables([
      { msdyn_liveworkstreamcapacityprofileid: id(110), name: "To inactive", _msdyn_liveworkstreamid_value: id(101), _msdyn_capacityprofileid_value: CP },
      { msdyn_liveworkstreamcapacityprofileid: id(111), name: "To deleted", _msdyn_liveworkstreamid_value: id(101), _msdyn_capacityprofileid_value: id(999) }
    ]));
    expect(findings.map((f) => [f.recordId, f.checkId, f.confidence])).toEqual([
      [id(110), "broken.inactiveTarget", "high"],
      [id(111), "broken.missingTarget", "medium"]
    ]);
    expect(findings.every((f) => f.checkType === "broken" && !f.marksDead)).toBe(true);
  });

  test("no 'missing' claim when the target table itself couldn't be read", () => {
    const findings = broken(tables([{ msdyn_liveworkstreamcapacityprofileid: id(111), name: "x", _msdyn_liveworkstreamid_value: id(101), _msdyn_capacityprofileid_value: id(999) }], "notFound"));
    expect(findings).toEqual([]);
  });
});
