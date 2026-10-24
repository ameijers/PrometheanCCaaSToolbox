// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { buildGraph } from "../../environment-3d-explorer/src/graph";
import { demoRaw } from "../../environment-3d-explorer/src/demoData";
import { combine, defaultGrouping } from "../src/centers";
import { buildPlan, UNROUTED_CENTER } from "../src/floorplan";

const graph = buildGraph(demoRaw());
const node = (kind: string, name: string) => graph.nodes.find((n) => n.kind === kind && n.name === name)!;

describe("buildPlan", () => {
  const grouping = defaultGrouping(graph);
  const plan = buildPlan(graph, grouping);
  const rooms = plan.areas.filter((a) => a.kind === "room");

  test("a building per center, plus one for queues no workstream routes to", () => {
    expect(plan.buildings.map((b) => b.centerId)).toEqual([...grouping.centers.map((c) => c.id), UNROUTED_CENTER]);
    expect(rooms.filter((r) => r.centerId === UNROUTED_CENTER).map((r) => r.name)).toEqual(["Social Media"]);
  });

  test("every queue gets exactly one room, every workstream a lobby, every rule a signpost", () => {
    expect(rooms.map((r) => r.key).sort()).toEqual(graph.nodes.filter((n) => n.kind === "queue").map((n) => n.key).sort());
    expect(plan.areas.filter((a) => a.kind === "lobby")).toHaveLength(graph.nodes.filter((n) => n.kind === "workstream").length);
    expect(plan.fixtures.filter((f) => f.kind === "signpost")).toHaveLength(graph.nodes.filter((n) => n.kind === "rule").length);
  });

  test("an agent has one desk, and a room says how many of its members sit elsewhere", () => {
    const desks = plan.fixtures.filter((f) => f.kind === "desk").map((f) => f.key);
    expect(new Set(desks).size).toBe(desks.length);
    expect(desks.length).toBe(graph.nodes.filter((n) => n.kind === "agent").length);
    const members = graph.edges.filter((e) => e.kind === "member").length;
    expect(desks.length + [...plan.elsewhere.values()].reduce((s, n) => s + n, 0)).toBe(members);
  });

  test("the bot is a kiosk in front of its reception, overflow sits by its room's door", () => {
    const ws = node("workstream", "Customer Service – Voice");
    const kiosk = plan.fixtures.find((f) => f.kind === "kiosk")!;
    const reception = plan.fixtures.find((f) => f.kind === "reception" && f.key === ws.key)!;
    expect(kiosk.x).toBeCloseTo(reception.x);
    expect(kiosk.z).toBeGreaterThan(reception.z);
    const kinds = plan.fixtures.filter((f) => ["mailbox", "booth", "transfer"].includes(f.kind)).map((f) => f.kind).sort();
    expect(kinds).toEqual(["booth", "mailbox", "mailbox", "transfer"]);
  });

  test("routes to a room in the same building run along the corridor; a shared queue gets a skybridge", () => {
    expect(plan.paths.filter((p) => p.kind === "route").every((p) => p.points.length === 4)).toBe(true);
    // Overflow is every workstream's default queue, so all but its own building cross over.
    const overflowRoom = rooms.find((r) => r.name === "Overflow")!;
    const bridges = plan.paths.filter((p) => p.kind === "skybridge");
    expect(bridges.length).toBeGreaterThan(0);
    expect(bridges.every((p) => Math.max(...p.points.map((q) => q[1])) > 5)).toBe(true);
    expect(overflowRoom).toBeDefined();
  });

  test("combining centers moves their lobbies into one building, and shared rooms stop needing skybridges", () => {
    const sales = grouping.centers.find((c) => c.name === "Retail Sales – Voice")!;
    const support = grouping.centers.find((c) => c.name === "Technical Support – Voice")!;
    const service = grouping.centers.find((c) => c.name === "Customer Service – Voice")!;
    const combined = buildPlan(graph, combine(grouping, [sales.id, support.id, service.id], "Contoso"));
    expect(combined.buildings).toHaveLength(plan.buildings.length - 2);
    const contoso = combined.buildings.find((b) => b.name === "Contoso")!;
    expect(combined.areas.filter((a) => a.kind === "lobby" && a.centerId === contoso.centerId)).toHaveLength(3);
    expect(combined.paths.filter((p) => p.kind === "skybridge").length).toBeLessThan(plan.paths.filter((p) => p.kind === "skybridge").length);
  });

  test("buildings don't overlap, and everything with a place has an anchor", () => {
    plan.buildings.forEach((a, i) => plan.buildings.slice(i + 1).forEach((b) => {
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.z - a.d >= b.z || b.z - b.d >= a.z;
      expect(apart).toBe(true);
    }));
    ["phone", "channel", "bot", "workstream", "rule", "queue", "agent", "hours", "overflow"].forEach((kind) =>
      graph.nodes.filter((n) => n.kind === kind && (kind !== "phone" || graph.edges.some((e) => e.from === n.key))).forEach((n) => expect(plan.anchors.has(n.key)).toBe(true)));
  });

  test("the same input gives the same plan", () => {
    expect(JSON.stringify(buildPlan(graph, grouping).fixtures)).toBe(JSON.stringify(plan.fixtures));
  });
});

// The tool reads only, through the explorer's data layer, and keeps its centers in the browser.
describe("read-only guarantee", () => {
  const srcDir = path.resolve(__dirname, "../src");
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  test.each(files)("%s contains no Dataverse write", (file) => {
    const contents = fs.readFileSync(path.join(srcDir, file), "utf8");
    ["createRecord", "updateRecord", "deleteRecord", "executeMultiple", "execute(", "fetch(", "XMLHttpRequest"].forEach((w) => expect(contents.includes(w)).toBe(false));
  });
});
