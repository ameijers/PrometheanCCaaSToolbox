// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { BuilderSource, CreatableTable } from "../../voice-workstream-builder/src/dataSource";
import { demoSource, resetDemo } from "../../voice-workstream-builder/src/demoData";
import { executePlan } from "../../voice-workstream-builder/src/execute";
import { Catalog } from "../../voice-workstream-builder/src/model";
import { channelPayload, workstreamPayload } from "../../voice-workstream-builder/src/payload";
import { resolveProfiles, validateProfiles } from "../src/plan";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";

let catalog: Catalog;
beforeEach(async () => {
  resetDemo();
  catalog = await demoSource.loadCatalog();
  // An inbound-only number, to show the outbound check.
  catalog.phoneNumbers.push({ id: "00000000-0000-4000-8000-000000000045", number: "+31209999999", active: true, inbound: true, outbound: false });
});

const plan = (lines: string[]) => resolveProfiles(validateProfiles(parseCsv(lines.join("\n"))), catalog);
const errors = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "error");
const warnings = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "warning");
const HEAD = "profile_name,phone_number,outbound_queue";

describe("outbound profiles: validation and resolution", () => {
  test("the example resolves cleanly against the sample environment", () => {
    const p = resolveProfiles(validateProfiles(parseCsv(exampleCsv())), catalog);
    expect(p.issues).toEqual([]);
    expect(p.workstreams.map((w) => [w.name, w.channels[0].phoneNumber, w.channels[0].outbound?.callerIdNumber, w.channels[0].outbound?.anonymousCallerId])).toEqual([
      ["Sales – Outbound", "+31201234567", "+31201234567", false],
      ["Callbacks – Outbound", "+18005550100", "+18005550100", false],
      ["Support – Outbound", "+31201234568", "+31201234567", false],
      ["Escalations – Outbound (hidden number)", "+31201234568", "+31201234568", true]
    ]);
    expect(p.workstreams[3].refs.capacityProfile?.name).toBe("Escalation profile");
  });

  test("each profile is an outbound workstream with one channel, with the admin center's outbound defaults", () => {
    const p = plan([HEAD, "P,+31201234567,Callbacks"]);
    const ws = p.workstreams[0];
    expect(ws).toMatchObject({ direction: "Outbound", workDistribution: "Push", capacityFormat: "Profile", capacityUnits: 30, presences: ["Available", "Busy"], notification: "Screen pop with timeout" });
    expect(ws.refs.capacityProfile?.name).toBe("Default voice outbound");
    expect(ws.channels).toHaveLength(1);
    expect(ws.channels[0]).toMatchObject({ name: "P", language: "en-US", recording: { capture: "none" }, outbound: { callerIdNumber: "+31201234567", anonymousCallerId: false } });
    expect(ws.channels[0].refs.callerIdNumber).toBe(ws.channels[0].refs.phoneNumber);
  });

  test("phone number and outbound queue are required", () => {
    const p = plan([HEAD, "P,,", "Q,+31 20 123 45 67,"]);
    expect(errors(p).map((e) => `${e.line}:${e.column}`)).toEqual(["2:phone_number", "2:outbound_queue", "3:outbound_queue"]);
    expect(errors(p)[0].message).toMatch(/Every profile needs a phone number/);
  });

  test("the number must be enabled for outbound calling, and must exist", () => {
    const p = plan([HEAD, "P,+31209999999,Callbacks", "Q,+31600000000,Callbacks", "R,+31207654321,Callbacks"]);
    expect(errors(p).map((e) => [e.line, e.message.slice(0, 40)])).toEqual([
      [2, "+31209999999 isn't enabled for outbound "],
      [3, "+31600000000 isn't a phone number in thi"],
      [4, "+31207654321 is deactivated in this envi"]
    ]);
    expect(errors(p)[0].message).toMatch(/can't place calls from it/);
  });

  test("a number already used by an inbound channel is normal for a profile: no warning", () => {
    expect(plan([HEAD, "P,+13159956114,Callbacks"]).issues).toEqual([]);
  });

  test("caller ID number must exist; anonymous hides name and number", () => {
    const p = plan(["profile_name,phone_number,outbound_queue,caller_id_number,caller_id_name,anonymous_caller_id", "P,+31201234567,Callbacks,+31600000000,,No", "Q,+31201234567,Callbacks,+31201234568,Contoso,Yes"]);
    expect(errors(p).map((e) => `${e.line}:${e.column}`)).toEqual(["2:caller_id_number"]);
    expect(warnings(p).map((w) => `${w.line}:${w.column}`)).toEqual(["3:caller_id_name", "3:caller_id_number"]);
  });

  test("Inbound isn't supported yet; other values are invalid", () => {
    const p = plan(["profile_name,profile_type,phone_number,outbound_queue", "P,Inbound,+31201234567,Callbacks", "Q,Sideways,+31201234567,Callbacks", "R,outbound,+31201234567,Callbacks"]);
    expect(errors(p).map((e) => [e.line, e.column])).toEqual([[2, "profile_type"], [3, "profile_type"]]);
    expect(errors(p)[0].message).toMatch(/Inbound profiles aren't supported yet/);
  });

  test("names: unique in the file, and new in the environment", () => {
    const p = plan([HEAD, "New,+31201234567,Callbacks", "new,+31201234567,Callbacks", "Contoso Voice,+31201234567,Callbacks"]);
    expect(errors(p).map((e) => [e.line, e.column])).toEqual([[3, "profile_name"], [4, "profile_name"]]);
    expect(errors(p)[1].message).toMatch(/A profile or workstream named "Contoso Voice" already exists/);
  });

  test("invalid choices, presences and file-level problems", () => {
    const p = plan(["profile_name,phone_number,outbound_queue,transcript_recording,allowed_presences,anonymous_caller_id", "P,+31201234567,Callbacks,Recording,Available|Sleeping,maybe"]);
    expect(errors(p).map((e) => e.column).sort()).toEqual(["allowed_presences", "anonymous_caller_id", "transcript_recording"]);
    expect(errors(plan(["name", "x"]))[0].message).toMatch(/no profile_name column/);
    expect(errors(plan([HEAD]))[0].message).toMatch(/no rows/);
  });
});

describe("outbound profiles: what's written", () => {
  test("workstream: Outbound with the outbound queue; channel: number, caller ID, anonymity", () => {
    const p = plan(["profile_name,phone_number,outbound_queue,caller_id_number,caller_id_name,anonymous_caller_id", "P,+31201234567,Callbacks,+31201234568,Contoso Sales,No"]);
    const ws = p.workstreams[0];
    expect(workstreamPayload(ws)).toMatchObject({ msdyn_direction: 1, "msdyn_outboundqueueid@odata.bind": `/queues(${catalog.queues.find((q) => q.name === "Callbacks")!.id})` });
    expect(workstreamPayload(ws)).not.toHaveProperty("msdyn_defaultqueue@odata.bind");
    expect(workstreamPayload(ws)).not.toHaveProperty("msdyn_isdefault");
    const number = (n: string) => catalog.phoneNumbers.find((x) => x.number === n)!.id;
    expect(channelPayload("w1", ws.channels[0])).toMatchObject({
      msdyn_name: "P",
      "msdyn_phonenumberid@odata.bind": `/msdyn_ocphonenumbers(${number("+31201234567")})`,
      "msdyn_calleridphonenumberid@odata.bind": `/msdyn_ocphonenumbers(${number("+31201234568")})`,
      msdyn_calleridname: "Contoso Sales",
      msdyn_isanonymouscallerid: false
    });
  });

  test("creates workstream, capacity link, channel and language setting, without a routing-rules note", async () => {
    const created: CreatableTable[] = [];
    const source: BuilderSource = { ...demoSource, create: async (table) => { created.push(table); return `${table}-${created.length}`; } };
    const results = await executePlan(plan([HEAD, "P,+31201234567,Callbacks"]), source);
    expect(created).toEqual(["workstream", "capacityLink", "channel", "languageSetting"]);
    expect(results[0]).toMatchObject({ outcome: "created", notes: [] });
  });

  test("the copy in examples/ is exactly what the Upload step offers", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8")).toBe(exampleCsv());
  });
});
