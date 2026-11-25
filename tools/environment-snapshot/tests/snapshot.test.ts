// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { cellText, chooseColumns } from "../src/columns";
import { demoSource } from "../src/demoData";
import { Snapshot, SnapshotSource, SourceError, TableMeta } from "../src/model";
import { takeSnapshot } from "../src/snapshot";
import { TABLES } from "../src/tables";

let snapshot: Snapshot;
beforeAll(async () => { snapshot = await takeSnapshot(demoSource); });
const table = (name: string) => snapshot.tables.find((t) => t.logicalName === name)!;

describe("takeSnapshot", () => {
  test("has every table, plus queue members, team members and security roles", () => {
    expect(snapshot.tables.map((t) => t.logicalName)).toEqual([...TABLES.filter((t) => !t.byIds).map((t) => t.logicalName), "systemuser", "queuemembership", "teammembership", "systemuserroles"]);
    expect(snapshot).toMatchObject({ environment: "sample environment", takenBy: "Sample user", mode: "demo" });
  });

  test("a table that isn't installed, or can't be read, is in the snapshot with the reason", () => {
    expect(table("msdyn_ocwhatsappchannelnumber")).toMatchObject({ status: "notFound", rows: [] });
    expect(table("msdyn_personasecurityrolemapping")).toMatchObject({ status: "noPermission", rows: [] });
    expect(snapshot.warnings).toEqual([expect.stringMatching(/no read access/)]);
  });

  test("secrets are never in a snapshot: not as a column, not in a row", () => {
    const workstreams = table("msdyn_liveworkstream");
    expect(workstreams.leftOut).toEqual(["msdyn_apikey", "msdyn_secureapikey"]);
    expect(workstreams.columns.some((c) => /apikey/.test(c.logicalName))).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("SAMPLE-SECRET-KEY");
  });

  test("helper and system columns are left out, the name comes first and the id last", () => {
    const columns = table("queue").columns;
    expect(columns[0].logicalName).toBe("name");
    expect(columns[columns.length - 1].logicalName).toBe("queueid");
    expect(columns.some((c) => c.logicalName === "versionnumber" || c.logicalName === "createdbyname")).toBe(false);
  });

  test("only contact center queues", () => {
    expect(table("queue").rows).toHaveLength(6);
    expect(table("queue").scope).toBe("Contact center queues only");
  });

  test("users: only those the configuration points to, with work details only", () => {
    const users = table("systemuser");
    expect(users.rows.map((u) => u.fullname).sort()).toEqual(["Ava Jansen", "Contoso IVR bot", "Emma Brown", "Liam de Vries", "Mila Peters", "Noah Smith"]);
    expect(users.columns.map((c) => c.logicalName)).not.toContain("address1_telephone1");
    expect(JSON.stringify(users.rows)).not.toContain("+15550199");
  });

  test("queue members, team members and security roles by name", () => {
    expect(table("queuemembership").rows).toContainEqual(expect.objectContaining({ queue: "Sales – NL", agent: "Ava Jansen" }));
    expect(table("queuemembership").rows).toHaveLength(9);
    expect(table("teammembership").rows).toContainEqual(expect.objectContaining({ team: "Support team", agent: "Mila Peters" }));
    expect(table("systemuserroles").rows).toContainEqual(expect.objectContaining({ agent: "Ava Jansen", role: "Omnichannel supervisor", businessunit: "Contoso" }));
    // The bot isn't an interactive user, so it has no team or role rows.
    expect(table("systemuserroles").rows.some((r) => r.agent === "Contoso IVR bot")).toBe(false);
  });

  test("reports progress up to the end", async () => {
    const seen: number[] = [];
    await takeSnapshot(demoSource, (p) => seen.push(p.done));
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(TABLES.length + 3);
  });

  test("a failing read of one table doesn't stop the others", async () => {
    const failing: SnapshotSource = { ...demoSource, rows: async (name, filter) => { if (name === "queue") throw new SourceError("error", "Timeout."); return demoSource.rows(name, filter); } };
    const result = await takeSnapshot(failing);
    expect(result.tables.find((t) => t.logicalName === "queue")).toMatchObject({ status: "error", message: "Timeout." });
    expect(result.tables.find((t) => t.logicalName === "msdyn_liveworkstream")!.rows).toHaveLength(5);
    expect(result.warnings).toContain("Queues: Timeout.");
  });
});

describe("columns", () => {
  const meta: TableMeta = {
    logicalName: "x", label: "X", primaryId: "xid", primaryName: "name",
    attributes: [
      { logicalName: "name", label: "Name", type: "String", readable: true },
      { logicalName: "xid", label: "X", type: "Uniqueidentifier", readable: true },
      { logicalName: "queue", label: "Queue", type: "Lookup", readable: true },
      { logicalName: "queuename", type: "String", attributeOf: "queue", readable: true },
      { logicalName: "presences", label: "Presences", type: "Virtual", typeName: "MultiSelectPicklistType", readable: true },
      { logicalName: "entityimage", type: "Virtual", typeName: "ImageType", readable: true },
      { logicalName: "msdyn_connectionstring", type: "String", readable: true },
      { logicalName: "msdyn_tokenexpirationtime", label: "Token expiration time", type: "Integer", readable: true },
      { logicalName: "hidden", type: "String", readable: false }
    ]
  };

  test("lookups read as _<name>_value; multi-select choices stay; images, helpers and unreadable columns go", () => {
    const { columns, leftOut } = chooseColumns(meta);
    // A setting about a secret (when a token expires) isn't a secret.
    expect(columns.map((c) => c.key)).toEqual(["name", "presences", "_queue_value", "msdyn_tokenexpirationtime", "xid"]);
    expect(leftOut).toEqual(["msdyn_connectionstring"]);
  });

  test("a value reads as Dataverse's label when there is one", () => {
    const row = { _queue_value: "q1", "_queue_value@OData.Community.Display.V1.FormattedValue": "Sales", flag: true, n: 3, empty: null, obj: { a: 1 } };
    const column = (key: string) => ({ key, logicalName: key, label: key, type: "" });
    expect(["_queue_value", "flag", "n", "empty", "obj"].map((k) => cellText(row, column(k)))).toEqual(["Sales", "Yes", "3", "", "{\"a\":1}"]);
  });
});
