// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph } from "../src/graph";
import { demoRaw } from "../src/demoData";
import { computeLayout, connectionScales } from "../src/layout";
import { defaultRideStart, extendRide, rideOptions } from "../src/ride";
import { readUrlOptions } from "../src/urlOptions";
import { loadViews, nextViewName, storeViews } from "../src/views";

describe("readUrlOptions", () => {
  test("reads focus, health and ride from the address", () => {
    expect(readUrlOptions("?focus=Sales&health=1&ride=yes")).toEqual({ focus: "Sales", health: true, ride: true, live: false });
    expect(readUrlOptions("")).toEqual({ focus: undefined, health: false, ride: false, live: false });
    expect(readUrlOptions("?health=0&ride=false")).toEqual({ focus: undefined, health: false, ride: false, live: false });
  });

  test("reads them from Dataverse's single data parameter too", () => {
    expect(readUrlOptions("?data=focus%3DCustomer%20Service%26health%3D1")).toEqual({ focus: "Customer Service", health: true, ride: false, live: false });
    expect(readUrlOptions("?data=live%3D1")).toEqual({ focus: undefined, health: false, ride: false, live: true });
    expect(readUrlOptions("?data=health%3D1")).toEqual({ focus: undefined, health: true, ride: false, live: false });
  });

  test("a plain data value is a record name", () => {
    expect(readUrlOptions("?data=Billing")).toEqual({ focus: "Billing", health: false, ride: false, live: false });
  });
});

describe("following the call", () => {
  const graph = buildGraph(demoRaw());
  const named = (name: string) => graph.nodes.find((n) => n.name === name)!.key;
  const names = (keys: string[]) => keys.map((k) => graph.nodes.find((n) => n.key === k)!.name);

  test("rides on by itself where there's one way, and stops at a fork", () => {
    const start = graph.nodes.find((n) => n.kind === "phone" && rideOptions(graph, n.key).length)!.key;
    const { path, options } = extendRide(graph, [start]);
    expect(path.map((k) => k.split(":")[0])).toEqual(["phone", "channel", "workstream"]);
    expect(options.length).toBeGreaterThan(1);
  });

  test("offers a workstream's rules in their order, then its default queue", () => {
    const options = rideOptions(graph, named("Customer Service – Voice"));
    expect(options.map((o) => o.name)).toEqual(["Billing", "Returns", "Technical", "Complaints", "Overflow"]);
    expect(options[4].relation).toBe("default queue");
  });

  test("goes from a rule to its queue, and from a queue to its agents or its overflow, but not on to skills", () => {
    const rule = graph.nodes.find((n) => n.kind === "rule" && n.name === "Billing")!.key;
    const { path, options } = extendRide(graph, [rule]);
    expect(names(path)).toEqual(["Billing", "Billing"]);
    expect(options.filter((o) => o.kind !== "agent").map((o) => `${o.name} (${o.relation})`)).toEqual(["Voicemail (overflow · Out of operating hours)"]);
    const agent = options[0].key;
    expect(rideOptions(graph, agent)).toEqual([]);
  });

  test("never goes back to a record already on the route", () => {
    const { path } = extendRide(graph, [named("Dutch Desk – Voice")]);
    expect(new Set(path).size).toBe(path.length);
  });

  test("starts from a phone number that leads somewhere", () => {
    const start = defaultRideStart(graph)!;
    expect(start.startsWith("phone:")).toBe(true);
    expect(rideOptions(graph, start).length).toBeGreaterThan(0);
  });
});

describe("connectionScales", () => {
  test("well-linked records are bigger, and every record keeps a visible size", () => {
    const graph = buildGraph(demoRaw());
    const scales = connectionScales(graph);
    const overflow = graph.nodes.find((n) => n.kind === "queue" && n.name === "Overflow")!;
    const socialMedia = graph.nodes.find((n) => n.name === "Social Media")!;
    expect(scales.get(overflow.key)!).toBeGreaterThan(scales.get(socialMedia.key)!);
    scales.forEach((s) => { expect(s).toBeGreaterThanOrEqual(0.7); expect(s).toBeLessThanOrEqual(3.2); });
  });
});

describe("saved views", () => {
  const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };

  test("are kept per environment", () => {
    const storage = memory();
    storeViews("org-a", [{ name: "Queues", position: [1, 2, 3], target: [0, 0, 0] }], storage);
    expect(loadViews("org-a", storage)).toEqual([{ name: "Queues", position: [1, 2, 3], target: [0, 0, 0] }]);
    expect(loadViews("org-b", storage)).toEqual([]);
  });

  test("ignore damaged or missing storage", () => {
    const storage = memory();
    storage.setItem("pct.explorer3d.views.org", "not json");
    expect(loadViews("org", storage)).toEqual([]);
    storage.setItem("pct.explorer3d.views.org", JSON.stringify([{ name: "ok", position: [1, 2, 3], target: [1, 2, 3] }, { name: "bad", position: [1] }]));
    expect(loadViews("org", storage).map((v) => v.name)).toEqual(["ok"]);
    expect(loadViews("org", undefined)).toEqual([]);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadViews("org", throwing)).toEqual([]);
    expect(() => storeViews("org", [], throwing)).not.toThrow();
  });

  test("suggest the next free name", () => {
    expect(nextViewName([])).toBe("View 1");
    expect(nextViewName([{ name: "View 2", position: [0, 0, 0], target: [0, 0, 0] }])).toBe("View 3");
  });
});
