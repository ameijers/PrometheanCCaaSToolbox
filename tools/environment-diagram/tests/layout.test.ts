// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph } from "../../environment-3d-explorer/src/graph";
import { demoRaw } from "../../environment-3d-explorer/src/demoData";
import { extendRide } from "../../environment-3d-explorer/src/ride";
import { plannedRide } from "../../environment-3d-explorer/src/tour";
import { KINDS, NodeKind } from "../../environment-3d-explorer/src/model";
import { computeDiagram, fit, orthogonal, pointAt, polylineLength, routePoints, Shape } from "../src/layout";

const graph = buildGraph(demoRaw());
const firstHidden = new Set((Object.keys(KINDS) as NodeKind[]).filter((k) => KINDS[k].hiddenAtFirst));
const overlaps = (a: Shape, b: Shape) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const keyOf = (kind: string, name: string) => graph.nodes.find((n) => n.kind === kind && n.name === name)!.key;

describe("Environment Diagram layout", () => {
  const d = computeDiagram(graph, { hidden: firstHidden });

  test("every workstream and queue is a container", () => {
    graph.nodes.filter((n) => n.kind === "workstream" || n.kind === "queue").forEach((n) => {
      const ids = d.byNode.get(n.key) ?? [];
      expect(ids.map((id) => d.shapeById.get(id)!.role)).toContain("container");
    });
  });

  test("containers in one swimlane never overlap", () => {
    const containers = d.shapes.filter((s) => s.role === "container" && (s.kind === "workstream" || s.kind === "queue"));
    containers.forEach((a, i) => containers.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
  });

  test("rows and tags sit inside their container", () => {
    d.shapes.filter((s) => s.parent).forEach((s) => {
      const p = d.shapeById.get(s.parent!)!;
      expect(s.x).toBeGreaterThanOrEqual(p.x);
      expect(s.y).toBeGreaterThanOrEqual(p.y);
      expect(s.x + s.w).toBeLessThanOrEqual(p.x + p.w + 0.01);
      expect(s.y + s.h).toBeLessThanOrEqual(p.y + p.h + 0.01);
    });
  });

  test("routing rules are drawn in their order, and every rule -> queue edge has a line", () => {
    const ws = keyOf("workstream", "Customer Service – Voice");
    const rows = d.shapes.filter((s) => s.parent === `ws|${ws}` && s.kind === "rule");
    expect(rows.map((r) => r.label)).toEqual(["1. Billing", "2. Returns", "3. Technical", "4. Complaints"]);
    expect([...rows].sort((a, b) => a.y - b.y)).toEqual(rows);
    const ruleEdges = graph.edges.filter((e) => e.kind === "routes" && e.from.startsWith("rule:"));
    ruleEdges.forEach((e) => expect(d.connectors.some((c) => c.from === e.from && c.to === e.to)).toBe(true));
  });

  test("lines are right-angled", () => {
    d.connectors.forEach((c) => c.points.slice(1).forEach((p, i) => {
      const q = c.points[i];
      expect(p[0] === q[0] || p[1] === q[1]).toBe(true);
    }));
  });

  test("an agent in several queues is drawn in each", () => {
    const counts = new Map<string, number>();
    graph.edges.filter((e) => e.kind === "member").forEach((e) => counts.set(e.to, (counts.get(e.to) ?? 0) + 1));
    const [agent, n] = [...counts.entries()].find(([, c]) => c > 1)!;
    expect(d.byNode.get(agent)).toHaveLength(n);
  });

  test("hidden kinds take no room, and hiding rules points workstreams straight at queues", () => {
    const bare = computeDiagram(graph, { hidden: new Set<NodeKind>([...firstHidden, "rule", "agent", "phone", "channel", "overflow"]) });
    expect(bare.shapes.some((s) => ["rule", "agent", "phone", "channel", "overflow"].includes(s.kind))).toBe(false);
    expect(bare.lanes.map((l) => l.title)).toEqual(["Workstreams & routing", "Queues & agents"]);
    expect(bare.connectors.some((c) => c.from.startsWith("workstream:") && c.to.startsWith("queue:") && c.kind === "routes")).toBe(true);
    expect(bare.width).toBeLessThan(d.width);
  });

  test("spacing pulls the swimlanes apart", () => {
    expect(computeDiagram(graph, { hidden: firstHidden, spacing: 2 }).width).toBeGreaterThan(d.width);
  });

  test("only what's visible is drawn", () => {
    const ws = keyOf("workstream", "Dutch Desk – Voice");
    const only = computeDiagram(graph, { hidden: firstHidden, visible: (k) => k === ws });
    // Its default queue isn't visible, so neither is its "default queue" row.
    expect(only.shapes.filter((s) => s.nodeKey).map((s) => s.nodeKey)).toEqual([ws]);
    expect(only.connectors).toEqual([]);
  });

  test("customer centers group their workstreams in a container", () => {
    const a = graph.nodes.find((n) => n.name === "Retail Sales – Voice")!.recordId!;
    const b = graph.nodes.find((n) => n.name === "Customer Service – Voice")!.recordId!;
    const grouped = computeDiagram(graph, { hidden: firstHidden, centers: [{ id: "c1", name: "Contoso", color: "#38bdf8", workstreams: [a, b], custom: true }] });
    const frame = grouped.shapeById.get("center|c1")!;
    expect(frame.label).toBe("Contoso");
    [a, b].forEach((id) => {
      const ws = grouped.shapeById.get(`ws|workstream:${id}`)!;
      expect(ws.y).toBeGreaterThan(frame.y);
      expect(ws.y + ws.h).toBeLessThanOrEqual(frame.y + frame.h);
    });
  });

  test("follow the call: a route becomes one line from the phone number to the agent", () => {
    const channel = keyOf("channel", "Customer Service channel");
    const phone = graph.edges.find((e) => e.kind === "number" && e.to === channel)!.from;
    const ride = plannedRide(graph, phone, ["Customer Service channel", "Customer Service – Voice", "Billing", "Julia de Vries"]);
    const points = routePoints(d, ride.path);
    expect(points.length).toBeGreaterThan(5);
    const agent = d.shapeById.get(d.byNode.get(ride.path[ride.path.length - 1])!.find((id) => id.startsWith("ag|"))!)!;
    const end = points[points.length - 1];
    expect(end[1]).toBeGreaterThanOrEqual(agent.y);
    expect(end[1]).toBeLessThanOrEqual(agent.y + agent.h);
    expect(polylineLength(points)).toBeGreaterThan(400);
    expect(extendRide(graph, [phone]).path.length).toBeGreaterThan(1);
  });

  test("helpers", () => {
    expect(orthogonal([0, 0], [10, 0], 5)).toEqual([[0, 0], [10, 0]]);
    expect(orthogonal([0, 0], [10, 10], 5)).toEqual([[0, 0], [5, 0], [5, 10], [10, 10]]);
    expect(pointAt([[0, 0], [10, 0], [10, 10]], 15)).toEqual([10, 5]);
    expect(fit("Customer Service – Voice", 60)).toMatch(/…$/);
    expect(fit("Short", 200)).toBe("Short");
  });
});
