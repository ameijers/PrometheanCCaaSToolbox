// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { buildGraph } from "../src/graph";
import { demoRaw } from "../src/demoData";
import { plannedRide } from "../src/tour";

const graph = buildGraph(demoRaw());
const node = (kind: string, name: string) => graph.nodes.find((n) => n.kind === kind && n.name === name);

describe("the guided tours", () => {
  test("every record the tours go to is in the sample environment", () => {
    // The names the tour scripts (in both tools' App.tsx) look up with keyOf(kind, name).
    const scripts = ["../src/App.tsx", "../../contact-center-3d/src/App.tsx"].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n");
    const lookups = [...scripts.matchAll(/(?:go|keyOf)\("(\w+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
    expect(lookups.length).toBeGreaterThan(8);
    lookups.forEach(([kind, name]) => expect(node(kind, name)).toBeDefined());
  });

  test("following a call is planned all the way to an agent, along the names asked for", () => {
    const channel = node("channel", "Customer Service channel")!.key;
    const phone = graph.edges.find((e) => e.kind === "number" && e.to === channel)!.from;
    const { path: route, options } = plannedRide(graph, phone, ["Customer Service channel", "Customer Service – Voice", "Billing", "Julia de Vries"]);
    const kinds = route.map((k) => graph.nodes.find((n) => n.key === k)!.kind);
    expect(kinds[0]).toBe("phone");
    expect(kinds[kinds.length - 1]).toBe("agent");
    expect(route).toContain(node("queue", "Billing")!.key);
    expect(route[route.length - 1]).toBe(node("agent", "Julia de Vries")!.key);
    expect(options).toEqual([]);
    // Each step follows a link in the graph.
    route.slice(1).forEach((k, i) => expect(graph.edges.some((e) => (e.from === route[i] && e.to === k) || (e.to === route[i] && e.from === k))).toBe(true));
  });

  test("a ride limited to what a tool shows leaves the rest out", () => {
    const phone = graph.nodes.find((n) => n.kind === "phone")!.key;
    const shown = (k: string) => !k.startsWith("bot:");
    expect(plannedRide(graph, phone, [], shown).path.some((k) => k.startsWith("bot:"))).toBe(false);
  });
});
