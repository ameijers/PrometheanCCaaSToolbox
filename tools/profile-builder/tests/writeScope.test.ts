import * as fs from "fs";
import * as path from "path";

// Profile Builder never writes itself: every create goes through Voice Workstream Builder's
// dataverse.ts, whose runtime allowlist and own writeScope test limit it to creating the five records
// a voice workstream is made of. This guard makes sure that stays true here.

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
});
