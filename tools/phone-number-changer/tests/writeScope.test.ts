// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { WRITABLE } from "../src/dataverse";

// The tool may only update, only from dataverse.ts, only msdyn_ocvoicechannelsetting, and only its
// phone number and caller ID lookups. It never creates or deletes, and never writes to the numbers.

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("write scope", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "apply.ts", "plan.ts", "App.tsx"]));
  });

  test.each(files)("%s never creates or deletes, and doesn't use fetch", (file) => {
    const contents = read(file);
    ["createRecord", "deleteRecord", "executeMultiple", "execute(", "fetch(", "XMLHttpRequest"].forEach((token) => expect(contents.includes(token)).toBe(false));
  });

  test("updateRecord is only called from dataverse.ts, and only on the voice channel table", () => {
    expect(files.filter((f) => read(f).includes("updateRecord"))).toEqual(["dataverse.ts"]);
    const calls = [...read("dataverse.ts").matchAll(/updateRecord\(([^,]+),/g)].map((m) => m[1].trim());
    expect(calls).toEqual(["CHANNEL_TABLE"]);
    expect(read("dataverse.ts")).toMatch(/const CHANNEL_TABLE = "msdyn_ocvoicechannelsetting";/);
  });

  test("the writable columns are exactly the phone number and caller ID lookups", () => {
    expect(Object.values(WRITABLE).sort()).toEqual(["msdyn_calleridphonenumberid", "msdyn_phonenumberid"]);
  });
});
