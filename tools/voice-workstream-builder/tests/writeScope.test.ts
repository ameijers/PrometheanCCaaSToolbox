import * as fs from "fs";
import * as path from "path";
import { CREATABLE_TABLES } from "../src/dataSource";
import { TABLES } from "../src/voiceSchema";

// This tool writes, so the guard is narrower than the read-only tools' one rather than absent: it may
// only create, only from dataverse.ts, and only in the five tables that make up a voice workstream.
// It never updates or deletes anything, so it can't change or remove existing configuration.

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("write scope", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "execute.ts", "payload.ts", "App.tsx"]));
  });

  test.each(files)("%s never updates or deletes, and doesn't use fetch", (file) => {
    const contents = read(file);
    ["updateRecord", "deleteRecord", "executeMultiple", "execute(", "fetch("].forEach((token) => expect(contents.includes(token)).toBe(false));
  });

  test("createRecord is only called from dataverse.ts", () => {
    expect(files.filter((f) => read(f).includes("createRecord"))).toEqual(["dataverse.ts"]);
  });

  test("the creatable tables are exactly the records that make up a voice workstream", () => {
    expect(CREATABLE_TABLES.map((t) => TABLES[t].logicalName)).toEqual([
      "msdyn_liveworkstream", "msdyn_liveworkstreamcapacityprofile", "msdyn_ocvoicechannelsetting", "msdyn_ocvoice", "msdyn_ocvoicechannellanguagesetting"
    ]);
  });
});
