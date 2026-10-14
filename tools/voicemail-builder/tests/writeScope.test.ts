// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { CREATE_COLUMNS, ENTITY_SETS, UPDATE_COLUMNS } from "../src/schema";

// The builder may only write from dataverse.ts: it creates queues, voicemail workstreams and overflow
// rulesets, adds queue members, and updates only a ruleset's rules and a queue's links to its overflow
// rulesets. It never deletes, and never writes a decision contract, the voicemail hub or an overflow
// action.

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("write scope", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "execute.ts", "plan.ts", "overflow.ts", "intake.ts", "App.tsx", "demoData.ts"]));
  });

  test.each(files)("%s never deletes, and doesn't use Xrm.WebApi writes or execute", (file) => {
    const contents = read(file);
    [".createRecord(", ".updateRecord(", "deleteRecord", "executeMultiple", "execute(", "XMLHttpRequest", "\"DELETE\"", "\"PUT\""].forEach((token) => expect(contents.includes(token)).toBe(false));
  });

  test("the Web API is only called from dataverse.ts: one fetch, reached by a guarded POST, a guarded PATCH and the membership POST", () => {
    expect(files.filter((f) => /\bfetch\(/.test(read(f)))).toEqual(["dataverse.ts"]);
    const dataverse = read("dataverse.ts");
    expect(dataverse.match(/\bfetch\(/g)).toHaveLength(1);
    expect(dataverse).toMatch(/async function send\(method: "POST" \| "PATCH", /);
    expect(dataverse.match(/\bsend\(/g)).toHaveLength(4); // the function and its three callers
    expect(dataverse).toMatch(/guard\("create", CREATE_COLUMNS, table, payload\);\s+const response = await send\("POST", ENTITY_SETS\[table\], payload\);/);
    expect(dataverse).toMatch(/guard\("update", UPDATE_COLUMNS, table, columns\);\s+if \(!GUID\.test\(recordId\)\) throw [^\n]+\s+if \(!Object\.keys\(columns\)\.length\) return;\s+await send\("PATCH", `\$\{ENTITY_SETS\[table\]\}\(\$\{recordId\}\)`, columns\);/);
    expect(dataverse).toMatch(/if \(!GUID\.test\(queueId\) \|\| !GUID\.test\(userId\)\) throw [^\n]+\s+await send\("POST", `\$\{ENTITY_SETS\[QUEUE_TABLE\]\}\(\$\{queueId\}\)\/\$\{MEMBERSHIP_RELATIONSHIP\}\/\$ref`/);
  });

  test("the tables and columns that can be created are exactly these", () => {
    expect(Object.keys(CREATE_COLUMNS).sort()).toEqual(["msdyn_decisionruleset", "msdyn_liveworkstream", "queue"]);
    expect(CREATE_COLUMNS.queue).toEqual(["name", "msdyn_isomnichannelqueue", "msdyn_queuetype", "msdyn_assignmentstrategy", "msdyn_priority", "queueviewtype"]);
    expect(CREATE_COLUMNS.msdyn_liveworkstream).toEqual([
      "msdyn_name", "msdyn_streamsource", "msdyn_mode", "msdyn_direction", "msdyn_conversationmode", "msdyn_workdistributionmode", "msdyn_capacityformat", "msdyn_capacityrequired",
      "msdyn_allowedpresences", "msdyn_notification", "msdyn_screenpoptimeout_optionSet", "msdyn_blockcapacityforwrapup", "msdyn_enableselectingfrompushbasedworkstreams",
      "msdyn_enableagentaffinity", "msdyn_restrictdownloadrecording", "msdyn_restrictdownloadtranscript", "msdyn_masterentityroutingconfigurationId@odata.bind", "msdyn_defaultqueue@odata.bind"
    ]);
    expect(CREATE_COLUMNS.msdyn_decisionruleset).toEqual([
      "msdyn_name", "msdyn_uniquename", "msdyn_rulesetdefinition", "msdyn_rulesettype", "msdyn_authoringmode", "msdyn_isinputcollection",
      "msdyn_persistoutputdata", "msdyn_refreshinputdata", "msdyn_inputcontractid@odata.bind", "msdyn_outputcontractid@odata.bind"
    ]);
  });

  test("the only updates are a ruleset's rules and a queue's overflow rulesets", () => {
    expect(UPDATE_COLUMNS).toEqual({ msdyn_decisionruleset: ["msdyn_rulesetdefinition"], queue: ["msdyn_decisionrulesetid@odata.bind", "msdyn_inqueueoverflowrulesetid@odata.bind"] });
  });

  test("every writable table has its Web API name", () => {
    [...Object.keys(CREATE_COLUMNS), ...Object.keys(UPDATE_COLUMNS)].forEach((t) => expect(ENTITY_SETS[t]).toMatch(/^[a-z_]+s$/));
  });
});
