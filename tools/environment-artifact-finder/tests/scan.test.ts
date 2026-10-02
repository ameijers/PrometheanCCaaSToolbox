// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { DataSource, DescribeResult, ReadRequest, ReadResult, DataAccessError, TableMetadata } from "../src/dataSource";
import { TableSpec } from "../src/model";
import { discoverEdges, scanEnvironment } from "../src/scan";
import { id } from "./fixtures";

const spec = (logicalName: string, extra: Partial<TableSpec> = {}): TableSpec => ({ logicalName, label: logicalName, verification: "assumed", enabled: true, check: "generic", notes: "", ...extra });

describe("discoverEdges", () => {
  const specs = [
    spec("msdyn_liveworkstream", { check: "rule" }),
    spec("msdyn_ocvoice", { keptAliveBy: ["msdyn_liveworkstream"] }),
    spec("cts_servicenumber", { keptAliveBy: ["msdyn_ocvoice", "msdyn_liveworkstream"] }),
    spec("queue", { check: "rule" }),
    spec("queuemembership", { check: "supporting" }),
    spec("cts_disabled", { enabled: false })
  ];
  const metadata = new Map<string, TableMetadata | null>([
    ["cts_servicenumber", { primaryId: "cts_servicenumberid", lookups: [
      { attribute: "cts_ocvoiceid", target: "msdyn_ocvoice" },
      { attribute: "cts_contactcenterid", target: "cts_contactcenter" },
      { attribute: "ownerid", target: "systemuser" },
      { attribute: "cts_disabledid", target: "cts_disabled" }
    ] }],
    ["msdyn_liveworkstream", { primaryId: "msdyn_liveworkstreamid", lookups: [
      { attribute: "msdyn_defaultqueue", target: "queue" },
      { attribute: "cts_servicenumberid", target: "cts_servicenumber" },
      { attribute: "msdyn_target", target: "queue" },
      { attribute: "msdyn_target", target: "msdyn_ocvoice" }
    ] }],
    ["queuemembership", { primaryId: "queuemembershipid", lookups: [{ attribute: "queueid", target: "queue" }] }]
  ]);
  const curated = [{ id: "workstream.defaultqueue", kind: "lookup" as const, from: "msdyn_liveworkstream", field: "msdyn_defaultqueue", to: ["queue"], semantics: "reference" as const, verification: "verified" as const, description: "" }];
  const edges = discoverEdges(specs, metadata, curated);

  test("keptAliveBy targets become parent edges; others are references", () => {
    expect(edges.find((e) => e.field === "cts_ocvoiceid")).toMatchObject({ from: "cts_servicenumber", to: ["msdyn_ocvoice"], semantics: "parent", verification: "discovered" });
    expect(edges.find((e) => e.field === "cts_servicenumberid")).toMatchObject({ from: "msdyn_liveworkstream", semantics: "reference" });
  });

  test("system lookups, out-of-scope or disabled targets, supporting tables and curated duplicates are skipped", () => {
    const fields = edges.map((e) => `${e.from}.${e.field}`);
    expect(fields).not.toContain("cts_servicenumber.ownerid");
    expect(fields).not.toContain("cts_servicenumber.cts_contactcenterid");
    expect(fields).not.toContain("cts_servicenumber.cts_disabledid");
    expect(fields).not.toContain("queuemembership.queueid");
    expect(fields).not.toContain("msdyn_liveworkstream.msdyn_defaultqueue");
  });

  test("a polymorphic lookup becomes one edge with several targets", () => {
    expect(edges.filter((e) => e.field === "msdyn_target")).toEqual([expect.objectContaining({ to: ["queue", "msdyn_ocvoice"] })]);
  });
});

// A scriptable fake data source, to test the orchestration without Xrm.
function fakeSource(tables: Record<string, { describe?: DescribeResult; rows?: Record<string, unknown>[]; readError?: DataAccessError; dropped?: string[] }>) {
  const reads: ReadRequest[] = [];
  const source: DataSource = {
    mode: "live",
    describeTable: async (name) => tables[name]?.describe ?? { status: "notFound", message: `${name} not found` },
    readTable: async (request): Promise<ReadResult> => {
      reads.push(request);
      const table = tables[request.logicalName];
      if (table.readError) throw table.readError;
      return { rows: table.rows ?? [], droppedColumns: table.dropped ?? [], filterApplied: !!request.filter };
    }
  };
  return { source, reads };
}

