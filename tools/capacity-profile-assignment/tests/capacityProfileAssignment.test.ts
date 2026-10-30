// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { runPlan } from "../../shared/src/runner";
import { demoSource, demoWriter, resetDemo } from "../src/demoData";
import { source, writer } from "../src/dataverse";
import { CapacityCatalog, profileLabel } from "../src/model";
import { buildCsvPlan, buildSelectionPlan, linkPayload } from "../src/plan";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";

let catalog: CapacityCatalog;
beforeEach(async () => { resetDemo(); catalog = await demoSource.loadCatalog(); });
const plan = (lines: string[]) => buildCsvPlan(parseCsv(lines.join("\n")), catalog, demoWriter);
const errors = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "error").map((e) => e.message);
const summary = (p: ReturnType<typeof plan>) => p.items.map((i) => [i.title, i.actions.map((a) => `${a.label}: ${a.target} [${a.status}]`)]);
const profile = (name: string) => catalog.profiles.find((p) => p.name === name)!;
const user = (signIn: string) => catalog.users.find((u) => u.signIn === signIn)!.id;

describe("Capacity Profile Assignment from a CSV", () => {
  test("the example: new profiles, and one already in place", () => {
    const p = buildCsvPlan(parseCsv(exampleCsv()), catalog, demoWriter);
    expect(p.issues).toEqual([]);
    expect(summary(p)).toEqual([
      ["Anna de Vries", ["Assign capacity profile: Escalation profile (1 unit) [todo]"]],
      ["Bram Jansen", ["Assign capacity profile: Default voice inbound (1 unit) [todo]", "Assign capacity profile: Default voice outbound (1 unit) [todo]"]],
      ["Dana Smit", ["Assign capacity profile: Default voice inbound (1 unit) [noChange]", "Assign capacity profile: Default voice outbound (1 unit) [todo]"]]
    ]);
  });

  test("profiles by name or unique name, case-insensitive", () => {
    const p = plan(["user,capacity_profiles", "eva@contoso.com,chat - 3 CONVERSATIONS|msdyn_escalationprofile"]);
    expect(p.items[0].actions.map((a) => a.target)).toEqual(["Chat - 3 conversations (3 units)", "Escalation profile (1 unit)"]);
  });

  test("profiles: unknown, deactivated, duplicate, empty", () => {
    const p = plan(["user,capacity_profiles", "bram@contoso.com,Nope|Legacy email|Default voice inbound|msdyn_voice_inbound_profile", "eva@contoso.com,"]);
    expect(errors(p)).toEqual([
      "No capacity profile named \"Nope\" exists.",
      "The capacity profile \"Legacy email\" is deactivated.",
      "\"Default voice inbound\" is listed more than once on this row.",
      "capacity_profiles is empty. List at least one capacity profile."
    ]);
  });

  test("users: unknown, not a bookable resource, listed twice, empty", () => {
    const p = plan(["user,capacity_profiles", "nobody@contoso.com,Escalation profile", "chris@contoso.com,Escalation profile", "anna@contoso.com,Escalation profile", "anna@contoso.com,Default voice inbound", ",Escalation profile"]);
    expect(errors(p)).toEqual([
      "\"nobody@contoso.com\" isn't in this environment.",
      "Chris Peters isn't a bookable resource yet, so capacity profiles can't be assigned. Run User Setup for this user first.",
      "Anna de Vries is also on line 4. Put all capacity profiles for one user on one row.",
      "user is empty. Every row needs the sign-in name or email of a user."
    ]);
    expect(p.items.map((i) => i.title)).toEqual(["Anna de Vries"]);
  });

  test("a matching email works as well as the sign-in name", () => {
    expect(plan(["user,capacity_profiles", "dana.smit@contoso.com,Escalation profile"]).items[0].title).toBe("Dana Smit");
  });
});

