// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Snapshot } from "../../environment-snapshot/src/model";
import { FILE_FORMAT, fromFile, toFile } from "../../environment-snapshot/src/snapshotFile";
import { Comparison, compareSnapshots, counts, withoutEnvSpecific } from "../src/compare";
import { sampleSnapshots } from "../src/demoData";

let a: Snapshot, b: Snapshot;
beforeAll(async () => { ({ a, b } = await sampleSnapshots()); });

const table = (c: Comparison, name: string) => c.tables.find((t) => t.logicalName === name)!;
const item = (c: Comparison, tableName: string, name: string) => table(c, tableName).items.find((i) => i.name === name)!;

describe("by name", () => {
  let c: Comparison;
  beforeAll(() => { c = compareSnapshots(a, b, "name"); });

  test("a snapshot is the same as itself", () => {
    const self = compareSnapshots(a, a, "name");
    expect(self.tables.flatMap((t) => t.items).every((i) => i.status === "same")).toBe(true);
  });

  test("queues are found by name although their ids differ; changes, missing and extra queues are found", () => {
    expect(counts(table(c, "queue").items)).toEqual({ onlyA: 1, onlyB: 1, different: 1, same: 4 });
    expect(item(c, "queue", "Sales – EN")).toMatchObject({ status: "different", diffs: [{ key: "msdyn_assignmentstrategy", label: "Assignment method", a: "Least active", b: "Highest capacity", envSpecific: false }] });
    expect(item(c, "queue", "Sales – Outbound").status).toBe("onlyA");
    expect(item(c, "queue", "Billing").status).toBe("onlyB");
  });

  test("a workstream setting", () => {
    expect(item(c, "msdyn_liveworkstream", "Support – Voice").diffs).toEqual([{ key: "msdyn_capacityrequired", label: "Capacity", a: "30", b: "40", envSpecific: false }]);
    // Its fallback queue has another id in test, but it's the same queue by name.
    expect(item(c, "msdyn_liveworkstream", "Sales – Voice").status).toBe("same");
  });

  test("rules are compared as worded rules, with queue names instead of ids", () => {
    const route = item(c, "msdyn_decisionruleset", "Sales route");
    expect(route.status).toBe("different");
    expect(route.diffs).toHaveLength(1);
    expect(route.diffs[0].a).toContain("1. Dutch callers: when Customer language is \"nl-NL\" → Route to queue \"Sales – NL\"");
    expect(route.diffs[0].b).toContain("Customer language is \"nl-BE\"");
    // The support route sends to a queue with another id, by the same name: the same.
    expect(item(c, "msdyn_decisionruleset", "Support route").status).toBe("same");
  });

  test("link records are matched by what they link", () => {
    expect(item(c, "queuemembership", "Sales – Outbound · Liam de Vries")).toBeUndefined();
    expect(table(c, "msdyn_liveworkstreamcapacityprofile").items.every((i) => i.status === "same")).toBe(true);
    expect(item(c, "bookableresourcecharacteristic", "Ava Jansen · Dutch").status).toBe("same");
  });

  test("phone numbers differ, and are marked as expected to differ; hiding them leaves the configuration", () => {
    expect(table(c, "msdyn_ocphonenumber").envSpecific).toBe(true);
    const channel = item(c, "msdyn_ocvoicechannelsetting", "Sales – Main line");
    expect(channel.diffs).toEqual([{ key: "_msdyn_phonenumberid_value", label: "Phone number", a: "+15550100", b: "+155501090", envSpecific: true }]);
    const hidden = withoutEnvSpecific(c);
    expect(hidden.tables.some((t) => t.logicalName === "msdyn_ocphonenumber" || t.logicalName === "queuemembership")).toBe(false);
    expect(item(hidden, "msdyn_ocvoicechannelsetting", "Sales – Main line")).toMatchObject({ status: "same", diffs: [] });
  });

  test("tables missing or unreadable on a side are noted, not compared", () => {
    expect(table(c, "msdyn_ocfbpage")).toMatchObject({ items: [], notes: ["Not in environment A.", "Not in environment B."] });
    expect(table(c, "msdyn_personasecurityrolemapping").notes[0]).toMatch(/^Couldn't be read in A/);
  });
});

describe("by id", () => {
  test("queues with other ids are different records; the rest matches", () => {
    const c = compareSnapshots(a, b, "id");
    expect(counts(table(c, "queue").items)).toEqual({ onlyA: 6, onlyB: 6, different: 0, same: 0 });
    // Lookups compare ids: the workstream's fallback queue is another record in test.
    expect(item(c, "msdyn_liveworkstream", "Sales – Voice").diffs.map((d) => d.label)).toEqual(["Fallback queue"]);
    expect(item(c, "msdyn_liveworkstream", "Case routing").status).toBe("same");
    expect(item(c, "msdyn_decisionruleset", "Classify VIP callers").status).toBe("same");
  });

  test("a snapshot is the same as itself", () => {
    expect(compareSnapshots(a, a, "id").tables.flatMap((t) => t.items).every((i) => i.status === "same")).toBe(true);
  });
});

describe("snapshot file", () => {
  test("a snapshot survives the file", () => {
    const text = toFile(a);
    expect(JSON.parse(text).format).toBe(FILE_FORMAT);
    expect(fromFile(text)).toEqual(a);
  });

  test("anything else is refused with a plain reason", () => {
    expect(() => fromFile("not json")).toThrow(/can't be read as JSON/);
    expect(() => fromFile("{\"a\":1}")).toThrow(/isn't a snapshot file/);
    expect(() => fromFile(JSON.stringify({ format: FILE_FORMAT, version: 99, snapshot: {} }))).toThrow(/newer version/);
    expect(() => fromFile(JSON.stringify({ format: FILE_FORMAT, version: 1, snapshot: { environment: "x" } }))).toThrow(/incomplete or damaged/);
  });
});
