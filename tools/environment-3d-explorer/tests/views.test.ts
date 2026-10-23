// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph, chainOf } from "../src/graph";
import { demoRaw } from "../src/demoData";
import { computeLayout, connectionScales } from "../src/layout";
import { KIND_ORDER } from "../src/model";
import { buildTour, tourCaption } from "../src/tour";
import { readUrlOptions } from "../src/urlOptions";
import { loadViews, nextViewName, storeViews } from "../src/views";

describe("readUrlOptions", () => {
  test("reads focus, health and tour from the address", () => {
    expect(readUrlOptions("?focus=Sales&health=1&tour=yes")).toEqual({ focus: "Sales", health: true, tour: true });
    expect(readUrlOptions("")).toEqual({ focus: undefined, health: false, tour: false });
    expect(readUrlOptions("?health=0&tour=false")).toEqual({ focus: undefined, health: false, tour: false });
  });

  test("reads them from Dataverse's single data parameter too", () => {
    expect(readUrlOptions("?data=focus%3DCustomer%20Service%26health%3D1")).toEqual({ focus: "Customer Service", health: true, tour: false });
    expect(readUrlOptions("?data=health%3D1")).toEqual({ focus: undefined, health: true, tour: false });
  });

  test("a plain data value is a record name", () => {
    expect(readUrlOptions("?data=Billing")).toEqual({ focus: "Billing", health: false, tour: false });
  });
});

describe("buildTour", () => {
  const graph = buildGraph(demoRaw());
  const positions = computeLayout(graph);

  test("stops once per layer, front to back", () => {
    const stops = buildTour(graph.nodes, positions);
    expect(stops.map((s) => s.kind)).toEqual(KIND_ORDER);
    stops.forEach((s) => expect(s.position[2]).toBeGreaterThan(s.target[2]));
  });

  test("tours only the chain when one is given", () => {
    const chain = chainOf(graph, graph.nodes.find((n) => n.name === "Dutch Desk – Voice")!.key);
    const stops = buildTour(graph.nodes, positions, chain);
    const workstreams = stops.find((s) => s.kind === "workstream")!;
    expect(workstreams.count).toBe(1);
    expect(tourCaption(workstreams)).toBe("1 workstream: Dutch Desk – Voice");
  });

  test("the caption names a few and counts the rest", () => {
    const agents = buildTour(graph.nodes, positions).find((s) => s.kind === "agent")!;
    expect(tourCaption(agents)).toMatch(/^\d+ agents: .+, and \d+ more$/);
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
