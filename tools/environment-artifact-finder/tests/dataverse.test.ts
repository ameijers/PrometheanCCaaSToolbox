// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { DataAccessError } from "../src/dataSource";
import { classifyError, dataverseSource, recordUrl } from "../src/dataverse";

// Mock of the subset of Xrm.WebApi this tool calls, dispatched by table logical name. Anything
// without a handler fails like a table that doesn't exist.
type Handler = (query: string) => { entities: Record<string, unknown>[]; nextLink?: string };

function installXrm(handlers: Record<string, Handler>, clientUrl?: string) {
  const calls: { table: string; query: string }[] = [];
  (global as any).Xrm = {
    Utility: { getGlobalContext: () => ({ getClientUrl: () => clientUrl }) },
    WebApi: {
      retrieveMultipleRecords: async (table: string, query: string) => {
        calls.push({ table, query });
        const handler = handlers[table];
        if (!handler) throw new Error(`Resource not found for the segment '${table}'.`);
        return handler(query);
      }
    }
  };
  return calls;
}

function installFetch(respond: (url: string, init: any) => { status: number; body?: unknown }) {
  const calls: { url: string; init: any }[] = [];
  (global as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    const { status, body } = respond(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return calls;
}

afterEach(() => {
  delete (global as any).Xrm;
  delete (global as any).fetch;
});

describe("describeTable (relationship metadata)", () => {
  test("reads primary columns and lookups with a GET to the metadata endpoint", async () => {
    installXrm({}, "https://org.crm.dynamics.com");
    const calls = installFetch(() => ({
      status: 200,
      body: {
        PrimaryIdAttribute: "cts_servicenumberid",
        PrimaryNameAttribute: "cts_name",
        ManyToOneRelationships: [{ ReferencingAttribute: "cts_OcVoiceId", ReferencedEntity: "msdyn_ocvoice" }, { ReferencingAttribute: "ownerid", ReferencedEntity: "systemuser" }]
      }
    }));
    const result = await dataverseSource.describeTable("cts_servicenumber");
    expect(result).toEqual({ status: "ok", metadata: { primaryId: "cts_servicenumberid", primaryName: "cts_name", lookups: [{ attribute: "cts_ocvoiceid", target: "msdyn_ocvoice" }, { attribute: "ownerid", target: "systemuser" }] } });
    expect(calls[0].url).toContain("/api/data/v9.2/EntityDefinitions(LogicalName='cts_servicenumber')");
    expect(calls[0].url).toContain("ManyToOneRelationships");
    expect(calls[0].init.method).toBe("GET");
  });

  test("404 → notFound, 403 → noPermission", async () => {
    installXrm({}, "https://org");
    installFetch((url) => ({ status: url.includes("cts_contactcenter") ? 404 : 403 }));
    expect((await dataverseSource.describeTable("cts_contactcenter")).status).toBe("notFound");
    expect((await dataverseSource.describeTable("msdyn_ocvoice")).status).toBe("noPermission");
  });

  test("no client URL → metadata unknown (the scan falls back and still reads the table)", async () => {
    installXrm({});
    expect(await dataverseSource.describeTable("queue")).toEqual({ status: "ok", metadata: null });
  });
});

describe("readTable", () => {
  test("follows @odata.nextLink across pages", async () => {
    const calls = installXrm({
      queue: (query) => query.includes("page=2")
        ? { entities: [{ queueid: "b" }] }
        : { entities: [{ queueid: "a" }], nextLink: "https://org/api/data/v9.2/queues?$select=queueid&page=2" }
    });
    const result = await dataverseSource.readTable({ logicalName: "queue", select: ["queueid"], expand: [] });
    expect(result.rows.map((r) => r.queueid)).toEqual(["a", "b"]);
    expect(calls[1].query).toBe("?$select=queueid&page=2");
  });

  test("a column this environment doesn't have is dropped and reported, not fatal", async () => {
    installXrm({
      queue: (query) => {
        if (query.includes("msdyn_isomnichannelqueue")) throw new Error("Could not find a property named 'msdyn_isomnichannelqueue' on type 'Microsoft.Dynamics.CRM.queue'.");
        return { entities: [{ queueid: "a" }] };
      }
    });
    const result = await dataverseSource.readTable({ logicalName: "queue", select: ["queueid", "msdyn_isomnichannelqueue"], expand: [] });
    expect(result.droppedColumns).toEqual(["msdyn_isomnichannelqueue"]);
    expect(result.rows).toHaveLength(1);
  });

  test("a missing lookup reported by its attribute name drops its _value alias", async () => {
    installXrm({
      cts_servicenumber: (query) => {
        if (query.includes("_cts_ocvoiceid_value")) throw new Error("Could not find a property named 'cts_ocvoiceid'.");
        return { entities: [] };
      }
    });
    const result = await dataverseSource.readTable({ logicalName: "cts_servicenumber", select: ["cts_servicenumberid", "_cts_ocvoiceid_value"], expand: [] });
    expect(result.droppedColumns).toEqual(["_cts_ocvoiceid_value"]);
  });

  test("an $expand-only lookup is flattened into its _value alias", async () => {
    const calls = installXrm({ msdyn_liveworkstream: () => ({ entities: [{ msdyn_liveworkstreamid: "w", msdyn_defaultqueue: { queueid: "q" } }, { msdyn_liveworkstreamid: "x", msdyn_defaultqueue: null }] }) });
    const result = await dataverseSource.readTable({ logicalName: "msdyn_liveworkstream", select: ["msdyn_liveworkstreamid"], expand: [{ navigation: "msdyn_defaultqueue", idField: "queueid" }] });
    expect(calls[0].query).toBe("?$select=msdyn_liveworkstreamid&$expand=msdyn_defaultqueue($select=queueid)");
    expect(result.rows).toEqual([{ msdyn_liveworkstreamid: "w", _msdyn_defaultqueue_value: "q" }, { msdyn_liveworkstreamid: "x", _msdyn_defaultqueue_value: null }]);
  });

  test("a rejected filter is retried without it, and reported as not applied", async () => {
    installXrm({
      userquery: (query) => {
        if (query.includes("$filter")) throw new Error("The query parameter $filter is not supported for this attribute.");
        return { entities: [{ userqueryid: "v" }] };
      }
    });
    const result = await dataverseSource.readTable({ logicalName: "userquery", select: ["userqueryid"], expand: [], filter: "returnedtypecode eq 'queue'" });
    expect(result).toMatchObject({ filterApplied: false, rows: [{ userqueryid: "v" }] });
  });

  test("permission denied and table-not-found raise typed errors", async () => {
    installXrm({ bulkdeleteoperation: () => { throw new Error("Principal user is missing prvReadBulkDeleteOperation privilege (0x80040220)"); } });
    await expect(dataverseSource.readTable({ logicalName: "bulkdeleteoperation", select: ["bulkdeleteoperationid"], expand: [] })).rejects.toMatchObject({ kind: "noPermission" });
    await expect(dataverseSource.readTable({ logicalName: "cts_openinghour", select: ["cts_openinghourid"], expand: [] })).rejects.toBeInstanceOf(DataAccessError);
    await expect(dataverseSource.readTable({ logicalName: "cts_openinghour", select: ["cts_openinghourid"], expand: [] })).rejects.toMatchObject({ kind: "notFound" });
  });

  test("outside Dataverse, reading fails with a clear message", async () => {
    await expect(dataverseSource.readTable({ logicalName: "queue", select: ["queueid"], expand: [] })).rejects.toThrow(/must run inside a Dataverse model-driven app/);
  });
});

describe("helpers", () => {
  test("error classification", () => {
    expect(classifyError("Principal user is missing prvReadQueue privilege")).toBe("noPermission");
    expect(classifyError("The entity with a name = 'cts_x' was not found in the MetadataCache. Could not find entity")).toBe("notFound");
    expect(classifyError("Could not find a property named 'x'")).toBe("error");
  });

  test("record links point at the model-driven app's record form", () => {
    installXrm({}, "https://org.crm.dynamics.com");
    expect(recordUrl("queue", "abc")).toBe("https://org.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=queue&id=abc");
  });
});
