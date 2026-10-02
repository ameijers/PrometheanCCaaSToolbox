// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { GUID, findOne, readRows } from "../../shared/src/columns";
import { Issue, Plan, PlanItem, PlannedAction } from "../../shared/src/model";
import { BusinessUnit, MEMBERSHIP_TYPES, MembershipTypeName, Role, TEAM_TYPES, TeamCatalog, TeamTypeName, User } from "./model";
import { COLUMNS } from "./template";

// Each row becomes: create the team (or "in place" when a matching team already exists), then assign
// each security role (or "in place" when the team already has it). Roles are business-unit scoped:
// every business unit has its own copy of each role, so a role name is resolved to the copy in the
// team's business unit.

export interface TeamWriter {
  createTeam(payload: Record<string, unknown>): Promise<string>;
  addRole(teamId: string, roleId: string): Promise<void>;
}

export function teamPayload(fields: { name: string; type: TeamTypeName; unit: BusinessUnit; admin: User; description?: string; groupId?: string; membership: MembershipTypeName }): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: fields.name,
    teamtype: TEAM_TYPES[fields.type],
    // System Required on every team; only meaningful for group teams.
    membershiptype: fields.type === "Entra ID security group" ? MEMBERSHIP_TYPES[fields.membership] : 0,
    "businessunitid@odata.bind": `/businessunits(${fields.unit.id})`,
    "administratorid@odata.bind": `/systemusers(${fields.admin.id})`
  };
  if (fields.description) payload.description = fields.description;
  if (fields.type === "Entra ID security group" && fields.groupId) payload.azureactivedirectoryobjectid = fields.groupId;
  return payload;
}

