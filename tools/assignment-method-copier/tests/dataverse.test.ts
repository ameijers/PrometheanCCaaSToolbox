// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { dataverseSource } from "../src/dataverse";

interface Sent { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown>; }

// Reads go through Xrm.WebApi; writes through fetch, which is captured here.
function installXrm(rows: Record<string, Record<string, unknown>[]>, respond?: (sent: Sent) => { status: number; body?: unknown } | undefined) {
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

const NEW_ID = "9bb9970e-e3c6-f111-a05c-6045bd0151a5";
const M1 = "5f3cae1d-d8c6-f111-a05c-6045bd0153e8", Q1 = "612694e4-babc-f111-aaaf-6045bd0151a5";
const API = "https://org.crm.dynamics.com/api/data/v9.2";

afterEach(() => { delete (global as any).Xrm; delete (global as any).fetch; });

describe("dataverseSource", () => {
  test("loadQueues reads active advanced queues with their methods, without the platform's own queues", async () => {
    const { reads } = installXrm({
      queue: [
        { queueid: "Q1", name: "Contoso Flags Retail", msdyn_queuetype: 192350002, msdyn_assignmentstrategy: 192350003, _msdyn_assignmentinputcontractid_value: "C1" },
        { queueid: "q2", name: "Contoso Sales", msdyn_queuetype: 192350002, msdyn_assignmentstrategy: 192350003, _msdyn_assignmentinputcontractid_value: null },
        { queueid: "q3", name: "<CDS System>", msdyn_queuetype: 192350001, msdyn_assignmentstrategy: 192350002, _msdyn_assignmentinputcontractid_value: "c3" }
      ],
      msdyn_assignmentconfiguration: [
        { msdyn_assignmentconfigurationid: "M1", msdyn_name: "Contoso Flags Retail Custom Assignment", msdyn_isactiveconfiguration: false, _msdyn_queueid_value: "q1" },
        { msdyn_assignmentconfigurationid: "m3", msdyn_name: "Direct Agent Assignment", msdyn_isactiveconfiguration: true, _msdyn_queueid_value: "q3" }
      ]
    });
    expect(await dataverseSource.loadQueues()).toEqual([
      { id: "q1", name: "Contoso Flags Retail", type: 192350002, strategy: 192350003, inputContractId: "c1", methods: [{ id: "m1", name: "Contoso Flags Retail Custom Assignment", active: false }] },
      { id: "q2", name: "Contoso Sales", type: 192350002, strategy: 192350003, inputContractId: undefined, methods: [] }
    ]);
    expect(reads[0].query).toContain("msdyn_isomnichannelqueue eq true and statecode eq 0");
  });

  test("loadMethod joins the steps to their rulesets", async () => {
    const { reads } = installXrm({
      msdyn_assignmentconfiguration: [{ msdyn_assignmentconfigurationid: "m1", msdyn_name: "Custom", msdyn_description: null, msdyn_isactiveconfiguration: true, _msdyn_queueid_value: "q1" }],
      msdyn_assignmentconfigurationstep: [
        { msdyn_assignmentconfigurationstepid: "s1", msdyn_name: "New ruleset", msdyn_type: 192350000, msdyn_steporder: 1, msdyn_isdefaultruleset: true, _msdyn_rulesetid_value: "r1" },
        { msdyn_assignmentconfigurationstepid: "s2", msdyn_name: "Lost", msdyn_type: 192350002, msdyn_steporder: 2, msdyn_isdefaultruleset: true, _msdyn_rulesetid_value: "r-missing" }
      ],
      msdyn_decisionruleset: [{ msdyn_decisionrulesetid: "r1", msdyn_name: "New ruleset", msdyn_rulesetdefinition: "<decision />", msdyn_rulesettype: 192350000, msdyn_authoringmode: 192350000, msdyn_isinputcollection: false, msdyn_persistoutputdata: false, msdyn_refreshinputdata: false, msdyn_disabledrules: null, _msdyn_inputcontractid_value: "c1", _msdyn_outputcontractid_value: "c1" }]
    });
    const method = await dataverseSource.loadMethod("m1");
    expect(method).toMatchObject({ id: "m1", name: "Custom", active: true, queueId: "q1", description: undefined });
    expect(method.steps[0]).toMatchObject({ id: "s1", type: 192350000, order: 1, isDefault: true, ruleset: { id: "r1", definition: "<decision />", rulesetType: 192350000, inputContractId: "c1", outputContractId: "c1", disabledRules: undefined } });
    expect(method.steps[1].ruleset).toBeUndefined();
    expect(reads.find((r) => r.table === "msdyn_decisionruleset")!.query).toContain("msdyn_decisionrulesetid eq r1 or msdyn_decisionrulesetid eq r-missing");
  });

  test("loadMethod fails clearly when the method is gone", async () => {
    installXrm({});
    await expect(dataverseSource.loadMethod("m1")).rejects.toThrow(/no longer exists/);
  });

  test("create posts to the three tables and returns the new record's id", async () => {
    const { sent } = installXrm({});
    expect(await dataverseSource.create("msdyn_assignmentconfiguration", { msdyn_name: "Custom", msdyn_uniquename: "msdyn_uniquename_x", msdyn_isactiveconfiguration: false, "msdyn_queueid@odata.bind": `/queues(${Q1})` })).toBe(NEW_ID);
    await dataverseSource.create("msdyn_decisionruleset", { msdyn_name: "Rules", msdyn_rulesetdefinition: "<decision />", "msdyn_inputcontractid@odata.bind": "/msdyn_decisioncontracts(c1)" });
    await dataverseSource.create("msdyn_assignmentconfigurationstep", { msdyn_name: "Rules", msdyn_type: 192350002, "msdyn_rulesetid@odata.bind": "/msdyn_decisionrulesets(r1)" });
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([`POST ${API}/msdyn_assignmentconfigurations`, `POST ${API}/msdyn_decisionrulesets`, `POST ${API}/msdyn_assignmentconfigurationsteps`]);
    expect(sent[0].body).toEqual({ msdyn_name: "Custom", msdyn_uniquename: "msdyn_uniquename_x", msdyn_isactiveconfiguration: false, "msdyn_queueid@odata.bind": `/queues(${Q1})` });
    expect(sent[0].headers["If-Match"]).toBeUndefined();
  });

  test("create refuses other tables and other columns", async () => {
    const { sent } = installXrm({});
    await expect(dataverseSource.create("queue", { name: "New queue" })).rejects.toThrow(/doesn't create queue records/);
    await expect(dataverseSource.create("msdyn_decisioncontract", { msdyn_name: "x" })).rejects.toThrow(/doesn't create msdyn_decisioncontract records/);
    await expect(dataverseSource.create("msdyn_decisionruleset", { msdyn_name: "Rules", msdyn_fetchxml: "<fetch />" })).rejects.toThrow(/doesn't write msdyn_fetchxml on msdyn_decisionruleset/);
    expect(sent).toEqual([]);
  });

  test("a rejected write reports the platform's message and code", async () => {
    installXrm({}, () => ({ status: 400, body: { error: { code: "0x80040203", message: "Required field is missing." } } }));
    await expect(dataverseSource.create("msdyn_assignmentconfiguration", { msdyn_name: "Custom" })).rejects.toThrow("Required field is missing. (error 0x80040203)");
    installXrm({}, () => ({ status: 502 }));
    await expect(dataverseSource.update("queue", Q1, { msdyn_assignmentstrategy: 192350002 })).rejects.toThrow("HTTP 502");
  });

  test("update only switches a method or sets a queue's assignment method, and never creates", async () => {
    const { sent } = installXrm({});
    await dataverseSource.update("msdyn_assignmentconfiguration", M1, { msdyn_isactiveconfiguration: true });
    await dataverseSource.update("queue", Q1, { msdyn_assignmentstrategy: 192350002 });
    await dataverseSource.update("queue", Q1, {});
    expect(sent.map((s) => [s.method, s.url, s.body, s.headers["If-Match"]])).toEqual([
      ["PATCH", `${API}/msdyn_assignmentconfigurations(${M1})`, { msdyn_isactiveconfiguration: true }, "*"],
      ["PATCH", `${API}/queues(${Q1})`, { msdyn_assignmentstrategy: 192350002 }, "*"]
    ]);
    await expect(dataverseSource.update("queue", Q1, { name: "Renamed" })).rejects.toThrow(/doesn't write name on queue/);
    await expect(dataverseSource.update("msdyn_assignmentconfiguration", M1, { msdyn_name: "Renamed" })).rejects.toThrow(/doesn't write msdyn_name/);
    await expect(dataverseSource.update("msdyn_decisionruleset", M1, { msdyn_rulesetdefinition: "<decision />" })).rejects.toThrow(/doesn't update msdyn_decisionruleset records/);
    await expect(dataverseSource.update("queue", "queues(x)/name", { msdyn_assignmentstrategy: 192350002 })).rejects.toThrow(/Invalid record id/);
    expect(sent).toHaveLength(2);
  });
});
