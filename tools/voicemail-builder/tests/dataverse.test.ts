// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { dataverseSource } from "../src/dataverse";

interface Sent { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown>; }

const NEW_ID = "1377e01b-9dc7-f111-a05c-6045bd0151a5";
const Q = "23958b21-a9c7-f111-a05c-6045bd0151a5", U = "0a61bb38-ef8b-f111-8076-7ced8d3c0da2";
const API = "https://org.crm.dynamics.com/api/data/v9.2";

function install(rows: Record<string, Record<string, unknown>[]>, respond?: (sent: Sent) => { status: number; body?: unknown } | undefined) {
  const reads: { table: string; query: string }[] = [];
  const sent: Sent[] = [];
  (global as any).Xrm = {
    Utility: { getGlobalContext: () => ({ getClientUrl: () => "https://org.crm.dynamics.com" }) },
    WebApi: { retrieveMultipleRecords: async (table: string, query: string) => { reads.push({ table, query }); return { entities: rows[table] ?? [] }; } }
  };
  (global as any).fetch = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    const request: Sent = { method: init.method, url, headers: init.headers, body: JSON.parse(init.body) };
    sent.push(request);
    const answer = respond?.(request) ?? { status: 204 };
    return {
      ok: answer.status < 300, status: answer.status, json: async () => answer.body,
      headers: { get: (name: string) => (name === "OData-EntityId" && init.method === "POST" ? `${url}(${NEW_ID.toUpperCase()})` : null) }
    };
  };
  return { reads, sent };
}

afterEach(() => { delete (global as any).Xrm; delete (global as any).fetch; });

