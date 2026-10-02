// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { runPlan } from "../../shared/src/runner";
import { demoSource, demoWriter, resetDemo } from "../src/demoData";
import { source, writer } from "../src/dataverse";
import { UserCatalog } from "../src/model";
import { UserWriter, buildUserPlan, capacityLinkPayload, resourcePayload } from "../src/plan";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";

let catalog: UserCatalog;
beforeEach(async () => { resetDemo(); catalog = await demoSource.loadCatalog(); });

function recorder() {
  const calls: string[] = [];
  const w: UserWriter = {
    addRole: async (u, r) => { calls.push(`role:${u}:${r}`); },
    addToTeam: async (t, u) => { calls.push(`team:${t}:${u}`); },
    createResource: async (p) => { calls.push(`resource:${p.name}:${p.timezone}`); return "res-new"; },
    linkCapacityProfile: async (p) => { calls.push(`capacity:${p["msdyn_bookableresourceid@odata.bind"]}:${p.msdyn_name}`); return "link"; }
  };
  return { w, calls };
}
const plan = (lines: string[], w: UserWriter = demoWriter) => buildUserPlan(parseCsv(lines.join("\n")), catalog, w);
const errors = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "error");
const warnings = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "warning");
const summary = (p: ReturnType<typeof plan>) => p.items.map((i) => [i.title, i.actions.map((a) => `${a.label}:${a.target}:${a.status}`)]);

describe("User Setup plan", () => {
  test("the example: roles, teams, bookable resource and capacity profiles; what's in place is left alone", () => {
    const p = buildUserPlan(parseCsv(exampleCsv()), catalog, demoWriter);
    expect(errors(p)).toEqual([]);
    expect(summary(p)).toEqual([
      ["Anna de Vries", ["Assign role:Basic User:noChange", "Assign role:Omnichannel agent:todo", "Make bookable resource:Anna de Vries (W. Europe Standard Time):todo", "Link capacity profile:Default voice inbound:todo", "Link capacity profile:Default voice outbound:todo"]],
      ["Bram Jansen", ["Add to team:Sales Agents:todo", "Make bookable resource:Bram Jansen (W. Europe Standard Time):todo", "Link capacity profile:Default voice inbound:todo"]],
      ["Chris Peters", ["Assign role:Basic User:todo", "Add to team:Sales Agents:todo", "Make bookable resource:Chris Peters (W. Europe Standard Time):todo", "Link capacity profile:Default voice inbound:todo", "Link capacity profile:Default voice outbound:todo"]],
      ["Dana Smit", ["Add to team:Service Agents:noChange", "Make bookable resource:Dana Smit:noChange", "Link capacity profile:Default voice inbound:noChange", "Link capacity profile:Escalation profile:todo"]]
    ]);
    expect(warnings(p).map((w) => [w.item, w.column])).toEqual([["dana.smit@contoso.com", "time_zone"]]);
  });

  test("capacity profiles go to the new resource, or to the existing one", async () => {
    const { w, calls } = recorder();
    await runPlan(plan(["user,capacity_profiles", "bram@contoso.com,", "dana@contoso.com,Default voice outbound"], w));
    expect(calls).toEqual([
      "resource:Bram Jansen:110",
      "capacity:/bookableresources(res-new):msdyn_voice_inbound_profile",
      "capacity:/bookableresources(res-new):msdyn_voice_default_outbound_profile",
      `capacity:/bookableresources(${catalog.resources[0].id}):msdyn_voice_default_outbound_profile`
    ]);
  });

  test("payloads: a User resource bound through UserId, and a named capacity link", () => {
    const user = catalog.users[1];
    expect(resourcePayload(user, 110)).toEqual({ name: "Bram Jansen", resourcetype: 3, "UserId@odata.bind": `/systemusers(${user.id})`, timezone: 110, msdyn_displayonscheduleboard: true });
    expect(capacityLinkPayload("r1", catalog.capacityProfiles[0])).toEqual({ msdyn_name: "msdyn_voice_inbound_profile", "msdyn_bookableresourceid@odata.bind": "/bookableresources(r1)", "msdyn_capacityprofileid@odata.bind": `/msdyn_capacityprofiles(${catalog.capacityProfiles[0].id})` });
  });

  test("users: not synced yet, disabled, not interactive, twice in the file", () => {
    const p = plan(["user", "new.agent@contoso.com", "eva@contoso.com", "integration@contoso.com", "anna@contoso.com", "ANNA@contoso.com"]);
    expect(errors(p).map((e) => e.line)).toEqual([2, 3, 4, 6]);
    expect(errors(p)[0].message).toMatch(/isn't in this environment yet\. Make sure the user is licensed and in the environment's security group/);
  });

  test("teams: Entra group and access teams are refused with what to do instead", () => {
    const p = plan(["user,teams", "bram@contoso.com,Sales Supervisors|Case access|Nope"]);
    expect(errors(p).map((e) => e.message)).toEqual([
      expect.stringMatching(/Entra ID group team: its members come from the group\. Add Bram Jansen to the group/),
      expect.stringMatching(/access team: it gives no security roles/),
      "No team named \"Nope\" exists."
    ]);
  });

  test("roles must exist in the user's own business unit", () => {
    catalog.roles = catalog.roles.filter((r) => !(r.name === "Omnichannel supervisor" && r.businessUnitId === catalog.users[0].businessUnitId));
    expect(errors(plan(["user,security_roles", "anna@contoso.com,Omnichannel supervisor"]))[0].message).toMatch(/isn't available in Anna de Vries's business unit "Sales"/);
  });

  test("time zones by code or name; none of their own falls back to UTC with a warning", () => {
    const p = plan(["user,time_zone", "chris@contoso.com,", "bram@contoso.com,romance standard time", "anna@contoso.com,Mars"]);
    expect(p.items[0].actions.find((a) => a.key === "resource")!.target).toBe("Chris Peters (UTC)");
    expect(p.items[1].actions.find((a) => a.key === "resource")!.target).toBe("Bram Jansen (Romance Standard Time)");
    expect(errors(p).map((e) => e.column)).toEqual(["time_zone"]);
    expect(warnings(p).some((w) => w.column === "time_zone" && /UTC/.test(w.message))).toBe(true);
  });

  test("capacity: 'none' links nothing (with a warning); unknown profiles are errors", () => {
    const p = plan(["user,capacity_profiles", "bram@contoso.com,none", "chris@contoso.com,Nope"]);
    expect(p.items[0].actions.map((a) => a.key)).toEqual(["resource"]);
    expect(warnings(p).some((w) => w.column === "capacity_profiles")).toBe(true);
    expect(errors(p).map((e) => e.column)).toEqual(["capacity_profiles"]);
  });

  test("a user without any role or team gets a warning", () => {
    expect(warnings(plan(["user", "bram@contoso.com"])).map((w) => w.column)).toEqual(["security_roles"]);
  });

  test("running the example twice changes nothing the second time", async () => {
    await runPlan(buildUserPlan(parseCsv(exampleCsv()), catalog, demoWriter));
    const again = buildUserPlan(parseCsv(exampleCsv()), await demoSource.loadCatalog(), demoWriter);
    expect(again.items.flatMap((i) => i.actions).every((a) => a.status === "noChange")).toBe(true);
  });

  test("the copy in examples/ is exactly what the Upload step offers", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8")).toBe(exampleCsv());
  });
});

