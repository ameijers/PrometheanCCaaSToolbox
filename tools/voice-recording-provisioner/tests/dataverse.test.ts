// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { dataverseSource, recordUrl } from "../src/dataverse";

function installXrm(rows: Record<string, Record<string, unknown>[]>) {
  const reads: { table: string; query: string }[] = [];
  const updates: { table: string; id: string; columns: Record<string, unknown> }[] = [];
  (global as any).Xrm = {
    Utility: { getGlobalContext: () => ({ getClientUrl: () => "https://org.crm.dynamics.com" }) },
    WebApi: {
      retrieveMultipleRecords: async (table: string, query: string) => { reads.push({ table, query }); return { entities: rows[table] ?? [] }; },
      updateRecord: async (table: string, id: string, columns: Record<string, unknown>) => { updates.push({ table, id, columns }); return { entityType: table, id }; }
    }
  };
  return { reads, updates };
}

afterEach(() => { delete (global as any).Xrm; });

describe("dataverseSource", () => {
  test("loadChannels joins workstream and number and reads the recording settings", async () => {
    const { reads } = installXrm({
      msdyn_ocvoicechannelsetting: [
        { msdyn_ocvoicechannelsettingid: "c1", msdyn_name: "Sales", statecode: 0, _msdyn_liveworkstreamid_value: "w1", _msdyn_phonenumberid_value: "p1", msdyn_transcriptionenabled: true, msdyn_transcriptionmode: "192351002", msdyn_recordingenabled: true, msdyn_recordingmode: "192351001", msdyn_agentrecordingcontrolsenabled: true },
        { msdyn_ocvoicechannelsettingid: "c2", msdyn_name: "Orphan", statecode: 1, _msdyn_liveworkstreamid_value: null, _msdyn_phonenumberid_value: null }
      ],
      msdyn_liveworkstream: [{ msdyn_liveworkstreamid: "w1", msdyn_name: "Sales WS", msdyn_direction: 4 }],
      msdyn_ocphonenumber: [{ msdyn_ocphonenumberid: "p1", msdyn_phonenumber: "+13159956114" }]
    });
    const [sales, orphan] = await dataverseSource.loadChannels();
    expect(sales).toMatchObject({ id: "c1", workstreamName: "Sales WS", direction: "Other", phoneNumber: "+13159956114", active: true, settings: { capture: "transcriptAndRecording", start: "automatic", agentRecordingControls: true } });
    expect(orphan).toMatchObject({ workstreamName: "(no workstream)", phoneNumber: undefined, active: false, settings: { capture: "none" } });
    expect(reads[0].query).toContain("msdyn_recordingmode");
  });

  test("updateChannel writes only to the voice channel table", async () => {
    const { updates } = installXrm({});
    await dataverseSource.updateChannel("c1", { msdyn_recordingenabled: false, msdyn_recordingmode: "192351000" });
    expect(updates).toEqual([{ table: "msdyn_ocvoicechannelsetting", id: "c1", columns: { msdyn_recordingenabled: false, msdyn_recordingmode: "192351000" } }]);
  });

  test("updateChannel refuses any column outside recording and transcription", async () => {
    const { updates } = installXrm({});
    await expect(dataverseSource.updateChannel("c1", { msdyn_recordingenabled: true, msdyn_phonenumberid: null })).rejects.toThrow(/only changes recording and transcription settings, not msdyn_phonenumberid/);
    expect(updates).toEqual([]);
  });

  test("an empty update isn't sent", async () => {
    const { updates } = installXrm({});
    await dataverseSource.updateChannel("c1", {});
    expect(updates).toEqual([]);
  });

  test("record links", () => {
    installXrm({});
    expect(recordUrl("c1")).toBe("https://org.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=msdyn_ocvoicechannelsetting&id=c1");
  });
});
