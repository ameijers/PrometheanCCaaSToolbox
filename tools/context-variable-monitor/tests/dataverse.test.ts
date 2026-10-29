// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { loadCapturedValues, loadRecentWorkItems } from "../src/dataverse";
import { latestByName, looksLikeEntityReference, parseDisplayValue } from "../src/contextValues";

// Rows shaped like the real ones: in pt-ccaas-dev the elastic table was empty and the values were in
// msdyn_ocliveworkitemcontextitem; in academyexperiment it was the other way round.
function installXrm(rows: Record<string, Record<string, unknown>[] | Error>) {
  const reads: { table: string; query: string }[] = [];
  (global as any).Xrm = {
    WebApi: {
      retrieveMultipleRecords: async (table: string, query: string) => {
        reads.push({ table, query });
        if (table === "EntityDefinitions") return { entities: [] };
        const r = rows[table];
        if (r instanceof Error) throw r;
        return { entities: r ?? [] };
      }
    }
  };
  return { reads };
}

afterEach(() => { delete (global as any).Xrm; });

describe("loadCapturedValues", () => {
  test("finds the values in the regular table when the elastic one is empty", async () => {
    installXrm({
      msdyn_ocliveworkitemcontextitemelastic: [],
      msdyn_ocliveworkitemcontextitem: [
        { msdyn_name: "Brand", msdyn_value: "CP", msdyn_datatype: 192350000, createdon: "2026-10-16T06:27:12Z" },
        { msdyn_name: "msdyn_contact_msdyn_ocliveworkitem_Customer", msdyn_value: "[{\"RecordId\":\"7af9866b\",\"PrimaryDisplayValue\":null}]", createdon: "2026-10-12T06:59:16Z" }
      ]
    });
    const values = await loadCapturedValues("w1");
    expect(values.map((v) => [v.name, v.displayValue, v.type])).toEqual([
      ["Brand", "CP", "text"],
      ["msdyn_contact_msdyn_ocliveworkitem_Customer", "record 7af9866b", "entityReference"]
    ]);
  });

  test("reads both tables, keeps the newest value per name, and skips a table it can't read", async () => {
    installXrm({
      msdyn_ocliveworkitemcontextitemelastic: [{ msdyn_name: "ParentMenu", msdyn_value: "Sales", msdyn_datatype: 192350000, createdon: "2026-10-28T09:30:00Z" }],
      msdyn_ocliveworkitemcontextitem: [{ msdyn_name: "parentmenu", msdyn_value: "Voicemail", msdyn_datatype: 192350000, createdon: "2026-10-28T09:31:00Z" }]
    });
    expect((await loadCapturedValues("w1")).map((v) => v.rawValue)).toEqual(["Voicemail"]);

    installXrm({ msdyn_ocliveworkitemcontextitemelastic: new Error("Principal user is missing prvReadmsdyn_ocliveworkitemcontextitemelastic privilege"), msdyn_ocliveworkitemcontextitem: [{ msdyn_name: "Brand", msdyn_value: "CP", createdon: "x" }] });
    expect((await loadCapturedValues("w1")).map((v) => v.name)).toEqual(["Brand"]);

    installXrm({ msdyn_ocliveworkitemcontextitemelastic: new Error("permission denied"), msdyn_ocliveworkitemcontextitem: new Error("permission denied") });
    await expect(loadCapturedValues("w1")).rejects.toThrow(/permission/);
  });
});

describe("loadRecentWorkItems", () => {
  test("a call's id is its activityid (the table's key), not the msdyn_ocliveworkitemid text column", async () => {
    const { reads } = installXrm({ msdyn_ocliveworkitem: [{ activityid: "b8f15cd1", msdyn_ocliveworkitemid: null, msdyn_title: "Test TestContact: PT_CAO_Workstream", createdon: "2026-10-28T09:46:08Z", statecode: 1 }] });
    expect(await loadRecentWorkItems("ws")).toEqual([{ id: "b8f15cd1", title: "Test TestContact: PT_CAO_Workstream", createdOn: "2026-10-28T09:46:08Z", active: false }]);
    expect(reads.find((r) => r.table === "msdyn_ocliveworkitem")?.query).toMatch(/\$select=activityid,/);
  });
});

describe("display values", () => {
  test("an entity reference without a display value shows its record id; one with shows the name", () => {
    expect(parseDisplayValue("[{\"RecordId\":\"d23e\",\"PrimaryDisplayValue\":\"+31620912644\"}]", "entityReference")).toBe("+31620912644");
    expect(parseDisplayValue("[{\"RecordId\":\"d23e\",\"PrimaryDisplayValue\":null}]", "entityReference")).toBe("record d23e");
    expect(looksLikeEntityReference("[{\"RecordId\":\"d23e\"}]")).toBe(true);
    expect(looksLikeEntityReference("False")).toBe(false);
  });

  test("latestByName keeps one value per name", () => {
    const v = (name: string, capturedOn: string) => ({ name, rawValue: capturedOn, displayValue: capturedOn, type: "text" as const, capturedOn });
    expect(latestByName([v("A", "1"), v("a", "3"), v("B", "2")]).map((x) => x.rawValue)).toEqual(["3", "2"]);
  });
});
