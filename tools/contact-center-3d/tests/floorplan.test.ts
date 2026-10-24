// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { buildGraph } from "../../environment-3d-explorer/src/graph";
import { demoRaw } from "../../environment-3d-explorer/src/demoData";
import { combine, defaultGrouping, setHidden } from "../src/centers";
import { buildPlan, FLOOR_GAP, UNROUTED_CENTER } from "../src/floorplan";

const graph = buildGraph(demoRaw());
const node = (kind: string, name: string) => graph.nodes.find((n) => n.kind === kind && n.name === name)!;
const centerNamed = (g: ReturnType<typeof defaultGrouping>, name: string) => g.centers.find((c) => c.name === name)!;

describe("buildPlan", () => {
  const grouping = defaultGrouping(graph);
  const plan = buildPlan(graph, grouping);
  const rooms = plan.areas.filter((a) => a.kind === "room");
  const shownWorkstreams = graph.nodes.filter((n) => n.kind === "workstream" && !(grouping.hidden ?? []).includes(n.recordId!));

  test("workstreams linked to nothing start hidden, and get no building", () => {
    expect(grouping.hidden).toEqual([node("workstream", "Legacy Email").recordId]);
    expect(plan.buildings.some((b) => b.name === "Legacy Email")).toBe(false);
  });

  test("a building per shown center, plus one for queues no workstream routes to", () => {
    expect(plan.buildings.map((b) => b.centerId)).toEqual([...grouping.centers.filter((c) => c.name !== "Legacy Email").map((c) => c.id), UNROUTED_CENTER]);
    expect(rooms.filter((r) => r.centerId === UNROUTED_CENTER).map((r) => r.name)).toEqual(["Social Media"]);
  });

  test("every queue a room; one front desk per floor with a counter per workstream; every rule a signpost", () => {
    expect(rooms.map((r) => r.key).sort()).toEqual(graph.nodes.filter((n) => n.kind === "queue").map((n) => n.key).sort());
    expect(plan.fixtures.filter((f) => f.kind === "counter").map((f) => f.key).sort()).toEqual(shownWorkstreams.map((n) => n.key).sort());
    expect(plan.fixtures.filter((f) => f.kind === "signpost")).toHaveLength(graph.nodes.filter((n) => n.kind === "rule").length);
  });

  test("an agent has one desk, and a room says how many of its members sit elsewhere", () => {
    const desks = plan.fixtures.filter((f) => f.kind === "desk").map((f) => f.key);
    expect(new Set(desks).size).toBe(desks.length);
    expect(desks.length).toBe(graph.nodes.filter((n) => n.kind === "agent").length);
    const members = graph.edges.filter((e) => e.kind === "member").length;
    expect(desks.length + [...plan.elsewhere.values()].reduce((s, n) => s + n, 0)).toBe(members);
  });

  test("the bot is a kiosk in front of its counter; overflow sits by its room's door", () => {
    const counter = plan.fixtures.find((f) => f.kind === "counter" && f.key === node("workstream", "Customer Service – Voice").key)!;
    const kiosk = plan.fixtures.find((f) => f.kind === "kiosk")!;
    expect(kiosk.z).toBeGreaterThan(counter.z);
    const kinds = plan.fixtures.filter((f) => ["mailbox", "booth", "transfer"].includes(f.kind)).map((f) => f.kind).sort();
    expect(kinds).toEqual(["booth", "mailbox", "mailbox", "transfer"]);
  });

  test("routes on the same floor run along the corridor; a shared queue gets a skybridge", () => {
    expect(plan.paths.filter((p) => p.kind === "route").every((p) => p.points.length === 4)).toBe(true);
    const bridges = plan.paths.filter((p) => p.kind === "skybridge");
    expect(bridges.length).toBeGreaterThan(0);
    expect(bridges.every((p) => Math.max(...p.points.map((q) => q[1])) > 5)).toBe(true);
  });

  test("buildings don't overlap, and everything shown has an anchor", () => {
    plan.buildings.forEach((a, i) => plan.buildings.slice(i + 1).forEach((b) => {
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.z - a.d >= b.z || b.z - b.d >= a.z).toBe(true);
    }));
    shownWorkstreams.forEach((n) => expect(plan.anchors.has(n.key)).toBe(true));
    ["bot", "rule", "queue", "agent", "hours", "overflow"].forEach((kind) => graph.nodes.filter((n) => n.kind === kind).forEach((n) => expect(plan.anchors.has(n.key)).toBe(true)));
  });

  test("the same input gives the same plan", () => {
    expect(JSON.stringify(buildPlan(graph, grouping).fixtures)).toBe(JSON.stringify(plan.fixtures));
  });
});

