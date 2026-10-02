// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { runPlan } from "../../shared/src/runner";
import { demoSource, demoWriter, resetDemo } from "../src/demoData";
import { source, writer } from "../src/dataverse";
import { TeamCatalog } from "../src/model";
import { TeamWriter, buildTeamPlan, teamPayload } from "../src/plan";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";

let catalog: TeamCatalog;
beforeEach(async () => { resetDemo(); catalog = await demoSource.loadCatalog(); });

function recorder() {
  const calls: string[] = [];
  const w: TeamWriter = {
    createTeam: async (p) => { calls.push(`team:${p.name}:${p.teamtype}`); return `team-${calls.length}`; },
    addRole: async (teamId, roleId) => { calls.push(`role:${teamId}:${roleId}`); }
  };
  return { w, calls };
}
const plan = (lines: string[], w: TeamWriter = demoWriter) => buildTeamPlan(parseCsv(lines.join("\n")), catalog, w);
const errors = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "error");
const unit = (name: string) => catalog.businessUnits.find((u) => u.name === name)!;
const role = (name: string, unitName: string) => catalog.roles.find((r) => r.name === name && r.businessUnitId === unit(unitName).id)!;

describe("Team Builder plan", () => {
  test("the example: no errors; an existing group team only gets its missing role", () => {
    const p = buildTeamPlan(parseCsv(exampleCsv()), catalog, demoWriter);
    expect(errors(p)).toEqual([]);
    expect(p.items.map((i) => [i.title, i.actions.map((a) => `${a.label}:${a.target}:${a.status}`)])).toEqual([
      ["Sales Agents", ["Create team:Sales Agents (Sales):todo", "Assign role:Basic User:todo", "Assign role:Omnichannel agent:todo"]],
      ["Sales Supervisors", ["Create team:Sales Supervisors (Sales):noChange", "Assign role:Basic User:noChange", "Assign role:Omnichannel supervisor:todo"]],
      ["Service Agents", ["Create team:Service Agents (Service):todo", "Assign role:Basic User:todo", "Assign role:Omnichannel agent:todo"]],
      ["All Agents (Entra)", ["Create team:All Agents (Entra) (Contoso):todo", "Assign role:Omnichannel agent:todo"]]
    ]);
  });

  test("roles are resolved to the copy in the team's own business unit", async () => {
    const { w, calls } = recorder();
    await runPlan(plan(["team_name,business_unit,security_roles", "T,Service,Basic User"], w));
    expect(calls).toEqual(["team:T:0", `role:team-1:${role("Basic User", "Service").id}`]);
  });

  test("payloads: owner and Entra ID group teams", () => {
    const admin = catalog.users[0];
    expect(teamPayload({ name: "O", type: "Owner", unit: unit("Sales"), admin, membership: "Members" })).toEqual({
      name: "O", teamtype: 0, membershiptype: 0, "businessunitid@odata.bind": `/businessunits(${unit("Sales").id})`, "administratorid@odata.bind": `/systemusers(${admin.id})`
    });
    expect(teamPayload({ name: "G", type: "Entra ID security group", unit: unit("Sales"), admin, groupId: "0b6f4e1a-2c3d-4e5f-8a9b-1c2d3e4f5a6b", membership: "Members", description: "d" })).toMatchObject({
      teamtype: 2, membershiptype: 1, azureactivedirectoryobjectid: "0b6f4e1a-2c3d-4e5f-8a9b-1c2d3e4f5a6b", description: "d"
    });
  });

  test("defaults: Owner, root business unit, current user as administrator", () => {
    const p = plan(["team_name", "T"]);
    expect(p.items[0].facts).toEqual(["Owner", "Business unit: Contoso", "Administrator: Anna de Vries"]);
  });

  test("business unit, administrator and role problems", () => {
    const p = plan([
      "team_name,business_unit,administrator,security_roles",
      "A,Nowhere,,", "B,Legacy,,", "C,Sales,nobody@contoso.com,", "D,Sales,eva@contoso.com,", "E,Sales,integration@contoso.com,", "F,Sales,,Made-up role"
    ]);
    expect(errors(p).map((e) => [e.line, e.column])).toEqual([[2, "business_unit"], [3, "business_unit"], [4, "administrator"], [5, "administrator"], [6, "administrator"], [7, "security_roles"]]);
  });

  test("a role that exists elsewhere but not in the team's business unit is an error", () => {
    catalog.roles = catalog.roles.filter((r) => !(r.name === "Omnichannel agent" && r.businessUnitId === unit("Service").id));
    expect(errors(plan(["team_name,business_unit,security_roles", "T,Service,Omnichannel agent"]))[0].message).toMatch(/isn't available in the business unit "Service"/);
  });

  test("Entra ID group: object id required and must be a GUID; one team per group per business unit", () => {
    const p = plan([
      "team_name,team_type,business_unit,entra_group_object_id",
      "A,Entra ID security group,Sales,", "B,Entra ID security group,Sales,not-a-guid", "C,Entra ID security group,Sales,d65dcffa-60e8-4519-8e70-9cd95147ba20"
    ]);
    expect(errors(p).map((e) => [e.line, e.column])).toEqual([[2, "entra_group_object_id"], [3, "entra_group_object_id"], [4, "entra_group_object_id"]]);
    expect(errors(p)[2].message).toMatch(/already has a team in "Sales": "Sales Supervisors"/);
  });

  test("an existing team with the same name but a different type is an error; group fields on an owner team are ignored", () => {
    const p = plan(["team_name,team_type,business_unit,entra_group_object_id,membership_type", "Sales Supervisors,Owner,Sales,,", "X,Owner,Sales,0b6f4e1a-2c3d-4e5f-8a9b-1c2d3e4f5a6b,Members"]);
    expect(errors(p).map((e) => e.line)).toEqual([2]);
    expect(p.issues.filter((i) => i.severity === "warning" && i.line === 3).map((i) => i.column)).toEqual(["entra_group_object_id", "membership_type", "security_roles"]);
  });

  test("the same team twice in the file is an error; running the example twice changes nothing the second time", async () => {
    expect(errors(plan(["team_name,business_unit", "T,Sales", "t,sales"]))[0]).toMatchObject({ line: 3, column: "team_name" });
    await runPlan(buildTeamPlan(parseCsv(exampleCsv()), catalog, demoWriter));
    const again = buildTeamPlan(parseCsv(exampleCsv()), await demoSource.loadCatalog(), demoWriter);
    expect(again.items.flatMap((i) => i.actions).every((a) => a.status === "noChange")).toBe(true);
  });

  test("the copy in examples/ is exactly what the Upload step offers", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8")).toBe(exampleCsv());
  });
});

