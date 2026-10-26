// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { columnsFor, dataverseSource, kindOf } from "../src/dataverse";

function installXrm(rows: Record<string, Record<string, unknown>[]>) {
  const updates: { table: string; id: string; columns: Record<string, unknown> }[] = [];
  (global as any).Xrm = {
    Utility: { getGlobalContext: () => ({ getClientUrl: () => "https://org.crm.dynamics.com" }) },
    WebApi: {
      retrieveMultipleRecords: async (table: string) => ({ entities: rows[table] ?? [] }),
      updateRecord: async (table: string, id: string, columns: Record<string, unknown>) => { updates.push({ table, id, columns }); return { entityType: table, id }; }
    }
  };
  return { updates };
}

afterEach(() => { delete (global as any).Xrm; });

describe("dataverseSource", () => {
  test("load reads channels with their workstream's direction, and the numbers", async () => {
    installXrm({
      msdyn_ocvoicechannelsetting: [
        { msdyn_ocvoicechannelsettingid: "c1", msdyn_name: "Sales", statecode: 0, _msdyn_liveworkstreamid_value: "w1", _msdyn_phonenumberid_value: "p1", _msdyn_calleridphonenumberid_value: null },
        { msdyn_ocvoicechannelsettingid: "c2", msdyn_name: "Default profile", statecode: 0, _msdyn_liveworkstreamid_value: "w2", _msdyn_phonenumberid_value: "p1", _msdyn_calleridphonenumberid_value: "p1" }
      ],
      msdyn_liveworkstream: [{ msdyn_liveworkstreamid: "w1", msdyn_name: "Sales WS", msdyn_direction: 0 }, { msdyn_liveworkstreamid: "w2", msdyn_name: "Default profile", msdyn_direction: 1 }],
      msdyn_ocphonenumber: [{ msdyn_ocphonenumberid: "p1", msdyn_phonenumber: "+13159956114", statecode: 0, msdyn_phoneinboundenabled: true, msdyn_phoneoutboundenabled: false }]
    });
    const { channels, numbers } = await dataverseSource.load();
    expect(channels).toEqual([
      { id: "c1", name: "Sales", workstreamId: "w1", workstreamName: "Sales WS", kind: "inbound", active: true, numberId: "p1", callerIdId: undefined },
      { id: "c2", name: "Default profile", workstreamId: "w2", workstreamName: "Default profile", kind: "outbound", active: true, numberId: "p1", callerIdId: "p1" }
    ]);
    expect(numbers).toEqual([{ id: "p1", number: "+13159956114", active: true, inbound: true, outbound: false }]);
  });

  test("kinds from msdyn_direction", () => {
    expect([0, 1, 2, 3, 4, undefined].map(kindOf)).toEqual(["inbound", "outbound", "other", "other", "proactive", "other"]);
  });

  test("setNumbers binds the lookups, clears with null, and writes only to the voice channel table", async () => {
    const { updates } = installXrm({});
    await dataverseSource.setNumbers("c1", { numberId: "p2", callerIdId: null });
    expect(updates).toEqual([{ table: "msdyn_ocvoicechannelsetting", id: "c1", columns: { "msdyn_phonenumberid@odata.bind": "/msdyn_ocphonenumbers(p2)", msdyn_calleridphonenumberid: null } }]);
    await dataverseSource.setNumbers("c1", {});
    expect(updates).toHaveLength(1);
  });

  test("anything but the two lookups is refused", () => {
    expect(() => columnsFor({ msdyn_name: "x" } as never)).toThrow(/only changes a voice channel's number and caller ID/);
  });
});