describe("User Setup dataverse", () => {
  const U = "11111111-1111-4111-8111-111111111111";
  const R = "22222222-2222-4222-8222-222222222222";
  const T = "33333333-3333-4333-8333-333333333333";
  afterEach(() => { delete (global as any).Xrm; delete (global as any).fetch; });
  function install(rows: Record<string, unknown[]> = {}) {
    const creates: { table: string; payload: unknown }[] = [];
    const posts: { url: string; body: any }[] = [];
    (global as any).Xrm = {
      Utility: { getGlobalContext: () => ({ getClientUrl: () => "https://org.crm.dynamics.com", userSettings: { userName: "Admin" } }) },
      WebApi: {
        retrieveMultipleRecords: async (table: string) => ({ entities: rows[table] ?? [] }),
        createRecord: async (table: string, payload: unknown) => { creates.push({ table, payload }); return { id: "{AAAAAAAA-0000-0000-0000-000000000001}" }; }
      }
    };
    (global as any).fetch = async (url: string, init: any) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 204, json: async () => ({}) }; };
    return { creates, posts };
  }

  test("loadCatalog joins roles, memberships, resources, capacity links and time zones", async () => {
    install({
      systemuser: [{ systemuserid: "u1", fullname: "U", domainname: "u@x", isdisabled: false, accessmode: 0, _businessunitid_value: "b1" }],
      businessunit: [{ businessunitid: "b1", name: "Sales" }],
      systemuserroles: [{ systemuserid: "u1", roleid: "r1" }],
      team: [{ teamid: "t1", name: "T", teamtype: 0, _businessunitid_value: "b1" }],
      teammembership: [{ teamid: "t1", systemuserid: "u1" }],
      bookableresource: [{ bookableresourceid: "br1", _userid_value: "u1", statecode: 0 }],
      msdyn_bookableresourcecapacityprofile: [{ _msdyn_bookableresourceid_value: "br1", _msdyn_capacityprofileid_value: "p1" }],
      usersettings: [{ systemuserid: "u1", timezonecode: 110 }]
    });
    const c = await source.loadCatalog();
    expect(c.users[0]).toMatchObject({ businessUnitName: "Sales", roleIds: ["r1"], timeZone: 110 });
    expect(c.teams[0]).toMatchObject({ memberIds: ["u1"], businessUnitName: "Sales" });
    expect(c.resources[0]).toEqual({ id: "br1", userId: "u1", active: true, profileIds: ["p1"] });
  });

  test("the four writes", async () => {
    const { creates, posts } = install();
    await writer.addRole(U, R);
    await writer.addToTeam(T, U);
    expect(await writer.createResource({ name: "U" })).toBe("aaaaaaaa-0000-0000-0000-000000000001");
    await writer.linkCapacityProfile({ msdyn_name: "p" });
    expect(posts).toEqual([
      { url: `https://org.crm.dynamics.com/api/data/v9.2/systemusers(${U})/systemuserroles_association/$ref`, body: { "@odata.id": `https://org.crm.dynamics.com/api/data/v9.2/roles(${R})` } },
      { url: `https://org.crm.dynamics.com/api/data/v9.2/teams(${T})/Microsoft.Dynamics.CRM.AddMembersTeam`, body: { Members: [{ "@odata.type": "Microsoft.Dynamics.CRM.systemuser", systemuserid: U }] } }
    ]);
    expect(creates.map((c) => c.table)).toEqual(["bookableresource", "msdyn_bookableresourcecapacityprofile"]);
    await expect(writer.addToTeam("bad", U)).rejects.toThrow(/Invalid/);
  });
});