describe("Team Builder dataverse", () => {
  const TEAM = "11111111-1111-4111-8111-111111111111";
  const ROLE = "22222222-2222-4222-8222-222222222222";
  afterEach(() => { delete (global as any).Xrm; delete (global as any).fetch; });
  function install(rows: Record<string, unknown[]> = {}) {
    const creates: unknown[] = [];
    const posts: { url: string; init: any }[] = [];
    (global as any).Xrm = {
      Utility: { getGlobalContext: () => ({ getClientUrl: () => "https://org.crm.dynamics.com", userSettings: { userName: "Admin", userId: "{AAAAAAAA-0000-0000-0000-000000000001}" } }) },
      WebApi: {
        retrieveMultipleRecords: async (table: string) => ({ entities: rows[table] ?? [] }),
        createRecord: async (table: string, payload: unknown) => { creates.push({ table, payload }); return { id: `{${TEAM.toUpperCase()}}` }; }
      }
    };
    (global as any).fetch = async (url: string, init: any) => { posts.push({ url, init }); return { ok: true, status: 204, json: async () => ({}) }; };
    return { creates, posts };
  }

  test("loadCatalog joins roles to teams and knows the current user", async () => {
    install({
      team: [{ teamid: "t1", name: "T", teamtype: 2, _businessunitid_value: "b1", azureactivedirectoryobjectid: "g1" }],
      teamroles: [{ teamid: "t1", roleid: "r1" }],
      systemuser: [{ systemuserid: "u1", fullname: "U", domainname: "u@x", isdisabled: false, accessmode: 0 }]
    });
    const c = await source.loadCatalog();
    expect(c.teams).toEqual([{ id: "t1", name: "T", teamType: 2, businessUnitId: "b1", groupId: "g1", roleIds: ["r1"] }]);
    expect(c.users[0]).toMatchObject({ interactive: true, disabled: false });
    expect(c.currentUserId).toBe("aaaaaaaa-0000-0000-0000-000000000001");
  });

  test("createTeam and addRole write exactly what they should", async () => {
    const { creates, posts } = install();
    expect(await writer.createTeam({ name: "T" })).toBe(TEAM);
    expect(creates).toEqual([{ table: "team", payload: { name: "T" } }]);
    await writer.addRole(TEAM, ROLE);
    expect(posts[0].url).toBe(`https://org.crm.dynamics.com/api/data/v9.2/teams(${TEAM})/teamroles_association/$ref`);
    expect(JSON.parse(posts[0].init.body)).toEqual({ "@odata.id": `https://org.crm.dynamics.com/api/data/v9.2/roles(${ROLE})` });
    await expect(writer.addRole("x)/y", ROLE)).rejects.toThrow(/Invalid/);
  });
});
