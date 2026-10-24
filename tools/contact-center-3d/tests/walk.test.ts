// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph } from "../../environment-3d-explorer/src/graph";
import { demoRaw } from "../../environment-3d-explorer/src/demoData";
import { extendRide } from "../../environment-3d-explorer/src/ride";
import { defaultGrouping } from "../src/centers";
import { buildPlan } from "../src/floorplan";
import { walkRoute } from "../src/walk";

const graph = buildGraph(demoRaw());
const plan = buildPlan(graph, defaultGrouping(graph));
const node = (kind: string, name: string) => graph.nodes.find((n) => n.kind === kind && n.name === name)!;

describe("walkRoute", () => {
  const rule = node("rule", "Billing").key;
  const queue = node("queue", "Billing").key;
  const route = walkRoute(plan, [node("workstream", "Customer Service – Voice").key, rule, queue]);
  const door = plan.doors.get(queue)!;
  const seats = plan.chairs.get(queue)!;

  test("ends waiting in front of the room's bench, not in the middle of the room", () => {
    const end = route[route.length - 1];
    expect(end[0]).toBeCloseTo((seats[0][0] + seats[3][0]) / 2);
    expect(Math.abs(end[2] - seats[0][2])).toBeLessThan(1.5);
    const middle = plan.anchors.get(queue)!;
    expect(Math.hypot(end[0] - middle[0], end[2] - middle[2])).toBeGreaterThan(2);
  });

  test("gets there along the line on the floor and in through the front door", () => {
    const line = plan.paths.find((p) => p.key === rule && p.points[p.points.length - 1][0] === door[0])!;
    line.points.slice(1).forEach((q) => expect(route.some((r) => Math.abs(r[0] - q[0]) < 0.05 && Math.abs(r[2] - q[2]) < 0.05)).toBe(true));
    expect(route.some((r) => Math.abs(r[0] - door[0]) < 0.05 && Math.abs(r[2] - door[2]) < 0.05)).toBe(true);
    // At walking height, every step on the floor along x or z.
    route.forEach((r) => expect(r[1]).toBeCloseTo(1.2));
  });

  test("goes on from the bench to the agent's desk in that room", () => {
    const agent = graph.edges.find((e) => e.kind === "member" && e.from === queue)!.to;
    const withDesk = walkRoute(plan, [node("workstream", "Customer Service – Voice").key, rule, queue, agent]);
    const desk = plan.desks.get(`${queue}|${agent}`)!;
    const end = withDesk[withDesk.length - 1];
    expect([end[0], end[2]]).toEqual([desk[0], desk[2]]);
  });

  test("a ride from an agent starts at the desk that was clicked", () => {
    const twice = graph.nodes.find((n) => n.kind === "agent" && graph.edges.filter((e) => e.kind === "member" && e.to === n.key).length > 1)!;
    const rooms = graph.edges.filter((e) => e.kind === "member" && e.to === twice.key).map((e) => e.from);
    const second = plan.desks.get(`${rooms[1]}|${twice.key}`)!;
    expect(walkRoute(plan, [twice.key], second)[0]).toEqual([second[0], 1.2, second[2]]);
    expect(plan.desks.get(`${rooms[0]}|${twice.key}`)).not.toEqual(second);
  });

  test("a full ride from a phone number walks from the entrance to the bench", () => {
    const start = graph.nodes.find((n) => n.kind === "phone" && plan.anchors.has(n.key))!.key;
    const { path } = extendRide(graph, [start]);
    expect(walkRoute(plan, path).length).toBeGreaterThanOrEqual(path.length);
  });
});
