// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph } from "../../environment-3d-explorer/src/graph";
import { demoRaw } from "../../environment-3d-explorer/src/demoData";
import { combine, defaultGrouping, moveWorkstream, recolor, reconcile, rename, split } from "../src/centers";
import { browserStore } from "../src/store";

const graph = buildGraph(demoRaw());
const workstreamCount = graph.nodes.filter((n) => n.kind === "workstream").length;
const idOf = (name: string) => graph.nodes.find((n) => n.kind === "workstream" && n.name === name)!.recordId!;

describe("customer centers", () => {
  test("every workstream starts as a center of its own, each with its own colour", () => {
    const g = defaultGrouping(graph);
    expect(g.centers).toHaveLength(workstreamCount);
    expect(g.centers.every((c) => c.workstreams.length === 1)).toBe(true);
    expect(new Set(g.centers.map((c) => c.color)).size).toBe(g.centers.length);
  });

  test("combine puts several centers' workstreams into one, under a new name; split undoes it", () => {
    const g = defaultGrouping(graph);
    const [a, b, c] = g.centers;
    const combined = combine(g, [a.id, b.id, c.id], "Contoso Service Center");
    expect(combined.centers).toHaveLength(workstreamCount - 2);
    const center = combined.centers.find((x) => x.id === a.id)!;
    expect(center.name).toBe("Contoso Service Center");
    expect(center.workstreams).toEqual([...a.workstreams, ...b.workstreams, ...c.workstreams]);
    expect(combine(g, [a.id], "x")).toBe(g);

    const apart = split(combined, a.id, graph);
    expect(apart.centers).toHaveLength(workstreamCount);
    expect(apart.centers.every((x) => x.workstreams.length === 1)).toBe(true);
  });

  test("a workstream moves to another center or to one of its own; an emptied center goes", () => {
    const g = defaultGrouping(graph);
    const [a, b] = g.centers;
    const moved = moveWorkstream(g, a.workstreams[0], b.id, graph);
    expect(moved.centers.find((c) => c.id === a.id)).toBeUndefined();
    expect(moved.centers.find((c) => c.id === b.id)!.workstreams).toEqual([...b.workstreams, ...a.workstreams]);
    const back = moveWorkstream(moved, a.workstreams[0], "new", graph);
    expect(back.centers).toHaveLength(workstreamCount);
    expect(new Set(back.centers.map((c) => c.id)).size).toBe(back.centers.length);
  });

  test("rename and recolor change one center; an empty name is ignored", () => {
    const g = defaultGrouping(graph);
    const id = g.centers[0].id;
    expect(rename(g, id, "  Retail  ").centers[0].name).toBe("Retail");
    expect(rename(g, id, " ")).toBe(g);
    expect(recolor(g, id, "#000000").centers[0].color).toBe("#000000");
  });

  test("a saved grouping is matched to today's environment", () => {
    const sales = idOf("Retail Sales – Voice"), service = idOf("Customer Service – Voice");
    const saved = { version: 1 as const, centers: [
      { id: "c1", name: "Contoso", color: "#111111", workstreams: [sales, service, "gone-workstream"] },
      { id: "c2", name: "Empty now", color: "#222222", workstreams: ["also-gone"] },
      { id: "c3", name: "Duplicate", color: "#333333", workstreams: [sales] }
    ] };
    const g = reconcile(saved, graph);
    expect(g.centers[0]).toEqual({ id: "c1", name: "Contoso", color: "#111111", workstreams: [sales, service] });
    expect(g.centers.some((c) => c.id === "c2" || c.id === "c3")).toBe(false);
    expect(g.centers).toHaveLength(workstreamCount - 1);
    expect(reconcile({ version: 2 } as any, graph).centers).toHaveLength(workstreamCount);
  });
});

describe("browser store", () => {
  test("remembers a grouping per environment and survives blocked or damaged storage", async () => {
    const data = new Map<string, string>();
    const store = browserStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } });
    const g = defaultGrouping(graph);
    await store.save("org-a", g);
    expect(await store.load("org-a")).toEqual(g);
    expect(await store.load("org-b")).toBeUndefined();
    data.set("pct.contactcenter3d.centers.org-c", "{not json");
    expect(await store.load("org-c")).toBeUndefined();
    const blocked = browserStore({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    await expect(blocked.save("org", g)).resolves.toBeUndefined();
    expect(await blocked.load("org")).toBeUndefined();
  });
});