describe("combined centers", () => {
  const grouping = defaultGrouping(graph);
  const names = ["Retail Sales – Voice", "Technical Support – Voice", "Customer Service – Voice", "Web Chat", "Dutch Desk – Voice"];
  const combined = combine(grouping, names.map((n) => centerNamed(grouping, n).id), "Contoso");
  const plan = buildPlan(graph, combined);
  const contoso = plan.buildings.find((b) => b.name === "Contoso")!;

  test("one front desk per floor, with a counter per workstream", () => {
    const ofContoso = plan.areas.filter((a) => a.centerId === contoso.centerId);
    expect(ofContoso.filter((a) => a.kind === "lobby").map((a) => a.floor)).toEqual(["voice", "messaging"]);
    const counters = plan.fixtures.filter((f) => f.kind === "counter" && plan.areas.some((a) => a.kind === "lobby" && a.centerId === contoso.centerId && Math.abs(a.y - f.y) < 0.01 && Math.abs(a.x - f.x) < a.w / 2 && Math.abs(a.z - f.z) < a.d / 2));
    expect(counters).toHaveLength(5);
  });

  test("a floor per kind of work, stacked: voice at the bottom, chat above, each queue on its own type's floor", () => {
    expect(contoso.floors.map((f) => [f.kind, f.y])).toEqual([["voice", 0], ["messaging", FLOOR_GAP]]);
    const room = (name: string) => plan.areas.find((a) => a.kind === "room" && a.name === name)!;
    expect(room("Chat Support").floor).toBe("messaging");
    expect(room("Chat Support").y).toBe(FLOOR_GAP);
    expect(room("Billing").floor).toBe("voice");
  });

  test("rooms are laid out in a grid, not in one row", () => {
    const voiceRooms = plan.areas.filter((a) => a.kind === "room" && a.centerId === contoso.centerId && a.floor === "voice");
    const rows = new Set(voiceRooms.map((r) => Math.round(r.z + r.d / 2)));
    const cols = Math.ceil(Math.sqrt(voiceRooms.length));
    expect(rows.size).toBe(Math.ceil(voiceRooms.length / cols));
    expect(rows.size).toBeGreaterThan(1);
  });

  test("the Floors switch shows one kind of floor, at ground level", () => {
    const chat = buildPlan(graph, combined, { floor: "messaging" });
    expect(chat.buildings.every((b) => b.floors.length === 1 && b.floors[0].kind === "messaging" && b.floors[0].y === 0)).toBe(true);
    expect(chat.areas.filter((a) => a.kind === "room").every((r) => r.floor === "messaging")).toBe(true);
  });

  test("hiding a workstream hides its counter, its signposts and rooms only it routes to", () => {
    const hidden = setHidden(combined, node("workstream", "Dutch Desk – Voice").recordId!, true);
    const without = buildPlan(graph, hidden);
    expect(without.fixtures.some((f) => f.key === node("workstream", "Dutch Desk – Voice").key)).toBe(false);
    expect(without.areas.some((a) => a.kind === "room" && a.name === "Dutch Desk")).toBe(false);
    expect(without.buildings.some((b) => b.centerId === UNROUTED_CENTER && without.areas.some((a) => a.centerId === b.centerId && a.name === "Dutch Desk"))).toBe(false);
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
