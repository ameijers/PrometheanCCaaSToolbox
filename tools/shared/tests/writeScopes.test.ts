import * as fs from "fs";
import * as path from "path";

// Each of the three provisioning tools may only write what it says it writes, and only from its own
// dataverse.ts. None of them updates or deletes anything, removes roles or memberships, or creates
// users. (The shared kit itself never writes: see shared.test.ts.)

interface Scope {
  tool: string;
  createTables: string[];   // tables passed to createRecord
  posts: RegExp[];          // the only POST paths allowed
}

const SCOPES: Scope[] = [
  { tool: "team-builder", createTables: ["TEAM_TABLE"], posts: [/teams\(\$\{teamId\}\)\/teamroles_association\/\$ref/] },
  { tool: "user-setup", createTables: ["RESOURCE_TABLE", "CAPACITY_LINK_TABLE"], posts: [/systemuserroles_association\/\$ref/, /Microsoft\.Dynamics\.CRM\.AddMembersTeam/] },
  { tool: "queue-membership", createTables: [], posts: [/queues\(\$\{queueId\}\)\/queuemembership_association\/\$ref/] }
];

const FORBIDDEN = ["updateRecord", "deleteRecord", "executeMultiple", "execute(", "RemoveMembersTeam", "\"DELETE\"", "\"PATCH\"", "disassociate"];

describe.each(SCOPES)("$tool write scope", ({ tool, createTables, posts }) => {
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
      expect(/\bfetch\(/.test(read(f))).toBe(false);
    });
  });

  test("createRecord only on the allowed tables, and only POST requests", () => {
    const dv = read("dataverse.ts");
    expect([...dv.matchAll(/createRecord\(([^,]+),/g)].map((m) => m[1].trim()).sort()).toEqual([...createTables].sort());
    expect([...dv.matchAll(/method:\s*"([A-Z]+)"/g)].every((m) => m[1] === "POST")).toBe(true);
    expect(dv.includes("systemusers\", ") || /createRecord\("systemuser"/.test(dv)).toBe(false);
  });

  test("every POST path is an allowed one", () => {
    const dv = read("dataverse.ts");
    const paths = [...dv.matchAll(/(?:fetch|post)\(\s*`([^`]+)`/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    paths.filter((p) => p !== "${base}/api/data/v9.2/${path}").forEach((p) => expect(posts.some((re) => re.test(p))).toBe(true));
    posts.forEach((re) => expect(re.test(dv)).toBe(true));
  });
});
