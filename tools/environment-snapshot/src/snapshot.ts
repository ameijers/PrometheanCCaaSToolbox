// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { chooseColumns, idOf, isSecret, lookupId, text } from "./columns";
import { Row, Snapshot, SnapshotColumn, SnapshotSource, SnapshotTable, SourceError, TableMeta } from "./model";
import { DERIVED, TABLES, TABLE_LABELS, TableSpec } from "./tables";

// Takes a snapshot: describes and reads every table in TABLES, then adds queue members, team members
// and agents' security roles. Only reads. One table that can't be read doesn't stop the others: it's
// in the snapshot with the reason.

export interface Progress {
  done: number;
  total: number;
  message: string;
}

function failure(error: unknown): { status: SnapshotTable["status"]; message: string } {
  if (error instanceof SourceError) return { status: error.kind, message: error.message };
  const message = error && typeof error === "object" && typeof (error as any).message === "string" ? (error as any).message : String(error);
  return { status: "error", message };
}

// Secrets are dropped from the rows as soon as they're read, so they're never in a snapshot at all.
function withoutSecrets(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !isSecret(key.split("@")[0].replace(/^_(.*)_value$/, "$1"))));
}

function emptyTable(spec: TableSpec, label: string): SnapshotTable {
  return { logicalName: spec.logicalName, label, section: spec.section, scope: spec.scope, status: "ok", columns: [], rows: [], leftOut: [] };
}

async function readTable(source: SnapshotSource, spec: TableSpec, ids?: string[]): Promise<SnapshotTable> {
  let meta: TableMeta | null;
  const fallback = TABLE_LABELS[spec.logicalName] ?? spec.logicalName;
  try {
    meta = await source.describe(spec.logicalName);
  } catch (error) {
    return { ...emptyTable(spec, fallback), ...failure(error) };
  }
  if (!meta) return { ...emptyTable(spec, fallback), status: "notFound", message: "This table isn't in this environment." };
  const { columns, leftOut } = chooseColumns(meta);
  const table: SnapshotTable = {
    ...emptyTable(spec, meta.label), columns, leftOut,
    idKey: meta.primaryId, nameKey: meta.primaryName
  };
  try {
    if (spec.byIds) {
      table.rows = ids?.length ? await source.rowsByIds(spec.logicalName, spec.byIds.idColumn, ids, spec.byIds.select) : [];
      const selected = new Set(spec.byIds.select);
      table.columns = columns.filter((c) => selected.has(c.key));
    } else {
      table.rows = await source.rows(spec.logicalName, spec.filter);
    }
    table.rows = table.rows.map(withoutSecrets);
  } catch (error) {
    Object.assign(table, failure(error));
  }
  return table;
}

function derived(spec: { logicalName: string; label: string; section: SnapshotTable["section"] }, columns: [string, string][], rows: Row[], status: Partial<SnapshotTable> = {}): SnapshotTable {
  return {
    logicalName: spec.logicalName, label: spec.label, section: spec.section, status: "ok", derived: true, leftOut: [],
    columns: columns.map(([key, label]): SnapshotColumn => ({ key, logicalName: key, label, type: "Text" })), rows, ...status
  };
}

const byName = (a: Row, b: Row, key: string) => String(a[key] ?? "").localeCompare(String(b[key] ?? ""));

