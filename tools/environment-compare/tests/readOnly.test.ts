// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";

// The compare tool only reads: it reads snapshot files, and takes a snapshot of its own environment
// with Environment Snapshot's read-only reader. Nothing in src/ writes or calls the Web API itself.

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("read only", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["App.tsx", "compare.ts", "demoData.ts"]));
  });

  test.each(files)("%s makes no writes and no Web API calls of its own", (file) => {
    const contents = read(file);
    [".createRecord(", ".updateRecord(", ".deleteRecord(", "execute(", "fetch(", "XMLHttpRequest", "\"POST\"", "\"PATCH\"", "\"DELETE\""]
      .forEach((token) => expect(contents.includes(token)).toBe(false));
  });

  test("the environment is read through Environment Snapshot's read-only reader only", () => {
    const app = read("App.tsx");
    expect(app).toContain("from \"../../environment-snapshot/src/dataverse\"");
    expect(app.match(/dataverseSource/g)).toHaveLength(2); // the import and the one read
  });
});
