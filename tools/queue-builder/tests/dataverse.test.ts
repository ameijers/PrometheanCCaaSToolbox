// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { dataverseSource, recordUrl } from "../src/dataverse";

const BASE = "https://org.crm.dynamics.com";
const Q = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";

function install(rows: Record<string, Record<string, unknown>[]> = {}, fetchStatus = 204, fetchBody?: unknown) {
  const reads: { table: string; query: string }[] = [];
  const creates: { table: string; payload: Record<string, unknown> }[] = [];
  const posts: { url: string; init: any }[] = [];
  (global as any).Xrm = {
    Utility: { getGlobalContext: () => ({ getClientUrl: () => BASE, userSettings: { userName: "Admin User" } }) },
    WebApi: {
      retrieveMultipleRecords: async (table: string, query: string) => { reads.push({ table, query }); return { entities: rows[table] ?? [] }; },
      createRecord: async (table: string, payload: Record<string, unknown>) => { creates.push({ table, payload }); return { id: `{${Q.toUpperCase()}}` }; }
    }
  };
  (global as any).fetch = async (url: string, init: any) => { posts.push({ url, init }); return { ok: fetchStatus < 300, status: fetchStatus, json: async () => fetchBody }; };
  return { reads, creates, posts };
}

afterEach(() => { delete (global as any).Xrm; delete (global as any).fetch; });

describe("dataverseSource", () => {
  test("loadCatalog reads queue names, active operating hours and interactive users", async () => {
    const { reads } = install({
      queue: [{ name: "Existing" }],
      msdyn_operatinghour: [{ msdyn_operatinghourid: "h1", msdyn_name: "Workdays" }],
      systemuser: [{ systemuserid: U, fullname: "Anna", domainname: "anna@contoso.com", internalemailaddress: "anna@contoso.com", isdisabled: false }]
    });
    expect(await dataverseSource.loadCatalog()).toEqual({
      queueNames: ["Existing"],
      operatingHours: [{ id: "h1", name: "Workdays" }],
      users: [{ id: U, fullName: "Anna", signIn: "anna@contoso.com", email: "anna@contoso.com", disabled: false }]
    });
    expect(reads.find((r) => r.table === "systemuser")!.query).toContain("accessmode eq 0");
  });

  test("createQueue creates a queue and returns a clean id", async () => {
    const { creates } = install();
    expect(await dataverseSource.createQueue({ name: "Q" })).toBe(Q);
    expect(creates).toEqual([{ table: "queue", payload: { name: "Q" } }]);
  });

  test("addMember POSTs a $ref to the queue's membership relationship", async () => {
    const { posts } = install();
    await dataverseSource.addMember(Q, U);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(`${BASE}/api/data/v9.2/queues(${Q})/queuemembership_association/$ref`);
    expect(posts[0].init.method).toBe("POST");
    expect(JSON.parse(posts[0].init.body)).toEqual({ "@odata.id": `${BASE}/api/data/v9.2/systemusers(${U})` });
  });

  test("addMember reports the platform's error, and refuses anything that isn't an id", async () => {
    install({}, 400, { error: { message: "The user is disabled." } });
    await expect(dataverseSource.addMember(Q, U)).rejects.toThrow("The user is disabled.");
    const { posts } = install();
    await expect(dataverseSource.addMember(`${Q})/other`, U)).rejects.toThrow(/Invalid/);
    expect(posts).toEqual([]);
  });

  test("hasAssignmentContract reads the new queue's contract lookup", async () => {
    install({ queue: [{ queueid: Q, _msdyn_assignmentinputcontractid_value: "c1" }] });
    expect(await dataverseSource.hasAssignmentContract(Q)).toBe(true);
    install({ queue: [{ queueid: Q, _msdyn_assignmentinputcontractid_value: null }] });
    expect(await dataverseSource.hasAssignmentContract(Q)).toBe(false);
  });

  test("current user and record links", () => {
    install();
    expect(dataverseSource.currentUser()).toBe("Admin User");
    expect(recordUrl(Q)).toBe(`${BASE}/main.aspx?pagetype=entityrecord&etn=queue&id=${Q}`);
  });
});
