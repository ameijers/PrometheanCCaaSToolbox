// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";

// Each provisioning tool may only write what it says it writes, and only from its own dataverse.ts.
// None of them deletes anything, removes roles or memberships, or creates users. Only Skill Assignment
// updates, and only the rating of a skill assignment. (The shared kit itself never writes: see
// shared.test.ts.)

interface Scope {
  tool: string;
  createTables: string[];   // tables passed to createRecord
  posts: RegExp[];          // the only POST paths allowed
  update?: { table: string; keys: string[] }; // the one updateRecord allowed: table constant and the only keys it sets
}

const SCOPES: Scope[] = [
  { tool: "team-builder", createTables: ["TEAM_TABLE"], posts: [/teams\(\$\{teamId\}\)\/teamroles_association\/\$ref/] },
  { tool: "user-setup", createTables: ["RESOURCE_TABLE", "CAPACITY_LINK_TABLE"], posts: [/systemuserroles_association\/\$ref/, /Microsoft\.Dynamics\.CRM\.AddMembersTeam/] },
  { tool: "queue-membership", createTables: [], posts: [/queues\(\$\{queueId\}\)\/queuemembership_association\/\$ref/] },
  { tool: "skill-assignment", createTables: ["ASSIGNMENT_TABLE"], posts: [], update: { table: "ASSIGNMENT_TABLE", keys: ["RATING_BIND"] } }
];

const FORBIDDEN = ["deleteRecord", "executeMultiple", "execute(", "RemoveMembersTeam", "\"DELETE\"", "\"PATCH\"", "disassociate"];

describe.each(SCOPES)("$tool write scope", ({ tool, createTables, posts, update }) => {
  const dir = path.resolve(__dirname, `../../${tool}/src`);
  const files = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
  const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");

  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "plan.ts", "App.tsx"]));
  });

  test.each(files)("%s never updates, deletes or removes", (file) => {
    FORBIDDEN.forEach((token) => expect(read(file).includes(token)).toBe(false));
  });

  test("writes only happen in dataverse.ts", () => {
    files.filter((f) => f !== "dataverse.ts").forEach((f) => {
      expect(read(f).includes("createRecord")).toBe(false);
      expect(read(f).includes("updateRecord")).toBe(false);
      expect(/\bfetch\(/.test(read(f))).toBe(false);
    });
  });

  test("createRecord only on the allowed tables, and only POST requests", () => {
    const dv = read("dataverse.ts");
    expect([...dv.matchAll(/createRecord\(([^,]+),/g)].map((m) => m[1].trim()).sort()).toEqual([...createTables].sort());
    expect([...dv.matchAll(/method:\s*"([A-Z]+)"/g)].every((m) => m[1] === "POST")).toBe(true);
    expect(dv.includes("systemusers\", ") || /createRecord\("systemuser"/.test(dv)).toBe(false);
  });

  test("updateRecord only where allowed: one table, one key", () => {
    const dv = read("dataverse.ts");
    const calls = [...dv.matchAll(/updateRecord\(([^,]+),[^,]+,\s*\{([^}]*)\}/g)];
    expect(calls.length).toBe((dv.match(/updateRecord\(/g) ?? []).length);
    if (!update) return expect(calls).toEqual([]);
    expect(calls.length).toBe(1);
    expect(calls[0][1].trim()).toBe(update.table);
    expect([...calls[0][2].matchAll(/\[(\w+)\]\s*:/g)].map((m) => m[1])).toEqual(update.keys);
    expect(calls[0][2].split(":").length - 1).toBe(update.keys.length);
  });

  test("every POST path is an allowed one", () => {
    const dv = read("dataverse.ts");
    const paths = [...dv.matchAll(/(?:fetch|post)\(\s*`([^`]+)`/g)].map((m) => m[1]);
    if (!posts.length) return expect(paths).toEqual([]);
    expect(paths.length).toBeGreaterThan(0);
    paths.filter((p) => p !== "${base}/api/data/v9.2/${path}").forEach((p) => expect(posts.some((re) => re.test(p))).toBe(true));
    posts.forEach((re) => expect(re.test(dv)).toBe(true));
  });
});
