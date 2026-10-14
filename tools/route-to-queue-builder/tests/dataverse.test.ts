// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { dataverseSource } from "../src/dataverse";

interface Sent { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown>; }

const NEW_ID = "c6b3e70f-91c7-f111-a05c-6045bd0151a5";
const API = "https://org.crm.dynamics.com/api/data/v9.2";

// Reads go through Xrm.WebApi; writes through fetch, which is captured here.
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
  test("loadCatalog joins variables, the active routing configuration and its route-to-queue ruleset to each workstream", async () => {
    const { reads } = install({
      msdyn_liveworkstream: [
        { msdyn_liveworkstreamid: "W1", msdyn_name: "Contoso Flags Retail", msdyn_streamsource: 192440000, _msdyn_routingcontractid_value: "C1" },
        { msdyn_liveworkstreamid: "w2", msdyn_name: "Contoso Voice", msdyn_streamsource: 192440000, _msdyn_routingcontractid_value: "c2" },
        { msdyn_liveworkstreamid: "w3", msdyn_name: "Phone call workstream", msdyn_streamsource: 192440000, _msdyn_routingcontractid_value: null },
        { msdyn_liveworkstreamid: "w4", msdyn_name: "Old", msdyn_streamsource: 192440001, _msdyn_routingcontractid_value: "c4" }
      ],
      msdyn_ocliveworkstreamcontextvariable: [{ msdyn_ocliveworkstreamcontextvariableid: "V1", msdyn_name: "MenuItemSelected", msdyn_datatype: 192350000, _msdyn_liveworkstreamid_value: "w1" }],
      msdyn_routingconfiguration: [
        { msdyn_routingconfigurationid: "rc1", msdyn_name: "Route Selected Menu Items", msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: "w1" },
        { msdyn_routingconfigurationid: "rc2", msdyn_name: "Route to Queue", msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: "w2" },
        { msdyn_routingconfigurationid: "rc4", msdyn_name: "Old routing", msdyn_isactiveconfiguration: false, _msdyn_liveworkstreamid_value: "w4" }
      ],
      msdyn_routingconfigurationstep: [
        { msdyn_type: 192350002, msdyn_steporder: 1, _msdyn_routingconfigurationid_value: "rc1", _msdyn_rulesetid_value: "rs1" },
        { msdyn_type: 192350000, msdyn_steporder: 1, _msdyn_routingconfigurationid_value: "rc2", _msdyn_rulesetid_value: "rs2a" },
        { msdyn_type: 192350002, msdyn_steporder: 2, _msdyn_routingconfigurationid_value: "rc2", _msdyn_rulesetid_value: "rs2b" }
      ],
      msdyn_decisionruleset: [
        { msdyn_decisionrulesetid: "rs1", msdyn_name: "Route Selected Menu Items", msdyn_rulesetdefinition: "<decision />" },
        { msdyn_decisionrulesetid: "rs2b", msdyn_name: "Route to Queue", msdyn_rulesetdefinition: null }
      ],
      queue: [{ queueid: "Q1", name: "Contoso Flags Service", msdyn_queuetype: 192350002 }, { queueid: "q2", name: "<CDS System>", msdyn_queuetype: 192350002 }],
      msdyn_decisioncontract: [{ msdyn_decisioncontractid: "OUT" }]
    });
    const catalog = await dataverseSource.loadCatalog();
    expect(catalog.workstreams).toEqual([
      { id: "w1", name: "Contoso Flags Retail", voice: true, routingContractId: "c1", variables: [{ id: "v1", name: "MenuItemSelected", dataType: 192350000 }], routingInactive: false,
        routing: { configId: "rc1", configName: "Route Selected Menu Items", stepOrders: [1], queueRulesets: 1, queueRuleset: { id: "rs1", name: "Route Selected Menu Items", definition: "<decision />" } } },
      { id: "w2", name: "Contoso Voice", voice: true, routingContractId: "c2", variables: [], routingInactive: false,
        routing: { configId: "rc2", configName: "Route to Queue", stepOrders: [1, 2], queueRulesets: 1, queueRuleset: { id: "rs2b", name: "Route to Queue", definition: undefined } } },
      { id: "w3", name: "Phone call workstream", voice: true, routingContractId: undefined, variables: [], routing: undefined, routingInactive: false },
      { id: "w4", name: "Old", voice: false, routingContractId: "c4", variables: [], routing: undefined, routingInactive: true }
    ]);
    expect(catalog.queues).toEqual([{ id: "q1", name: "Contoso Flags Service", type: 192350002 }]);
    expect(catalog.outputContractId).toBe("out");
    expect(reads.find((r) => r.table === "msdyn_decisionruleset")!.query).toContain("msdyn_decisionrulesetid eq rs1 or msdyn_decisionrulesetid eq rs2b");
    expect(reads.find((r) => r.table === "msdyn_decisioncontract")!.query).toContain("msdyn_name eq 'Demand queue identification output contract'");
  });

  test("create posts to the four tables and returns the new record's id", async () => {
    const { sent } = install({});
    expect(await dataverseSource.create("msdyn_ocliveworkstreamcontextvariable", { msdyn_name: "MenuItemSelected", msdyn_datatype: 192350000, "msdyn_liveworkstreamid@odata.bind": "/msdyn_liveworkstreams(w1)" })).toBe(NEW_ID);
    await dataverseSource.create("msdyn_routingconfiguration", { msdyn_name: "R", msdyn_uniquename: "new_x", msdyn_isactiveconfiguration: true });
    await dataverseSource.create("msdyn_decisionruleset", { msdyn_name: "R", msdyn_rulesetdefinition: "<decision />" });
    await dataverseSource.create("msdyn_routingconfigurationstep", { msdyn_name: "R", msdyn_type: 192350002 });
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      `POST ${API}/msdyn_ocliveworkstreamcontextvariables`, `POST ${API}/msdyn_routingconfigurations`, `POST ${API}/msdyn_decisionrulesets`, `POST ${API}/msdyn_routingconfigurationsteps`
    ]);
  });

  test("writes outside the scope are refused before anything is sent", async () => {
    const { sent } = install({});
    await expect(dataverseSource.create("msdyn_liveworkstream", { msdyn_name: "x" })).rejects.toThrow(/doesn't create msdyn_liveworkstream records/);
    await expect(dataverseSource.create("msdyn_decisioncontract", { msdyn_name: "x" })).rejects.toThrow(/doesn't create msdyn_decisioncontract records/);
    await expect(dataverseSource.create("msdyn_ocliveworkstreamcontextvariable", { msdyn_name: "x", msdyn_entitylogicalname: "account" })).rejects.toThrow(/doesn't write msdyn_entitylogicalname/);
    await expect(dataverseSource.update("msdyn_decisionruleset", NEW_ID, { msdyn_name: "Renamed" })).rejects.toThrow(/doesn't write msdyn_name/);
    await expect(dataverseSource.update("msdyn_routingconfiguration", NEW_ID, { msdyn_isactiveconfiguration: false })).rejects.toThrow(/doesn't update msdyn_routingconfiguration records/);
    await expect(dataverseSource.update("msdyn_decisionruleset", "x)/msdyn_name", { msdyn_rulesetdefinition: "" })).rejects.toThrow(/Invalid record id/);
    expect(sent).toEqual([]);
  });

  test("update patches only the ruleset's rules, and never creates", async () => {
    const { sent } = install({});
    await dataverseSource.update("msdyn_decisionruleset", NEW_ID, { msdyn_rulesetdefinition: "<decision />" });
    expect(sent).toEqual([{ method: "PATCH", url: `${API}/msdyn_decisionrulesets(${NEW_ID})`, headers: expect.objectContaining({ "If-Match": "*" }), body: { msdyn_rulesetdefinition: "<decision />" } }]);
  });

  test("a rejected write reports the platform's message and code", async () => {
    install({}, () => ({ status: 400, body: { error: { code: "0x80040203", message: "Invalid name." } } }));
    await expect(dataverseSource.create("msdyn_routingconfiguration", { msdyn_name: "R" })).rejects.toThrow("Invalid name. (error 0x80040203)");
  });

  test("definitions are read fresh", async () => {
    install({ msdyn_decisionruleset: [{ msdyn_rulesetdefinition: "<decision />" }], msdyn_decisioncontract: [{ msdyn_contractdefinition: "<contract />" }] });
    expect(await dataverseSource.loadRulesetDefinition(NEW_ID)).toBe("<decision />");
    expect(await dataverseSource.loadContractDefinition(NEW_ID)).toBe("<contract />");
    install({});
    await expect(dataverseSource.loadRulesetDefinition(NEW_ID)).rejects.toThrow(/no longer exists/);
    expect(await dataverseSource.loadContractDefinition(NEW_ID)).toBeUndefined();
  });
});
