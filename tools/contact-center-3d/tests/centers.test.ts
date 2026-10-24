// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph } from "../../environment-3d-explorer/src/graph";
import { demoRaw } from "../../environment-3d-explorer/src/demoData";
import { createCenter, defaultGrouping, deleteCenter, moveWorkstream, recolor, reconcile, rename, setHidden } from "../src/centers";
import { browserStore } from "../src/store";

const graph = buildGraph(demoRaw());
const workstreamCount = graph.nodes.filter((n) => n.kind === "workstream").length;
const idOf = (name: string) => graph.nodes.find((n) => n.kind === "workstream" && n.name === name)!.recordId!;

describe("customer centers", () => {
  test("at first no customer centers: every workstream is a building of its own, each its own colour", () => {
    const g = defaultGrouping(graph);
    expect(g.centers).toHaveLength(workstreamCount);
    expect(g.centers.every((c) => c.workstreams.length === 1 && !c.custom)).toBe(true);
    expect(new Set(g.centers.map((c) => c.color)).size).toBe(g.centers.length);
  });

  test("create a center, then move workstreams into it; the buildings they had go", () => {
    let g = createCenter(defaultGrouping(graph), "  Contoso Service Center ", "c1");
    expect(g.centers[0]).toMatchObject({ id: "c1", name: "Contoso Service Center", workstreams: [], custom: true });
    expect(createCenter(g, "  ")).toBe(g);
    g = moveWorkstream(g, idOf("Retail Sales – Voice"), "c1", graph);
    g = moveWorkstream(g, idOf("Customer Service – Voice"), "c1", graph);
    expect(g.centers.find((c) => c.id === "c1")!.workstreams).toEqual([idOf("Retail Sales – Voice"), idOf("Customer Service – Voice")]);
    expect(g.centers).toHaveLength(workstreamCount - 2 + 1);
  });

  test("a center you made stays when empty; moving a workstream out gives it its own building again", () => {
    let g = moveWorkstream(createCenter(defaultGrouping(graph), "Sales", "c1"), idOf("Retail Sales – Voice"), "c1", graph);
    g = moveWorkstream(g, idOf("Retail Sales – Voice"), "own", graph);
    expect(g.centers.find((c) => c.id === "c1")!.workstreams).toEqual([]);
    expect(g.centers.filter((c) => c.workstreams.includes(idOf("Retail Sales – Voice")))).toHaveLength(1);
    expect(g.centers).toHaveLength(workstreamCount + 1);
    // A workstream in its own building can't move "out".
    expect(moveWorkstream(g, idOf("Retail Sales – Voice"), "own", graph)).toBe(g);
  });

  test("moving between two centers you made", () => {
    let g = createCenter(createCenter(defaultGrouping(graph), "A", "a"), "B", "b");
    g = moveWorkstream(g, idOf("Web Chat"), "a", graph);
    g = moveWorkstream(g, idOf("Web Chat"), "b", graph);
    expect(g.centers.find((c) => c.id === "a")!.workstreams).toEqual([]);
    expect(g.centers.find((c) => c.id === "b")!.workstreams).toEqual([idOf("Web Chat")]);
  });

  test("deleting a center gives its workstreams their own buildings back; only centers you made can go", () => {
    let g = createCenter(defaultGrouping(graph), "Contoso", "c1");
    g = moveWorkstream(moveWorkstream(g, idOf("Web Chat"), "c1", graph), idOf("WhatsApp"), "c1", graph);
    const after = deleteCenter(g, "c1", graph);
    expect(after.centers.some((c) => c.id === "c1")).toBe(false);
    expect(after.centers).toHaveLength(workstreamCount);
    expect(after.centers.every((c) => c.workstreams.length === 1)).toBe(true);
    expect(deleteCenter(after, after.centers[0].id, graph)).toBe(after);
  });

  test("rename, recolor and hide; an empty name is ignored", () => {
    const g = defaultGrouping(graph);
    const id = g.centers[0].id;
    expect(rename(g, id, "  Retail  ").centers[0].name).toBe("Retail");
    expect(rename(g, id, " ")).toBe(g);
    expect(recolor(g, id, "#000000").centers[0].color).toBe("#000000");
    expect(setHidden(setHidden(g, "x", true), "x", false).hidden).toEqual(g.hidden);
  });

  test("a saved grouping is matched to today's environment, and empty centers you made are kept", () => {
    const sales = idOf("Retail Sales – Voice"), service = idOf("Customer Service – Voice");
    const saved = { version: 1 as const, centers: [
      { id: "c1", name: "Contoso", color: "#111111", workstreams: [sales, service, "gone-workstream"], custom: true },
      { id: "c2", name: "Planned", color: "#222222", workstreams: [], custom: true },
      { id: "c3", name: "Old own building", color: "#333333", workstreams: ["also-gone"] },
      // Saved before centers could be made: more than one workstream means it was the viewer's.
      { id: "c4", name: "Combined before", color: "#444444", workstreams: [idOf("Web Chat"), idOf("WhatsApp")] }
    ] };
    const g = reconcile(saved, graph);
    expect(g.centers[0]).toEqual({ id: "c1", name: "Contoso", color: "#111111", workstreams: [sales, service], custom: true });
    expect(g.centers[1]).toMatchObject({ id: "c2", workstreams: [], custom: true });
    expect(g.centers.some((c) => c.id === "c3")).toBe(false);
    expect(g.centers.find((c) => c.id === "c4")!.custom).toBe(true);
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
