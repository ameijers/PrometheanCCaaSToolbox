// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { loadGraph } from "../src/dataverse";

// This tool only looks. Statically: no source file names a write method or calls fetch.
// At runtime: loading the environment only ever calls retrieveMultipleRecords.
const FORBIDDEN = ["createRecord", "updateRecord", "deleteRecord", "executeMultiple", "execute(", "fetch(", "XMLHttpRequest"];

describe("read-only guarantee", () => {
  const srcDir = path.resolve(__dirname, "../src");
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

  test("scanned the source files", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "graph.ts", "Scene.tsx", "App.tsx"]));
  });

  test.each(files)("%s contains no write call", (file) => {
    const contents = fs.readFileSync(path.join(srcDir, file), "utf8");
    FORBIDDEN.forEach((word) => expect(contents.includes(word)).toBe(false));
  });

  test("loading the environment only reads", async () => {
    const reads: string[] = [];
    const webApi = new Proxy({}, {
      get: (_, method: string) => method === "retrieveMultipleRecords"
        ? async (table: string, query: string) => { reads.push(`${table}${query}`); return { entities: [] }; }
        : () => { throw new Error(`Unexpected Xrm.WebApi.${method}`); }
    });
    (global as any).Xrm = { WebApi: webApi };
    try {
      const graph = await loadGraph();
      expect(graph.nodes).toEqual([]);
      expect(reads.map((r) => r.split("?")[0]).sort()).toEqual([
        "msdyn_liveworkstream", "msdyn_ocphonenumber", "msdyn_ocvoicechannelsetting", "msdyn_routingconfiguration",
        "msdyn_routingconfigurationstep", "queue", "queuemembership", "systemuser"
      ]);
    } finally {
      delete (global as any).Xrm;
    }
  });
});
