// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph } from "../src/graph";
import { demoRaw } from "../src/demoData";
import { computeLayout, LAYER_SPACING } from "../src/layout";
import { KINDS } from "../src/model";

describe("computeLayout", () => {
  const graph = buildGraph(demoRaw());
  const positions = computeLayout(graph);

  test("places every node", () => {
    expect(positions.size).toBe(graph.nodes.length);
    positions.forEach((p) => p.forEach((v) => expect(Number.isFinite(v)).toBe(true)));
  });

  test("puts each kind on its own depth layer, front to back in call-flow order", () => {
    graph.nodes.forEach((n) => {
      const z = positions.get(n.key)![2];
      expect(Math.abs(z - KINDS[n.kind].layer * LAYER_SPACING)).toBeLessThanOrEqual(5);
    });
  });

  test("gives the same picture every time", () => {
    expect([...computeLayout(buildGraph(demoRaw())).entries()]).toEqual([...positions.entries()]);
  });

  test("keeps nodes on the same layer apart", () => {
    const workstreams = graph.nodes.filter((n) => n.kind === "workstream").map((n) => positions.get(n.key)!);
    for (let i = 0; i < workstreams.length; i++) {
      for (let j = i + 1; j < workstreams.length; j++) {
        expect(Math.hypot(workstreams[i][0] - workstreams[j][0], workstreams[i][1] - workstreams[j][1])).toBeGreaterThan(4);
      }
    }
  });
});