describe("dataverseSource", () => {
  test("loadCatalog joins overflow rulesets, members, the voicemail hub and its intake rules, the voicemail action and the contracts", async () => {
    const { reads } = install({
      queue: [
        { queueid: Q.toUpperCase(), name: "Contoso Flags Sales", msdyn_queuetype: 192350002, _msdyn_operatinghourid_value: null, _msdyn_prequeueoverflowrulesetid_value: "pre", _msdyn_inqueueoverflowrulesetid_value: null },
        { queueid: "q-vm", name: "Contoso Flags Sales Voicemail Queue", msdyn_queuetype: 192350001, _msdyn_operatinghourid_value: "oh" },
        { queueid: "q-sys", name: "<CDS System>", msdyn_queuetype: 192350001 }
      ],
      queuemembership: [{ queueid: "q-vm", systemuserid: U }],
      msdyn_liveworkstream: [{ msdyn_liveworkstreamid: "ws", msdyn_name: "Contoso Flags Sales Voicemail", msdyn_streamsource: 192350000, _msdyn_masterentityroutingconfigurationid_value: "hub", _msdyn_defaultqueue_value: "q-vm" }],
      systemuser: [{ systemuserid: U, fullname: "Alexander Meijers", domainname: "alexander@contoso.com", internalemailaddress: null, isdisabled: false }],
      msdyn_masterentityroutingconfiguration: [{ msdyn_masterentityroutingconfigurationid: "HUB", _msdyn_rulesetid_value: "hubrs" }],
      msdyn_overflowactionconfig: [{ msdyn_overflowactionconfigid: "other", msdyn_name: "Voicemail old" }, { msdyn_overflowactionconfigid: "VM", msdyn_name: "Voicemail" }],
      msdyn_decisioncontract: [
        { msdyn_decisioncontractid: "c1", msdyn_name: "Queue Overflow Management ruleset input contract" }, { msdyn_decisioncontractid: "c2", msdyn_name: "Queue Overflow Management ruleset output contract" },
        { msdyn_decisioncontractid: "c3", msdyn_name: "Inqueue Overflow Management ruleset input contract" }, { msdyn_decisioncontractid: "c4", msdyn_name: "Inqueue Overflow Management ruleset output contract" }
      ],
      msdyn_decisionruleset: [
        { msdyn_decisionrulesetid: "pre", msdyn_name: "queue_prequeue_Contoso Flags Sales", msdyn_rulesetdefinition: "<decision />" },
        { msdyn_decisionrulesetid: "hubrs", msdyn_name: "Voicemail decision ruleset", msdyn_rulesetdefinition: null }
      ]
    });
    const catalog = await dataverseSource.loadCatalog();
    expect(catalog.queues).toEqual([
      { id: Q, name: "Contoso Flags Sales", type: 192350002, hasOperatingHours: false, prequeue: { id: "pre", name: "queue_prequeue_Contoso Flags Sales", definition: "<decision />" }, inqueue: undefined, memberIds: [] },
      { id: "q-vm", name: "Contoso Flags Sales Voicemail Queue", type: 192350001, hasOperatingHours: true, prequeue: undefined, inqueue: undefined, memberIds: [U] }
    ]);
    expect(catalog.workstreams).toEqual([{ id: "ws", name: "Contoso Flags Sales Voicemail", record: true, hubId: "hub", defaultQueueId: "q-vm" }]);
    expect(catalog.hub).toEqual({ id: "hub", rulesetId: "hubrs", definition: undefined });
    expect(catalog.voicemailActionId).toBe("vm");
    expect(catalog.contracts).toEqual({ prequeueInput: "c1", prequeueOutput: "c2", inqueueInput: "c3", inqueueOutput: "c4" });
    expect(reads.find((r) => r.table === "msdyn_masterentityroutingconfiguration")!.query).toContain("msdyn_entitylogicalname eq 'msdyn_ocvoicemail'");
    expect(reads.find((r) => r.table === "msdyn_overflowactionconfig")!.query).toContain("msdyn_overflowactiontype eq 192350004");
    expect(reads.find((r) => r.table === "msdyn_decisionruleset")!.query).toContain("msdyn_decisionrulesetid eq pre or msdyn_decisionrulesetid eq hubrs");
  });

  test("create posts to the three tables and returns the new record's id", async () => {
    const { sent } = install({});
    expect(await dataverseSource.create("queue", { name: "VM", msdyn_queuetype: 192350001 })).toBe(NEW_ID);
    await dataverseSource.create("msdyn_liveworkstream", { msdyn_name: "VM", msdyn_streamsource: 192350000, "msdyn_masterentityroutingconfigurationId@odata.bind": "/msdyn_masterentityroutingconfigurations(h)" });
    await dataverseSource.create("msdyn_decisionruleset", { msdyn_name: "queue_prequeue_X", msdyn_rulesetdefinition: "<decision />" });
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([`POST ${API}/queues`, `POST ${API}/msdyn_liveworkstreams`, `POST ${API}/msdyn_decisionrulesets`]);
  });

  test("members are added through the queue's membership relationship", async () => {
    const { sent } = install({});
    await dataverseSource.addMember(Q, U);
    expect(sent).toEqual([{ method: "POST", url: `${API}/queues(${Q})/queuemembership_association/$ref`, headers: expect.anything(), body: { "@odata.id": `${API}/systemusers(${U})` } }]);
    await expect(dataverseSource.addMember("x)/other", U)).rejects.toThrow(/Invalid queue or user id/);
  });

  test("update patches only rules and overflow links, and never creates", async () => {
    const { sent } = install({});
    await dataverseSource.update("msdyn_decisionruleset", NEW_ID, { msdyn_rulesetdefinition: "<decision />" });
    await dataverseSource.update("queue", Q, { "msdyn_decisionrulesetid@odata.bind": `/msdyn_decisionrulesets(${NEW_ID})` });
    expect(sent.map((s) => [s.method, s.url, s.headers["If-Match"]])).toEqual([["PATCH", `${API}/msdyn_decisionrulesets(${NEW_ID})`, "*"], ["PATCH", `${API}/queues(${Q})`, "*"]]);
  });

  test("writes outside the scope are refused before anything is sent", async () => {
    const { sent } = install({});
    await expect(dataverseSource.create("msdyn_overflowactionconfig", { msdyn_name: "Voicemail" })).rejects.toThrow(/doesn't create msdyn_overflowactionconfig records/);
    await expect(dataverseSource.create("queue", { name: "VM", msdyn_operatinghourid: "x" })).rejects.toThrow(/doesn't write msdyn_operatinghourid on queue/);
    await expect(dataverseSource.update("queue", Q, { name: "Renamed" })).rejects.toThrow(/doesn't write name on queue/);
    await expect(dataverseSource.update("msdyn_liveworkstream", Q, { msdyn_name: "x" })).rejects.toThrow(/doesn't update msdyn_liveworkstream records/);
    await expect(dataverseSource.update("msdyn_masterentityroutingconfiguration", Q, { msdyn_name: "x" })).rejects.toThrow(/doesn't update/);
    expect(sent).toEqual([]);
  });

  test("a rejected write reports the platform's message and code", async () => {
    install({}, () => ({ status: 400, body: { error: { code: "0x80040203", message: "Invalid name." } } }));
    await expect(dataverseSource.create("queue", { name: "VM" })).rejects.toThrow("Invalid name. (error 0x80040203)");
  });
});
