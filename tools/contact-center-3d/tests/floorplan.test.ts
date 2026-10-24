// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { buildGraph } from "../../environment-3d-explorer/src/graph";
import { demoRaw } from "../../environment-3d-explorer/src/demoData";
import { createCenter, defaultGrouping, Grouping, moveWorkstream, setHidden } from "../src/centers";
import { buildPlan, UNROUTED_CENTER } from "../src/floorplan";

const graph = buildGraph(demoRaw());
const node = (kind: string, name: string) => graph.nodes.find((n) => n.kind === kind && n.name === name)!;

function contoso(): Grouping {
  let g = createCenter(defaultGrouping(graph), "Contoso", "contoso");
  ["Retail Sales – Voice", "Technical Support – Voice", "Customer Service – Voice", "Web Chat", "Dutch Desk – Voice"]
    .forEach((name) => { g = moveWorkstream(g, node("workstream", name).recordId!, "contoso", graph); });
  return g;
}

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

  test("every queue a room in the wing of its type; a counter per workstream; a signpost per rule", () => {
    expect(rooms.map((r) => r.key).sort()).toEqual(graph.nodes.filter((n) => n.kind === "queue").map((n) => n.key).sort());
    expect(rooms.find((r) => r.name === "Chat Support")!.wing).toBe("messaging");
    expect(rooms.find((r) => r.name === "Billing")!.wing).toBe("voice");
    expect(plan.fixtures.filter((f) => f.kind === "counter").map((f) => f.key).sort()).toEqual(shownWorkstreams.map((n) => n.key).sort());
    expect(plan.fixtures.filter((f) => f.kind === "signpost")).toHaveLength(graph.nodes.filter((n) => n.kind === "rule").length);
  });

  test("an agent has one desk, carrying their skills and business unit", () => {
    const desks = plan.fixtures.filter((f) => f.kind === "desk");
    expect(new Set(desks.map((d) => d.key)).size).toBe(desks.length);
    expect(desks.length).toBe(graph.nodes.filter((n) => n.kind === "agent").length);
    const members = graph.edges.filter((e) => e.kind === "member").length;
    expect(desks.length + [...plan.elsewhere.values()].reduce((s, n) => s + n, 0)).toBe(members);
    expect(desks.some((d) => (d.skills ?? []).length > 0)).toBe(true);
    expect(desks.filter((d) => d.unit).length).toBe(desks.length);
  });

  test("counters show their context variables; every room has chairs, every workstream a way in", () => {
    const counter = plan.fixtures.find((f) => f.kind === "counter" && f.key === node("workstream", "Retail Sales – Voice").key)!;
    expect(counter.variables).toEqual(["SelectedMenuItem", "CustomerLanguage"]);
    rooms.forEach((r) => expect(plan.chairs.get(r.key!)).toHaveLength(4));
    shownWorkstreams.forEach((w) => expect(plan.entrances.has(w.key)).toBe(true));
  });

  test("a queue transfer is a door in the back wall of its room, the other overflow sits outside the front door", () => {
    const tier1 = plan.areas.find((a) => a.kind === "room" && a.name === "Tier 1 Support")!;
    const transfer = plan.fixtures.find((f) => f.kind === "transfer")!;
    expect(transfer.z).toBeCloseTo(tier1.z - tier1.d / 2);
    expect(Math.abs(transfer.x - tier1.x)).toBeLessThan(tier1.w / 2);
    // There's an opening in the back wall where the door is.
    const backWalls = plan.walls.filter((w) => Math.abs(w.z - transfer.z) < 0.01 && w.d < 1);
    expect(backWalls.some((w) => Math.abs(w.x - transfer.x) < w.w / 2)).toBe(false);
    const mailbox = plan.fixtures.find((f) => f.kind === "mailbox")!;
    const room = plan.areas.find((a) => a.kind === "room" && Math.abs(a.x - mailbox.x) < a.w / 2 + 3 && mailbox.z > a.z + a.d / 2 && mailbox.z < a.z + a.d / 2 + 2)!;
    expect(room).toBeDefined();
  });

  test("the bot is a kiosk in front of its counter; overflow sits by its room's door", () => {
    const counter = plan.fixtures.find((f) => f.kind === "counter" && f.key === node("workstream", "Customer Service – Voice").key)!;
    const kiosk = plan.fixtures.find((f) => f.kind === "kiosk")!;
    expect(kiosk.z).toBeGreaterThan(counter.z);
    expect(plan.fixtures.filter((f) => ["mailbox", "booth", "transfer"].includes(f.kind)).map((f) => f.kind).sort()).toEqual(["booth", "mailbox", "mailbox", "transfer"]);
  });

  test("lines in a building only run straight along x or z, never diagonally", () => {
    plan.paths.filter((p) => p.kind !== "skybridge" && p.points.every((q) => q[1] < 1)).forEach((p) => {
      for (let i = 1; i < p.points.length; i++) {
        const [a, b] = [p.points[i - 1], p.points[i]];
        expect(Math.min(Math.abs(a[0] - b[0]), Math.abs(a[2] - b[2]))).toBeLessThan(0.01);
      }
    });
  });

  test("a front-row room is reached straight from the corridor; one further back over the nearer aisle", () => {
    const g = createCenter(defaultGrouping(graph), "Contoso", "contoso");
    let grouped = g;
    ["Retail Sales – Voice", "Technical Support – Voice", "Customer Service – Voice"].forEach((name) => { grouped = moveWorkstream(grouped, node("workstream", name).recordId!, "contoso", graph); });
    const p = buildPlan(graph, grouped);
    const rooms = p.areas.filter((a) => a.kind === "room" && a.centerId === "contoso");
    const front = Math.max(...rooms.map((r) => r.z + r.d / 2));
    p.paths.filter((path) => path.kind === "route").forEach((path) => {
      const door = path.points[path.points.length - 1];
      const room = rooms.find((r) => Math.abs(r.z + r.d / 2 - door[2]) < 0.01 && Math.abs(r.x - door[0]) < 0.01);
      if (!room) return;
      // In front: corridor, then straight to the door. Further back: never more than corridor, aisle, walkway, door.
      expect(path.points.length).toBeLessThanOrEqual(Math.abs(room.z + room.d / 2 - front) < 0.01 ? 4 : 6);
    });
  });

  test("routes in the same building keep to the corridor and aisles, never through a room; a shared queue gets a skybridge", () => {
    const routes = plan.paths.filter((p) => p.kind === "route" || p.kind === "default" || p.kind === "transfer").filter((p) => p.points.every((q) => q[1] < 1));
    expect(routes.length).toBeGreaterThan(0);
    const roomsHere = plan.areas.filter((a) => a.kind === "room");
    routes.forEach((p) => {
      // Every leg but the last (in at the door) stays out of every room.
      for (let i = 0; i < p.points.length - 2; i++) {
        const [a, b] = [p.points[i], p.points[i + 1]];
        for (let t = 0; t <= 1; t += 0.05) {
          const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
          const inside = roomsHere.find((r) => Math.abs(x - r.x) < r.w / 2 - 0.1 && Math.abs(z - r.z) < r.d / 2 - 0.1);
          expect(inside?.name ?? "outside").toBe("outside");
        }
      }
    });
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

describe("a customer center", () => {
  const plan = buildPlan(graph, contoso());
  const building = plan.buildings.find((b) => b.name === "Contoso")!;
  const inside = <T extends { x: number; z: number }>(items: T[]) => items.filter((i) => i.x >= building.x && i.x <= building.x + building.w && i.z <= building.z && i.z >= building.z - building.d);

  test("one front desk, with a counter per workstream", () => {
    expect(inside(plan.fixtures.filter((f) => f.kind === "reception"))).toHaveLength(1);
    expect(inside(plan.fixtures.filter((f) => f.kind === "counter"))).toHaveLength(5);
  });

  test("a wing per kind of work, side by side behind the reception, each with its own rooms", () => {
    expect(building.wings.map((w) => w.kind)).toEqual(["voice", "messaging"]);
    const [phone, chat] = building.wings;
    expect(phone.x + phone.w).toBeLessThan(chat.x);
    const rooms = plan.areas.filter((a) => a.kind === "room" && a.centerId === building.centerId);
    rooms.forEach((r) => {
      const wing = building.wings.find((w) => w.kind === r.wing)!;
      expect(r.x - r.w / 2).toBeGreaterThanOrEqual(wing.x - 0.01);
      expect(r.x + r.w / 2).toBeLessThanOrEqual(wing.x + wing.w + 0.01);
    });
    const reception = inside(plan.fixtures.filter((f) => f.kind === "reception"))[0];
    expect(Math.max(...rooms.map((r) => r.z + r.d / 2))).toBeLessThan(reception.z);
  });

  test("a wing's rooms are in a grid, not in one row", () => {
    const phoneRooms = plan.areas.filter((a) => a.kind === "room" && a.centerId === building.centerId && a.wing === "voice");
    const rows = new Set(phoneRooms.map((r) => Math.round(r.z + r.d / 2)));
    expect(rows.size).toBe(Math.ceil(phoneRooms.length / Math.ceil(Math.sqrt(phoneRooms.length))));
    expect(rows.size).toBeGreaterThan(1);
  });

  test("a center you made but haven't filled has no building yet", () => {
    const empty = buildPlan(graph, createCenter(defaultGrouping(graph), "Planned", "p"));
    expect(empty.buildings.some((b) => b.centerId === "p")).toBe(false);
  });

  test("hiding a workstream hides its counter, its signposts and rooms only it routes to", () => {
    const without = buildPlan(graph, setHidden(contoso(), node("workstream", "Dutch Desk – Voice").recordId!, true));
    expect(without.fixtures.some((f) => f.key === node("workstream", "Dutch Desk – Voice").key)).toBe(false);
    expect(without.areas.some((a) => a.kind === "room" && a.name === "Dutch Desk")).toBe(false);
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