export function buildTeamPlan(csv: ParsedCsv, catalog: TeamCatalog, writer: TeamWriter): Plan {
  const { rows, issues } = readRows(csv, COLUMNS, "team_name");
  const root = catalog.businessUnits.find((u) => !u.parentId);
  const items: PlanItem[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row) => {
    const name = row.cell("team_name");
    const line = row.line;
    const error = (column: string, message: string) => issues.push({ severity: "error", line, column, item: name || undefined, message });
    const warning = (column: string, message: string) => issues.push({ severity: "warning", line, column, item: name || undefined, message });
    if (!name) return error("team_name", "team_name is empty. Every row needs the name of the team.");

    const type = row.choice("team_type") as TeamTypeName;
    const membership = row.choice("membership_type") as MembershipTypeName;
    const isGroup = type === "Entra ID security group";

    // Business unit.
    let unit: BusinessUnit | undefined = root;
    if (row.has("business_unit")) {
      const found = findOne(catalog.businessUnits, row.cell("business_unit"), (u) => [u.name]);
      if (found.count > 1) error("business_unit", `${found.count} business units are named "${row.cell("business_unit")}".`);
      else if (!found.record) error("business_unit", `No business unit named "${row.cell("business_unit")}" exists.`);
      else if (found.record.disabled) error("business_unit", `The business unit "${found.record.name}" is disabled.`);
      unit = found.record && !found.record.disabled ? found.record : undefined;
    } else if (!root) error("business_unit", "The root business unit couldn't be found.");

    const key = `${name.toLowerCase()}@${unit?.id ?? row.cell("business_unit").toLowerCase()}`;
    if (seen.has(key)) return error("team_name", `"${name}" in this business unit is also on line ${seen.get(key)}.`);
    seen.set(key, line);

    // Administrator.
    let admin: User | undefined;
    if (row.has("administrator")) {
      const found = findOne(catalog.users, row.cell("administrator"), (u) => [u.signIn, u.email]);
      if (found.count > 1) error("administrator", `${found.count} users match "${row.cell("administrator")}". Use the sign-in name.`);
      else if (!found.record) error("administrator", `No user with sign-in name or email "${row.cell("administrator")}" exists in this environment.`);
      else if (found.record.disabled || !found.record.interactive) error("administrator", `${found.record.fullName} can't be a team administrator: the user is disabled or isn't an interactive user.`);
      else admin = found.record;
    } else {
      admin = catalog.users.find((u) => u.id === catalog.currentUserId);
      if (!admin) error("administrator", "administrator is empty and the current user couldn't be found. Fill in an administrator.");
    }

    // Entra ID group fields.
    const groupId = row.cell("entra_group_object_id").toLowerCase() || undefined;
    if (isGroup) {
      if (!groupId) error("entra_group_object_id", "entra_group_object_id is required for an Entra ID security group team.");
      else if (!GUID.test(groupId)) error("entra_group_object_id", `"${row.cell("entra_group_object_id")}" isn't an Object ID (a GUID like 0b6f4e1a-2c3d-4e5f-8a9b-1c2d3e4f5a6b).`);
    } else {
      if (groupId) warning("entra_group_object_id", "Only used for Entra ID security group teams. Ignored for an Owner team.");
      if (row.has("membership_type")) warning("membership_type", "Only used for Entra ID security group teams. Ignored for an Owner team.");
    }

    // Security roles, resolved in the team's business unit.
    const roleNames = row.list("security_roles");
    const roles: Role[] = [];
    roleNames.forEach((roleName) => {
      const anywhere = catalog.roles.filter((r) => r.name.toLowerCase() === roleName.toLowerCase());
      if (!anywhere.length) return error("security_roles", `No security role named "${roleName}" exists.`);
      if (!unit) return;
      const inUnit = anywhere.find((r) => r.businessUnitId === unit!.id);
      if (!inUnit) return error("security_roles", `The role "${roleName}" isn't available in the business unit "${unit.name}".`);
      roles.push(inUnit);
    });
    if (!roleNames.length) warning("security_roles", isGroup ? "No security roles: group members get no privileges through this team." : "No security roles: members get no privileges through this team.");

    if (!unit || !admin || (isGroup && (!groupId || !GUID.test(groupId)))) { items.push({ key, line, title: name, facts: [type], actions: [] }); return; }

    // An existing team: same name in the business unit, or (for a group team) the same group.
    const sameName = catalog.teams.find((t) => t.businessUnitId === unit!.id && t.name.toLowerCase() === name.toLowerCase());
    const sameGroup = isGroup ? catalog.teams.find((t) => t.businessUnitId === unit!.id && t.groupId?.toLowerCase() === groupId) : undefined;
    let existingId: string | undefined;
    if (sameGroup && (!sameName || sameGroup.id !== sameName.id)) {
      error("entra_group_object_id", `This group already has a team in "${unit.name}": "${sameGroup.name}". A group can have one team per business unit.`);
    } else if (sameName) {
      const typeMatches = sameName.teamType === TEAM_TYPES[type] && (!isGroup || sameName.groupId?.toLowerCase() === groupId);
      if (!typeMatches) error("team_name", `A team named "${name}" already exists in "${unit.name}" with a different type or group. Rename the row, or use that team.`);
      else existingId = sameName.id;
    } else {
      const elsewhere = catalog.teams.filter((t) => t.name.toLowerCase() === name.toLowerCase());
      if (elsewhere.length) warning("team_name", `A team with this name also exists in another business unit. That's allowed, but can be confusing.`);
    }

    const existing = existingId ? catalog.teams.find((t) => t.id === existingId) : undefined;
    const actions: PlannedAction[] = [];
    if (existing) {
      actions.push({ key: "team", label: "Create team", target: `${name} (${unit.name})`, status: "noChange", reason: "This team already exists; only missing roles are added." });
    } else {
      const payload = teamPayload({ name, type, unit, admin, description: row.cell("description") || undefined, groupId, membership });
      actions.push({ key: "team", label: "Create team", target: `${name} (${unit.name})`, status: "todo", run: () => writer.createTeam(payload) });
    }
    roles.forEach((role) => {
      if (existing?.roleIds.includes(role.id)) actions.push({ key: `role:${role.id}`, label: "Assign role", target: role.name, status: "noChange", reason: "Already assigned" });
      else actions.push({ key: `role:${role.id}`, label: "Assign role", target: role.name, status: "todo", dependsOn: "team", run: async (ctx) => { await writer.addRole(existing?.id ?? ctx.id("team"), role.id); } });
    });

    const facts = [type, `Business unit: ${unit.name}`, `Administrator: ${admin.fullName}`];
    if (isGroup) facts.push(`Group ${groupId}`, `Membership: ${membership}`);
    items.push({ key, line, title: name, facts, actions });
  });

  return { items, issues, rowCount: csv.records.length };
}
