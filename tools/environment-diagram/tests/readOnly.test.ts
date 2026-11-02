// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { loadViews, storeViews } from "../src/views";

// The diagram only reads: it uses the 3D Explorer's read-only data layer and writes nothing itself.
describe("Environment Diagram is read-only", () => {
  const dir = path.resolve(__dirname, "../src");
  const files = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f));

  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["App.tsx", "Diagram.tsx", "layout.ts"]));
  });

  test.each(files)("%s has no write calls", (file) => {
    const code = fs.readFileSync(path.join(dir, file), "utf8");
    expect(code).not.toMatch(/createRecord|updateRecord|deleteRecord|execute\(|"POST"|"PATCH"|"DELETE"/);
  });

  test("it reads the environment through the 3D Explorer's read-only data layer", () => {
    const app = fs.readFileSync(path.join(dir, "App.tsx"), "utf8");
    expect(app).toMatch(/from "\.\.\/\.\.\/environment-3d-explorer\/src\/dataverse"/);
  });
});

describe("saved views", () => {
  test("round trip, and bad entries are dropped", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    storeViews("env", [{ name: "Queues", x: 10, y: -20, k: 0.5 }], storage);
    expect(loadViews("env", storage)).toEqual([{ name: "Queues", x: 10, y: -20, k: 0.5 }]);
    store.set("pct.diagram2d.views.env", JSON.stringify([{ name: "Bad", x: 1, y: 1, k: 0 }, { name: 3 }]));
    expect(loadViews("env", storage)).toEqual([]);
    expect(loadViews("other", storage)).toEqual([]);
  });
});
