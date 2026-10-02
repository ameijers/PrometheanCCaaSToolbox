// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { dataverseSource, recordUrl } from "../src/dataverse";

// Mock of the subset of Xrm.WebApi this tool calls.
function installXrm(rows: Record<string, Record<string, unknown>[]>, clientUrl = "https://org.crm.dynamics.com") {
  const reads: { table: string; query: string }[] = [];
  const creates: { table: string; payload: Record<string, unknown> }[] = [];
  (global as any).Xrm = {
    Utility: { getGlobalContext: () => ({ getClientUrl: () => clientUrl }) },
    WebApi: {
      retrieveMultipleRecords: async (table: string, query: string) => {
        reads.push({ table, query });
        const all = rows[table] ?? [];
        // Page the first table with a nextLink, to exercise paging.
        if (table === "queue" && !query.includes("page=2")) return { entities: all.slice(0, 1), nextLink: `https://org.crm.dynamics.com/api/data/v9.2/queues?${query.slice(1)}&page=2` };
        if (table === "queue") return { entities: all.slice(1) };
        return { entities: all };
      },
      createRecord: async (table: string, payload: Record<string, unknown>) => {
        creates.push({ table, payload });
        return { entityType: table, id: "{ABCDEF00-0000-0000-0000-000000000001}" };
      }
    }
  };
  return { reads, creates };
}

afterEach(() => { delete (global as any).Xrm; });

describe("dataverseSource", () => {
  test("loadCatalog reads every table, follows paging and normalizes numbers", async () => {
    const { reads } = installXrm({
      queue: [{ queueid: "q1", name: "A" }, { queueid: "q2", name: "B" }],
      msdyn_ocphonenumber: [{ msdyn_ocphonenumberid: "p1", msdyn_phonenumber: "+31 20 123 4567", statecode: 0, msdyn_phoneinboundenabled: true, msdyn_phoneoutboundenabled: false }],
      msdyn_liveworkstream: [{ msdyn_liveworkstreamid: "w1", msdyn_name: "Main" }],
      msdyn_ocvoicechannelsetting: [{ msdyn_ocvoicechannelsettingid: "c1", msdyn_name: "Main line", _msdyn_phonenumberid_value: "p1", _msdyn_liveworkstreamid_value: "w1" }],
      msdyn_oclanguage: [{ msdyn_oclanguageid: "l1", msdyn_languagename: "English - United States", msdyn_localecode: "en-US" }]
    });
    const catalog = await dataverseSource.loadCatalog();
    expect(catalog.queues.map((q) => q.name)).toEqual(["A", "B"]);
    expect(catalog.phoneNumbers).toEqual([{ id: "p1", number: "+31201234567", active: true, inbound: true, outbound: false }]);
    expect(catalog.channels).toEqual([{ id: "c1", name: "Main line", phoneNumberId: "p1", workstreamName: "Main" }]);
    expect(catalog.languages[0]).toEqual({ id: "l1", name: "English - United States", localeCode: "en-US" });
    expect(reads.find((r) => r.table === "queue")?.query).toContain("msdyn_isomnichannelqueue eq true");
  });

  test("create sends the logical name and returns a clean, lowercase id", async () => {
    const { creates } = installXrm({});
    const id = await dataverseSource.create("channel", { msdyn_name: "x" });
    expect(creates).toEqual([{ table: "msdyn_ocvoicechannelsetting", payload: { msdyn_name: "x" } }]);
    expect(id).toBe("abcdef00-0000-0000-0000-000000000001");
  });

  test("create refuses a table outside the allowlist, even if the type system is bypassed", async () => {
    const { creates } = installXrm({});
    await expect(dataverseSource.create("queue" as any, {})).rejects.toThrow(/doesn't create/);
    expect(creates).toEqual([]);
  });

  test("countRoutingConfigurations filters on the workstream", async () => {
    const { reads } = installXrm({ msdyn_routingconfiguration: [{ msdyn_routingconfigurationid: "r1" }] });
    expect(await dataverseSource.countRoutingConfigurations("w1")).toBe(1);
    expect(reads[0].query).toContain("_msdyn_liveworkstreamid_value eq w1");
  });

  test("outside Dataverse it fails with a clear message", async () => {
    await expect(dataverseSource.loadCatalog()).rejects.toThrow(/must run inside a Dataverse/);
    expect(recordUrl("workstream", "w1")).toBeUndefined();
  });

  test("record links open the model-driven form", () => {
    installXrm({});
    expect(recordUrl("channel", "c1")).toBe("https://org.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=msdyn_ocvoicechannelsetting&id=c1");
  });
});
