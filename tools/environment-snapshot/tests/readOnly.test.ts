// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";

// The snapshot tool only reads. Nothing in src/ may write to Dataverse, and the Web API is only called
// from dataverse.ts, with GET.

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("read only", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "snapshot.ts", "App.tsx", "demoData.ts"]));
  });

  test.each(files)("%s makes no writes", (file) => {
    const contents = read(file);
    [".createRecord(", ".updateRecord(", ".deleteRecord(", "execute(", "executeMultiple", "XMLHttpRequest", "\"POST\"", "\"PATCH\"", "\"PUT\"", "\"DELETE\""]
      .forEach((token) => expect(contents.includes(token)).toBe(false));
  });

  test("the Web API is only fetched from dataverse.ts, with GET", () => {
    expect(files.filter((f) => /\bfetch\(/.test(read(f)))).toEqual(["dataverse.ts"]);
    const dataverse = read("dataverse.ts");
    expect(dataverse.match(/\bfetch\(/g)).toHaveLength(1);
    expect(dataverse).toMatch(/method: "GET"/);
    expect(dataverse.match(/method:/g)).toHaveLength(1);
  });
});
