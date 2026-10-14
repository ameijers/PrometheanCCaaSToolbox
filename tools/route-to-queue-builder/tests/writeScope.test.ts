// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { CREATE_COLUMNS, ENTITY_SETS, UPDATE_COLUMNS } from "../src/schema";

// The builder may only write from dataverse.ts: it creates context variables, routing configurations,
// rulesets and route-to-queue steps, and updates only a ruleset's rules. It never deletes, and never
// writes a workstream, a queue or a decision contract.

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("write scope", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "execute.ts", "plan.ts", "rules.ts", "App.tsx", "demoData.ts"]));
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
  });

  test("the tables and columns that can be created are exactly these", () => {
    expect(CREATE_COLUMNS).toEqual({
      msdyn_ocliveworkstreamcontextvariable: [
        "msdyn_name", "msdyn_displayname", "msdyn_datatype", "msdyn_isdisplayable", "msdyn_islist", "msdyn_ismodifiable", "msdyn_issystemdefined", "msdyn_liveworkstreamid@odata.bind"
      ],
      msdyn_routingconfiguration: ["msdyn_name", "msdyn_uniquename", "msdyn_isactiveconfiguration", "msdyn_liveworkstreamid@odata.bind"],
      msdyn_decisionruleset: [
        "msdyn_name", "msdyn_uniquename", "msdyn_rulesetdefinition", "msdyn_rulesettype", "msdyn_authoringmode", "msdyn_isinputcollection",
        "msdyn_persistoutputdata", "msdyn_refreshinputdata", "msdyn_inputcontractid@odata.bind", "msdyn_outputcontractid@odata.bind"
      ],
      msdyn_routingconfigurationstep: ["msdyn_name", "msdyn_uniquename", "msdyn_type", "msdyn_steporder", "msdyn_routingconfigurationid@odata.bind", "msdyn_rulesetid@odata.bind"]
    });
  });

  test("the only update is a ruleset's rules", () => {
    expect(UPDATE_COLUMNS).toEqual({ msdyn_decisionruleset: ["msdyn_rulesetdefinition"] });
  });

  test("every writable table has its Web API name", () => {
    [...Object.keys(CREATE_COLUMNS), ...Object.keys(UPDATE_COLUMNS)].forEach((t) => expect(ENTITY_SETS[t]).toMatch(/^msdyn_[a-z]+s$/));
  });
});