describe("Capacity Profile Assignment by selection", () => {
  test("every selected user gets every selected profile, the same way as from a CSV", () => {
    const p = buildSelectionPlan([user("anna@contoso.com"), user("eva@contoso.com")], [profile("Default voice inbound"), profile("Chat - 3 conversations")], catalog, demoWriter);
    expect(p.issues).toEqual([]);
    expect(summary(p)).toEqual([
      ["Anna de Vries", ["Assign capacity profile: Default voice inbound (1 unit) [noChange]", "Assign capacity profile: Chat - 3 conversations (3 units) [todo]"]],
      ["Eva Bakker", ["Assign capacity profile: Default voice inbound (1 unit) [todo]", "Assign capacity profile: Chat - 3 conversations (3 units) [todo]"]]
    ]);
  });

  test("nothing selected, or a user who isn't a bookable resource", () => {
    expect(buildSelectionPlan([], [], catalog, demoWriter).issues.map((i) => i.message)).toEqual(["Select at least one user.", "Select at least one capacity profile."]);
    const p = buildSelectionPlan([user("chris@contoso.com")], [profile("Escalation profile")], catalog, demoWriter);
    expect(p.issues[0].message).toMatch(/isn't a bookable resource yet/);
  });
});

describe("Running", () => {
  test("links the profiles; a second run has nothing to do", async () => {
    const results = await runPlan(buildCsvPlan(parseCsv(exampleCsv()), catalog, demoWriter));
    expect(results.map((r) => r.outcome)).toEqual(["done", "done", "done"]);
    catalog = await demoSource.loadCatalog();
    const bram = catalog.resources.find((r) => r.userId === user("bram@contoso.com"))!;
    expect(bram.profileIds).toEqual([profile("Default voice inbound").id, profile("Default voice outbound").id]);
    const again = buildCsvPlan(parseCsv(exampleCsv()), catalog, demoWriter);
    expect(again.items.flatMap((i) => i.actions).every((a) => a.status === "noChange")).toBe(true);
  });
});

describe("Helpers", () => {
  test("the link payload is named after the unique name and binds resource and profile", () => {
    expect(linkPayload("r", profile("Default voice inbound"))).toEqual({
      msdyn_name: "msdyn_voice_inbound_profile",
      "msdyn_bookableresourceid@odata.bind": "/bookableresources(r)",
      "msdyn_capacityprofileid@odata.bind": `/msdyn_capacityprofiles(${profile("Default voice inbound").id})`
    });
    expect(linkPayload("r", { id: "p", name: "No unique", active: true }).msdyn_name).toBe("No unique");
  });

  test("profileLabel shows the units when known", () => {
    expect(profileLabel({ id: "p", name: "Chat", active: true, defaultMaxUnits: 3 })).toBe("Chat (3 units)");
    expect(profileLabel({ id: "p", name: "Chat", active: true })).toBe("Chat");
  });
});

describe("Dataverse", () => {
  afterEach(() => { delete (globalThis as any).Xrm; });

  test("loadCatalog: active links per resource, active and deactivated profiles", async () => {
    const data: Record<string, any[]> = {
      systemuser: [{ systemuserid: "u1", fullname: "U", domainname: "u@x", isdisabled: false, accessmode: 0, _businessunitid_value: "b1" }],
      businessunit: [{ businessunitid: "b1", name: "Root" }],
      bookableresource: [{ bookableresourceid: "r1", _userid_value: "u1", statecode: 0 }],
      msdyn_bookableresourcecapacityprofile: [{ _msdyn_bookableresourceid_value: "r1", _msdyn_capacityprofileid_value: "p1" }],
      msdyn_capacityprofile: [
        { msdyn_capacityprofileid: "p1", msdyn_name: "Default voice inbound", msdyn_uniquename: "msdyn_voice_inbound_profile", msdyn_defaultmaxunits: 1, statecode: 0 },
        { msdyn_capacityprofileid: "p2", msdyn_name: "Old", msdyn_uniquename: null, msdyn_defaultmaxunits: null, statecode: 1 }
      ]
    };
    const queries: string[] = [];
    (globalThis as any).Xrm = { WebApi: { retrieveMultipleRecords: async (table: string, query: string) => { queries.push(`${table}${query}`); return { entities: data[table] }; } } };
    const c = await source.loadCatalog();
    expect(c.resources).toEqual([{ id: "r1", userId: "u1", active: true, profileIds: ["p1"] }]);
    expect(c.users[0]).toMatchObject({ businessUnitName: "Root", interactive: true });
    expect(c.profiles).toEqual([
      { id: "p1", name: "Default voice inbound", uniqueName: "msdyn_voice_inbound_profile", active: true, defaultMaxUnits: 1 },
      { id: "p2", name: "Old", uniqueName: undefined, active: false, defaultMaxUnits: undefined }
    ]);
    expect(queries.find((q) => q.startsWith("msdyn_bookableresourcecapacityprofile"))).toMatch(/statecode eq 0/);
  });

  test("link creates a msdyn_bookableresourcecapacityprofile", async () => {
    const createRecord = jest.fn().mockResolvedValue({ id: "{00000000-0000-4000-8000-000000000001}" });
    (globalThis as any).Xrm = { WebApi: { createRecord }, Utility: { getGlobalContext: () => ({ getClientUrl: () => "https://x" }) } };
    const payload = linkPayload("a", { id: "b", name: "B", active: true });
    await expect(writer.link(payload)).resolves.toBe("00000000-0000-4000-8000-000000000001");
    expect(createRecord).toHaveBeenCalledWith("msdyn_bookableresourcecapacityprofile", payload);
  });
});

test("the example file in the repo matches the template", () => {
  const file = fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8").replace(/^﻿/, "");
  expect(file.replace(/\r\n/g, "\n").trim()).toBe(exampleCsv().replace(/\r\n/g, "\n").trim());
});
