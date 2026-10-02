import * as fs from "fs";
import * as path from "path";

// The business unit builder may only create business units (createRecord on "businessunit"), and only
// from dataverse.ts. It never updates, disables or deletes anything, and doesn't use fetch.

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("write scope", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "execute.ts", "plan.ts", "App.tsx"]));
  });

  test.each(files)("%s never updates, disables or deletes, and doesn't use fetch", (file) => {
    ["updateRecord", "deleteRecord", "executeMultiple", "execute(", "fetch(", "SetState", "isdisabled:"].forEach((token) => expect(read(file).includes(token)).toBe(false));
  });

  test("createRecord is only called from dataverse.ts, and only on businessunit", () => {
    expect(files.filter((f) => read(f).includes("createRecord"))).toEqual(["dataverse.ts"]);
    expect([...read("dataverse.ts").matchAll(/createRecord\(([^,]+),/g)].map((m) => m[1].trim())).toEqual(["UNIT_TABLE"]);
    expect(read("dataSource.ts")).toMatch(/export const UNIT_TABLE = "businessunit";/);
  });
});
