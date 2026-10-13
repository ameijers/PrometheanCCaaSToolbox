// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { CREATE_COLUMNS, ENTITY_SETS, UPDATE_COLUMNS } from "../src/schema";

// The copier may only write from dataverse.ts: it creates rulesets, assignment methods and their
// steps, and updates a method's active switch and a queue's assignment method. It never deletes, and
// it never writes a queue's other columns or a decision contract.

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("write scope", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "apply.ts", "plan.ts", "App.tsx", "demoData.ts"]));
  });

  test.each(files)("%s never deletes, and doesn't use Xrm.WebApi writes or execute", (file) => {
    const contents = read(file);
    [".createRecord(", ".updateRecord(", "deleteRecord", "executeMultiple", "execute(", "XMLHttpRequest", "\"DELETE\"", "\"PUT\""].forEach((token) => expect(contents.includes(token)).toBe(false));
  });

  test("the Web API is only called from dataverse.ts: one fetch, reached by one guarded POST and one guarded PATCH", () => {
    expect(files.filter((f) => /\bfetch\(/.test(read(f)))).toEqual(["dataverse.ts"]);
    const dataverse = read("dataverse.ts");
    expect(dataverse.match(/\bfetch\(/g)).toHaveLength(1);
    expect(dataverse).toMatch(/async function send\(method: "POST" \| "PATCH", /);
    expect(dataverse.match(/\bsend\(/g)).toHaveLength(3); // the function and its two callers
    expect(dataverse).toMatch(/guard\("create", CREATE_COLUMNS, table, payload\);\s+const response = await send\("POST", ENTITY_SETS\[table\], payload\);/);
    expect(dataverse).toMatch(/guard\("update", UPDATE_COLUMNS, table, columns\);\s+if \(!GUID\.test\(recordId\)\) throw [^\n]+\s+if \(!Object\.keys\(columns\)\.length\) return;\s+await send\("PATCH", `\$\{ENTITY_SETS\[table\]\}\(\$\{recordId\}\)`, columns\);/);
    expect(ENTITY_SETS).toEqual({ queue: "queues", msdyn_assignmentconfiguration: "msdyn_assignmentconfigurations", msdyn_assignmentconfigurationstep: "msdyn_assignmentconfigurationsteps", msdyn_decisionruleset: "msdyn_decisionrulesets" });
  });

  test("the tables and columns that can be created are exactly these", () => {
    expect(CREATE_COLUMNS).toEqual({
      msdyn_decisionruleset: [
        "msdyn_name", "msdyn_uniquename", "msdyn_description", "msdyn_rulesetdefinition", "msdyn_rulesettype", "msdyn_authoringmode", "msdyn_isinputcollection",
        "msdyn_persistoutputdata", "msdyn_refreshinputdata", "msdyn_disabledrules", "msdyn_inputcontractid@odata.bind", "msdyn_outputcontractid@odata.bind"
      ],
      msdyn_assignmentconfiguration: ["msdyn_name", "msdyn_uniquename", "msdyn_description", "msdyn_isactiveconfiguration", "msdyn_queueid@odata.bind"],
      msdyn_assignmentconfigurationstep: ["msdyn_name", "msdyn_uniquename", "msdyn_type", "msdyn_steporder", "msdyn_isdefaultruleset", "msdyn_assignmentconfigurationid@odata.bind", "msdyn_rulesetid@odata.bind"]
    });
  });

  test("the only updates are a method's active switch and a queue's assignment method", () => {
    expect(UPDATE_COLUMNS).toEqual({ msdyn_assignmentconfiguration: ["msdyn_isactiveconfiguration"], queue: ["msdyn_assignmentstrategy"] });
  });
});
