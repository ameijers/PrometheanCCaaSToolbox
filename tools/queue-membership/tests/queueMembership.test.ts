// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { runPlan } from "../../shared/src/runner";
import { demoSource, demoWriter, resetDemo } from "../src/demoData";
import { source, writer } from "../src/dataverse";
import { MembershipCatalog } from "../src/model";
import { buildMembershipPlan } from "../src/plan";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";

let catalog: MembershipCatalog;
beforeEach(async () => { resetDemo(); catalog = await demoSource.loadCatalog(); });
const plan = (lines: string[]) => buildMembershipPlan(parseCsv(lines.join("\n")), catalog, demoWriter);
const errors = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "error");

describe("Queue Membership plan", () => {
  test("the example: existing memberships are left alone", () => {
    const p = buildMembershipPlan(parseCsv(exampleCsv()), catalog, demoWriter);
    expect(p.issues).toEqual([]);
    expect(p.items.map((i) => [i.title, i.actions.map((a) => `${a.target}:${a.status}`)])).toEqual([
      ["Anna de Vries", ["Sales – NL:noChange", "Sales – Priority customers:todo"]],
      ["Bram Jansen", ["Sales – NL:todo"]],
      ["Dana Smit", ["Support – Overflow:todo", "Support – Chat:todo"]]
    ]);
  });

  test("the user must be a bookable resource", () => {
    const p = plan(["user,queues", "chris@contoso.com,Sales – NL"]);
    expect(errors(p)[0].message).toMatch(/isn't a bookable resource yet.*Run User Setup/);
    expect(p.items[0].actions).toEqual([]);
  });

  test("queues: unknown, not advanced, deactivated, empty list", () => {
    const p = plan(["user,queues", "anna@contoso.com,Nope|<Sales email>|Old campaign", "bram@contoso.com,"]);
    expect(errors(p).map((e) => e.message)).toEqual([
      "No queue named \"Nope\" exists.",
      "\"<Sales email>\" isn't an advanced (unified routing) queue.",
      "\"Old campaign\" is deactivated.",
      "queues is empty. List at least one queue."
    ]);
  });

  test("a resource without capacity profile is a warning", () => {
    catalog.resources[1].profileCount = 0;
    expect(plan(["user,queues", "bram@contoso.com,Sales – NL"]).issues[0]).toMatchObject({ severity: "warning", message: expect.stringMatching(/no capacity profile/) });
  });

  test("running twice changes nothing the second time", async () => {
    await runPlan(buildMembershipPlan(parseCsv(exampleCsv()), catalog, demoWriter));
    const again = buildMembershipPlan(parseCsv(exampleCsv()), await demoSource.loadCatalog(), demoWriter);
    expect(again.items.flatMap((i) => i.actions).every((a) => a.status === "noChange")).toBe(true);
  });

  test("the copy in examples/ is exactly what the Upload step offers", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8")).toBe(exampleCsv());
  });
});

describe("Queue Membership dataverse", () => {
  const Q = "11111111-1111-4111-8111-111111111111";
  const U = "22222222-2222-4222-8222-222222222222";
  afterEach(() => { delete (global as any).Xrm; delete (global as any).fetch; });

  test("loadCatalog and the one write", async () => {
    const posts: { url: string; body: any }[] = [];
    (global as any).Xrm = {
      Utility: { getGlobalContext: () => ({ getClientUrl: () => "https://org.crm.dynamics.com" }) },
      WebApi: { retrieveMultipleRecords: async (table: string) => ({ entities: ({
        queue: [{ queueid: "q1", name: "Q", msdyn_isomnichannelqueue: true, statecode: 0 }],
        queuemembership: [{ queueid: "q1", systemuserid: "u1" }],
        bookableresource: [{ bookableresourceid: "br1", _userid_value: "u1", statecode: 0 }],
        msdyn_bookableresourcecapacityprofile: [{ _msdyn_bookableresourceid_value: "br1" }]
      } as Record<string, unknown[]>)[table] ?? [] }) }
    };
    (global as any).fetch = async (url: string, init: any) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 204, json: async () => ({}) }; };
    const c = await source.loadCatalog();
    expect(c.queues[0]).toEqual({ id: "q1", name: "Q", advanced: true, active: true, memberIds: ["u1"] });
    expect(c.resources[0]).toEqual({ userId: "u1", active: true, profileCount: 1 });
    await writer.addToQueue(Q, U);
    expect(posts).toEqual([{ url: `https://org.crm.dynamics.com/api/data/v9.2/queues(${Q})/queuemembership_association/$ref`, body: { "@odata.id": `https://org.crm.dynamics.com/api/data/v9.2/systemusers(${U})` } }]);
  });
});