export async function takeSnapshot(source: SnapshotSource, onProgress?: (p: Progress) => void): Promise<Snapshot> {
  const warnings: string[] = [];
  const tables: SnapshotTable[] = [];
  const direct = TABLES.filter((t) => !t.byIds);
  const total = TABLES.length + 3;
  let done = 0;
  const step = (message: string) => onProgress?.({ done: done++, total, message });

  for (const spec of direct) {
    step(`Reading ${spec.logicalName}`);
    tables.push(await readTable(source, spec));
  }
  const find = (logicalName: string) => tables.find((t) => t.logicalName === logicalName);
  const queues = find("queue")?.rows ?? [];
  const queueIds = new Set(queues.map((q) => idOf(q, "queueid")).filter(Boolean));

  // Queue members of the contact center queues.
  step("Reading queue members");
  let memberships: Row[] = [];
  let membershipStatus: Partial<SnapshotTable> = {};
  try {
    memberships = (await source.rowsByIds("queuemembership", "queueid", [...queueIds] as string[], ["queueid", "systemuserid"]))
      .filter((m) => queueIds.has(idOf(m, "queueid")));
  } catch (error) {
    membershipStatus = failure(error);
  }

  // The users the configuration points to: queue members, bookable resources' users and bots.
  const userIds = new Set<string>();
  memberships.forEach((m) => { const id = idOf(m, "systemuserid"); if (id) userIds.add(id); });
  (find("bookableresource")?.rows ?? []).forEach((r) => { const id = lookupId(r, "userid"); if (id) userIds.add(id); });
  (find("msdyn_liveworkstream")?.rows ?? []).forEach((w) => { const id = lookupId(w, "msdyn_bot_user"); if (id) userIds.add(id); });
  for (const spec of TABLES.filter((t) => t.byIds)) {
    step(`Reading ${spec.logicalName}`);
    tables.push(await readTable(source, spec, [...userIds]));
  }
  const users = find("systemuser")?.rows ?? [];
  const userName = new Map(users.map((u) => [idOf(u, "systemuserid")!, text(u, "fullname") || text(u, "domainname")]));
  const queueName = new Map(queues.map((q) => [idOf(q, "queueid")!, text(q, "name")]));

  tables.push(derived(DERIVED.queueMembers, [["queue", "Queue"], ["agent", "Agent"], ["queueid", "Queue id"], ["systemuserid", "User id"]],
    memberships.map((m) => ({ queue: queueName.get(idOf(m, "queueid")!) ?? "", agent: userName.get(idOf(m, "systemuserid")!) ?? idOf(m, "systemuserid"), queueid: idOf(m, "queueid"), systemuserid: idOf(m, "systemuserid") }))
      .sort((a, b) => byName(a, b, "queue") || byName(a, b, "agent")), membershipStatus));

  // Team membership and security roles of the agents (interactive users the configuration points to).
  const agentIds = users.filter((u) => u.accessmode === undefined || u.accessmode === 0).map((u) => idOf(u, "systemuserid")!).filter(Boolean);
  step("Reading team members");
  const teamName = new Map((find("team")?.rows ?? []).map((t) => [idOf(t, "teamid")!, text(t, "name")]));
  try {
    const rows = await source.rowsByIds("teammembership", "systemuserid", agentIds, ["teamid", "systemuserid"]);
    tables.push(derived(DERIVED.teamMembers, [["team", "Team"], ["agent", "Agent"], ["teamid", "Team id"], ["systemuserid", "User id"]],
      rows.map((r) => ({ team: teamName.get(idOf(r, "teamid")!) ?? idOf(r, "teamid"), agent: userName.get(idOf(r, "systemuserid")!) ?? "", teamid: idOf(r, "teamid"), systemuserid: idOf(r, "systemuserid") }))
        .sort((a, b) => byName(a, b, "team") || byName(a, b, "agent"))));
  } catch (error) {
    tables.push(derived(DERIVED.teamMembers, [], [], failure(error)));
  }

  step("Reading security roles");
  try {
    const links = await source.rowsByIds("systemuserroles", "systemuserid", agentIds, ["roleid", "systemuserid"]);
    const roleIds = [...new Set(links.map((l) => idOf(l, "roleid")!).filter(Boolean))];
    const roles = roleIds.length ? await source.rowsByIds("role", "roleid", roleIds, ["roleid", "name", "_businessunitid_value"]) : [];
    const role = new Map(roles.map((r) => [idOf(r, "roleid")!, r]));
    tables.push(derived(DERIVED.securityRoles, [["agent", "Agent"], ["role", "Security role"], ["businessunit", "Role's business unit"], ["roleid", "Role id"], ["systemuserid", "User id"]],
      links.map((l) => {
        const r = role.get(idOf(l, "roleid")!);
        return { agent: userName.get(idOf(l, "systemuserid")!) ?? "", role: r ? text(r, "name") : idOf(l, "roleid"), businessunit: r ? text(r, "_businessunitid_value") : "", roleid: idOf(l, "roleid"), systemuserid: idOf(l, "systemuserid") };
      }).sort((a, b) => byName(a, b, "agent") || byName(a, b, "role"))));
  } catch (error) {
    tables.push(derived(DERIVED.securityRoles, [], [], failure(error)));
  }
  onProgress?.({ done: total, total, message: "Done" });

  tables.filter((t) => t.status === "noPermission" || t.status === "error").forEach((t) => warnings.push(`${t.label}: ${t.message}`));
  return { environment: source.environment(), takenAt: new Date().toISOString(), takenBy: source.user(), mode: source.mode, tables, warnings };
}
