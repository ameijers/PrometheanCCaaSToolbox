import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { runPlan } from "../../shared/src/runner";
import { demoSource, demoWriter, resetDemo } from "../src/demoData";
import { source, writer } from "../src/dataverse";
import { SkillCatalog } from "../src/model";
import { assignmentPayload, buildCsvPlan, buildSelectionPlan, findRating, splitSkill } from "../src/plan";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";

let catalog: SkillCatalog;
beforeEach(async () => { resetDemo(); catalog = await demoSource.loadCatalog(); });
const plan = (lines: string[]) => buildCsvPlan(parseCsv(lines.join("\n")), catalog, demoWriter);
const errors = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "error").map((e) => e.message);
const summary = (p: ReturnType<typeof plan>) => p.items.map((i) => [i.title, i.actions.map((a) => `${a.label}: ${a.target} [${a.status}]`)]);
const skill = (name: string) => catalog.skills.find((s) => s.name === name)!;
const rating = (value: number) => catalog.ratings.find((r) => r.value === value)!;
const user = (signIn: string) => catalog.users.find((u) => u.signIn === signIn)!.id;

describe("Skill Assignment from a CSV", () => {
  test("the example: new skills, a rating change and one already in place", () => {
    const p = buildCsvPlan(parseCsv(exampleCsv()), catalog, demoWriter);
    expect(p.issues).toEqual([]);
    expect(summary(p)).toEqual([
      ["Anna de Vries", ["Change rating: English: Good (3) → Excellent (5) [todo]", "Assign skill: Dutch — Very Good (4) [todo]", "Assign skill: Billing — Good (3) [todo]"]],
      ["Bram Jansen", ["Assign skill: English — Good (3) [todo]", "Assign skill: Technical support — no rating [todo]"]],
      ["Dana Smit", ["Assign skill: English — Excellent (5) [noChange]", "Change rating: Billing: no rating → Very Good (4) [todo]"]]
    ]);
  });

  test("no rating asked: an existing skill keeps its rating", () => {
    const p = plan(["user,skills", "anna@contoso.com,English"]);
    expect(p.items[0].actions[0]).toMatchObject({ status: "noChange", target: "English — Good (3)", reason: expect.stringMatching(/rating is kept/) });
  });

  test("ratings by name or number, case-insensitive; unknown ratings are errors", () => {
    const p = plan(["user,skills", "bram@contoso.com,English:very good|Dutch:2|Billing:Superb"]);
    expect(p.items[0].actions.map((a) => a.target)).toEqual(["English — Very Good (4)", "Dutch — Fair (2)"]);
    expect(errors(p)[0]).toMatch(/^Billing: "Superb" isn't a rating\. Use one of: Poor \(1\), Fair \(2\)/);
  });

  test("skills: unknown, deactivated, certification, duplicate, empty", () => {
    const p = plan(["user,skills", "bram@contoso.com,Nope|Legacy products|ITIL Foundation|English|english:3", "anna@contoso.com,"]);
    expect(errors(p)).toEqual([
      "No skill named \"Nope\" exists.",
      "The skill \"Legacy products\" is deactivated.",
      "\"ITIL Foundation\" is a certification, not a skill. This tool assigns skills only.",
      "\"English\" is listed more than once on this row.",
      "skills is empty. List at least one skill."
    ]);
  });

  test("users: unknown, not a bookable resource, listed twice, empty", () => {
    const p = plan(["user,skills", "nobody@contoso.com,English", "chris@contoso.com,English", "anna@contoso.com,Dutch", "anna@contoso.com,Billing", ",English"]);
    expect(errors(p)).toEqual([
      "\"nobody@contoso.com\" isn't in this environment.",
      "Chris Peters isn't a bookable resource yet, so skills can't be assigned. Run User Setup for this user first.",
      "Anna de Vries is also on line 4. Put all skills for one user on one row.",
      "user is empty. Every row needs the sign-in name or email of a user."
    ]);
    expect(p.items.map((i) => i.title)).toEqual(["Anna de Vries"]);
  });

  test("a matching email works as well as the sign-in name", () => {
    expect(plan(["user,skills", "dana.smit@contoso.com,Dutch"]).items[0].title).toBe("Dana Smit");
  });
});

describe("Skill Assignment by selection", () => {
  test("every selected user gets every selected skill, the same way as from a CSV", () => {
    const p = buildSelectionPlan([user("anna@contoso.com"), user("dana@contoso.com")], [{ skill: skill("English"), rating: rating(5) }, { skill: skill("Dutch") }], catalog, demoWriter);
    expect(p.issues).toEqual([]);
    expect(summary(p)).toEqual([
      ["Anna de Vries", ["Change rating: English: Good (3) → Excellent (5) [todo]", "Assign skill: Dutch — no rating [todo]"]],
      ["Dana Smit", ["Assign skill: English — Excellent (5) [noChange]", "Assign skill: Dutch — no rating [todo]"]]
    ]);
  });

  test("nothing selected, or a user who isn't a bookable resource", () => {
    expect(buildSelectionPlan([], [], catalog, demoWriter).issues.map((i) => i.message)).toEqual(["Select at least one user.", "Select at least one skill."]);
    const p = buildSelectionPlan([user("chris@contoso.com")], [{ skill: skill("English") }], catalog, demoWriter);
    expect(p.issues[0].message).toMatch(/isn't a bookable resource yet/);
  });
});

describe("Running", () => {
  test("assigns and changes ratings; a second run has nothing to do", async () => {
    const results = await runPlan(buildCsvPlan(parseCsv(exampleCsv()), catalog, demoWriter));
    expect(results.map((r) => r.outcome)).toEqual(["done", "done", "done"]);
    catalog = await demoSource.loadCatalog();
    const anna = catalog.resources.find((r) => r.userId === user("anna@contoso.com"))!;
    expect(anna.assignments.find((a) => a.skillId === skill("English").id)!.ratingId).toBe(rating(5).id);
    expect(anna.assignments).toHaveLength(3);
    const again = buildCsvPlan(parseCsv(exampleCsv()), catalog, demoWriter);
    expect(again.items.flatMap((i) => i.actions).every((a) => a.status === "noChange")).toBe(true);
  });
});

describe("Helpers", () => {
  test("splitSkill uses the last colon", () => {
    expect(splitSkill("English")).toEqual({ name: "English" });
    expect(splitSkill("Tier: 2 support:Good")).toEqual({ name: "Tier: 2 support", rating: "Good" });
    expect(splitSkill("English:")).toEqual({ name: "English", rating: undefined });
  });

  test("a rating name shared by two models needs the model", () => {
    const ratings = [...catalog.ratings, { id: "x", name: "Good", value: 2, modelName: "Languages" }];
    expect(findRating(ratings, "Good").problem).toMatch(/more than one rating model.*"Model \/ Good"/);
    expect(findRating(ratings, "Languages / Good").rating?.id).toBe("x");
  });

  test("the create payload binds resource, skill and (optionally) rating", () => {
    expect(assignmentPayload("r", "s")).toEqual({ "Resource@odata.bind": "/bookableresources(r)", "Characteristic@odata.bind": "/characteristics(s)" });
    expect(assignmentPayload("r", "s", "v")["RatingValue@odata.bind"]).toBe("/ratingvalues(v)");
  });
});

describe("Dataverse", () => {
  afterEach(() => { delete (globalThis as any).Xrm; });

  test("loadCatalog: skills per resource, only ratings of active models", async () => {
    const data: Record<string, any[]> = {
      systemuser: [{ systemuserid: "u1", fullname: "U", domainname: "u@x", isdisabled: false, accessmode: 0, _businessunitid_value: "b1" }],
      businessunit: [{ businessunitid: "b1", name: "Root" }],
      bookableresource: [{ bookableresourceid: "r1", _userid_value: "u1", statecode: 0 }],
      bookableresourcecharacteristic: [{ bookableresourcecharacteristicid: "a1", _resource_value: "r1", _characteristic_value: "c1", _ratingvalue_value: null }],
      characteristic: [{ characteristicid: "c1", name: "HITL", characteristictype: 1, statecode: 0 }],
      ratingvalue: [{ ratingvalueid: "v1", name: "Good", value: 3, _ratingmodel_value: "m1" }, { ratingvalueid: "v2", name: "Old", value: 1, _ratingmodel_value: "m2" }],
      ratingmodel: [{ ratingmodelid: "m1", name: "Skills Rating Model" }]
    };
    (globalThis as any).Xrm = { WebApi: { retrieveMultipleRecords: async (table: string) => ({ entities: data[table] }) } };
    const c = await source.loadCatalog();
    expect(c.resources).toEqual([{ id: "r1", userId: "u1", active: true, assignments: [{ id: "a1", skillId: "c1", ratingId: undefined }] }]);
    expect(c.users[0]).toMatchObject({ businessUnitName: "Root", interactive: true });
    expect(c.skills).toEqual([{ id: "c1", name: "HITL", active: true, type: 1 }]);
    expect(c.ratings).toEqual([{ id: "v1", name: "Good", value: 3, modelName: "Skills Rating Model" }]);
  });

  test("assign creates a bookableresourcecharacteristic; changeRating updates only the rating", async () => {
    const createRecord = jest.fn().mockResolvedValue({ id: "{00000000-0000-4000-8000-000000000001}" });
    const updateRecord = jest.fn().mockResolvedValue({});
    (globalThis as any).Xrm = { WebApi: { createRecord, updateRecord }, Utility: { getGlobalContext: () => ({ getClientUrl: () => "https://x" }) } };
    const payload = assignmentPayload("a", "b");
    await expect(writer.assign(payload)).resolves.toBe("00000000-0000-4000-8000-000000000001");
    expect(createRecord).toHaveBeenCalledWith("bookableresourcecharacteristic", payload);
    const a = "00000000-0000-4000-8000-000000000002", r = "00000000-0000-4000-8000-000000000003";
    await writer.changeRating(a, r);
    expect(updateRecord).toHaveBeenCalledWith("bookableresourcecharacteristic", a, { "RatingValue@odata.bind": `/ratingvalues(${r})` });
    await expect(writer.changeRating("x", r)).rejects.toThrow(/Invalid/);
  });
});

test("the example file in the repo matches the template", () => {
  const file = fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8").replace(/^﻿/, "");
  expect(file.replace(/\r\n/g, "\n").trim()).toBe(exampleCsv().replace(/\r\n/g, "\n").trim());
});
