import * as fs from "fs";
import * as path from "path";

// This tool must never create, update or delete anything — it only recommends. A blunt static
// guard, same as Agent Readiness Checker's: fail on the mere presence of an Xrm.WebApi write method
// anywhere in src/, and on any HTTP method other than GET in a fetch call.
const FORBIDDEN = ["createRecord", "updateRecord", "deleteRecord", "executeMultiple", "execute("];

describe("read-only guarantee", () => {
  const srcDir = path.resolve(__dirname, "../src");
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "scan.ts", "engine.ts", "rules.ts", "App.tsx"]));
  });

  test.each(files)("%s contains no Dataverse write call", (file) => {
    const contents = fs.readFileSync(path.join(srcDir, file), "utf8");
    FORBIDDEN.forEach((method) => expect(contents.includes(method)).toBe(false));
    const methods = [...contents.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    methods.forEach((method) => expect(method).toBe("GET"));
  });

  test("the only fetch call in the tool is the GET in dataverse.ts", () => {
    const withFetch = files.filter((f) => /\bfetch\(/.test(fs.readFileSync(path.join(srcDir, f), "utf8")));
    expect(withFetch).toEqual(["dataverse.ts"]);
    expect(fs.readFileSync(path.join(srcDir, "dataverse.ts"), "utf8")).toMatch(/method: "GET"/);
  });
});
