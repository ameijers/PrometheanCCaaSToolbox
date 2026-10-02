// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";

// The queue builder may only create queues (createRecord on "queue") and add members (a POST to a
// queue's queuemembership_association/$ref), and only from dataverse.ts. It never updates or deletes.

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("write scope", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "execute.ts", "payload.ts", "App.tsx"]));
  });

  test.each(files)("%s never updates or deletes", (file) => {
    ["updateRecord", "deleteRecord", "executeMultiple", "execute(", "DELETE", "PATCH"].forEach((token) => expect(read(file).includes(token)).toBe(false));
  });

  test("writes only happen in dataverse.ts", () => {
    expect(files.filter((f) => read(f).includes("createRecord"))).toEqual(["dataverse.ts"]);
    expect(files.filter((f) => /\bfetch\(/.test(read(f)))).toEqual(["dataverse.ts"]);
  });

  test("createRecord only creates queues, and the only fetch is the membership $ref POST", () => {
    const dv = read("dataverse.ts");
    expect([...dv.matchAll(/createRecord\(([^,]+),/g)].map((m) => m[1].trim())).toEqual(["QUEUE_TABLE"]);
    expect([...dv.matchAll(/\bfetch\(([^,]+),/g)].map((m) => m[1].trim())).toEqual(["`${base}/api/data/v9.2/${QUEUE_ENTITY_SET}(${queueId})/${MEMBERSHIP_RELATIONSHIP}/$ref`"]);
    expect([...dv.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1])).toEqual(["POST"]);
  });
});