describe("scanEnvironment", () => {
  const specs = [
    spec("msdyn_operatinghour", { primaryId: "msdyn_operatinghourid", primaryName: "msdyn_name" }),
    spec("queue", { check: "rule", select: ["msdyn_isomnichannelqueue"], filter: "msdyn_isomnichannelqueue eq true" }),
    spec("cts_openinghour"),
    spec("msdyn_ocvoice"),
    spec("cts_old", { enabled: false })
  ];
  const curated = [{ id: "queue.operatinghour", kind: "lookup" as const, from: "queue", field: "msdyn_operatinghourid", to: ["msdyn_operatinghour"], semantics: "reference" as const, verification: "verified" as const, description: "Queue operating hours" }];

  test("each table degrades on its own: not found, no permission and disabled don't stop the scan", async () => {
    const { source, reads } = fakeSource({
      msdyn_operatinghour: { describe: { status: "ok", metadata: { primaryId: "msdyn_operatinghourid", primaryName: "msdyn_name", lookups: [] } }, rows: [{ msdyn_operatinghourid: id(1).toUpperCase(), msdyn_name: "Standard", statecode: 0 }, { msdyn_name: "no id" }] },
      queue: { describe: { status: "ok", metadata: { primaryId: "queueid", primaryName: "name", lookups: [{ attribute: "cts_openinghourid", target: "cts_openinghour" }] } }, rows: [{ queueid: id(2), name: "Sales", statecode: 1 }] },
      cts_openinghour: { describe: { status: "ok", metadata: { primaryId: "cts_openinghourid", primaryName: "cts_name", lookups: [] } }, readError: new DataAccessError("noPermission", "No permission") }
    });
    const progress: string[] = [];
    const snapshot = await scanEnvironment(source, { tables: specs, curatedEdges: curated, onProgress: (p) => progress.push(p.message) });

    expect(snapshot.tables.msdyn_operatinghour).toMatchObject({ status: "ok", rows: [{ id: id(1), name: "Standard", active: true }] });
    expect(snapshot.tables.queue).toMatchObject({ status: "ok", partial: true, rows: [{ name: "Sales", active: false }] });
    expect(snapshot.tables.cts_openinghour).toMatchObject({ status: "noPermission" });
    expect(snapshot.tables.msdyn_ocvoice).toMatchObject({ status: "notFound", discovery: "notRun" });
    expect(snapshot.tables.cts_old).toMatchObject({ status: "disabled" });
    expect(reads.map((r) => r.logicalName).sort()).toEqual(["cts_openinghour", "msdyn_operatinghour", "queue"]);
    expect(progress[progress.length - 1]).toBe("Analyzing…");
  });

  test("selects primary columns, state, the spec's columns and every lookup/content column an edge needs", async () => {
    const { source, reads } = fakeSource({
      msdyn_operatinghour: { describe: { status: "ok", metadata: { primaryId: "msdyn_operatinghourid", primaryName: "msdyn_name", lookups: [] } } },
      queue: { describe: { status: "ok", metadata: { primaryId: "queueid", primaryName: "name", lookups: [{ attribute: "cts_openinghourid", target: "cts_openinghour" }] } } },
      cts_openinghour: { describe: { status: "ok", metadata: { primaryId: "cts_openinghourid", primaryName: "cts_name", lookups: [] } } }
    });
    const snapshot = await scanEnvironment(source, { tables: specs, curatedEdges: curated });
    const queueRead = reads.find((r) => r.logicalName === "queue")!;
    expect(queueRead.select).toEqual(["queueid", "name", "statecode", "msdyn_isomnichannelqueue", "_msdyn_operatinghourid_value", "_cts_openinghourid_value"]);
    expect(queueRead.filter).toBe("msdyn_isomnichannelqueue eq true");
    expect(snapshot.edges.map((e) => e.id)).toEqual(["queue.operatinghour", "discovered:queue.cts_openinghourid"]);
  });

  test("when metadata can't be read, the table is still read using the reference map's key names, and discovery is marked unavailable", async () => {
    const { source, reads } = fakeSource({ msdyn_operatinghour: { describe: { status: "ok", metadata: null }, rows: [] } });
    const snapshot = await scanEnvironment(source, { tables: [specs[0]], curatedEdges: [] });
    expect(reads[0].select).toEqual(["msdyn_operatinghourid", "msdyn_name", "statecode"]);
    expect(snapshot.tables.msdyn_operatinghour.discovery).toBe("unavailable");
    expect(snapshot.warnings[0]).toContain("Relationship metadata couldn't be read");
  });
});
