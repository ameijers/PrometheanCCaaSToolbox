// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";

// Voice Channel Builder never writes itself: every create goes through Voice Workstream Builder's
// dataverse.ts, whose runtime allowlist and own writeScope test limit it to creating voice records,
// and plan.ts's addChannels only runs when every workstream already exists (tests/plan.test.ts).

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("write scope", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["App.tsx", "plan.ts", "template.ts"]));
  });

  test.each(files)("%s contains no Dataverse call of its own", (file) => {
    ["createRecord", "updateRecord", "deleteRecord", "retrieveMultipleRecords", "executeMultiple", "execute(", "fetch(", "Xrm"].forEach((token) => expect(read(file).includes(token)).toBe(false));
  });

  test("the only data layer used is Voice Workstream Builder's", () => {
    const imports = files.flatMap((f) => [...read(f).matchAll(/from "([^"]*(dataverse|demoData))"/g)].map((m) => m[1]));
    expect([...new Set(imports)].sort()).toEqual(["../../voice-workstream-builder/src/dataverse", "../../voice-workstream-builder/src/demoData"]);
  });

  test("the app creates only through addChannels, never the create engine directly", () => {
    expect(read("App.tsx")).not.toMatch(/executePlan/);
    expect(read("App.tsx")).toMatch(/addChannels\(/);
  });
});
