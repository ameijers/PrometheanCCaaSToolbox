import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { findOne, readRows } from "../../shared/src/columns";
import { Plan, PlanItem, PlannedAction } from "../../shared/src/model";
import { CapacityProfile, DEFAULT_CAPACITY_PROFILES, FALLBACK_TIME_ZONE, RESOURCE_TYPE_USER, Role, TEAM_TYPE, Team, TimeZone, User, UserCatalog } from "./model";
import { COLUMNS } from "./template";

// Each row sets up one existing user as an agent:
//   assign security roles (in the user's own business unit) · add to owner teams ·
//   make them a bookable resource · link capacity profiles to that resource.
// Everything already in place is "noChange" and left alone, so the same file can be run again.
// Users aren't created here: they come from Microsoft Entra ID (licensed + in the environment's
// security group), and a row for a user who isn't synced yet says so.

export interface UserWriter {
  addRole(userId: string, roleId: string): Promise<void>;
  addToTeam(teamId: string, userId: string): Promise<void>;
  createResource(payload: Record<string, unknown>): Promise<string>;
  linkCapacityProfile(payload: Record<string, unknown>): Promise<string>;
}

export function resourcePayload(user: User, timeZone: number): Record<string, unknown> {
  return {
    name: user.fullName,
    resourcetype: RESOURCE_TYPE_USER,
    // The navigation property is PascalCase (ManyToOneRelationships metadata).
    "UserId@odata.bind": `/systemusers(${user.id})`,
    timezone: timeZone,
    // Application Required; true on every user resource in the reference environment.
    msdyn_displayonscheduleboard: true
  };
}

// Named after the profile's unique name, as the admin center names them.
export function capacityLinkPayload(resourceId: string, profile: CapacityProfile): Record<string, unknown> {
  return {
    msdyn_name: profile.uniqueName ?? profile.name,
    "msdyn_bookableresourceid@odata.bind": `/bookableresources(${resourceId})`,
    "msdyn_capacityprofileid@odata.bind": `/msdyn_capacityprofiles(${profile.id})`
  };
}

function findTimeZone(zones: TimeZone[], raw: string): TimeZone | undefined {
  if (/^\d+$/.test(raw)) return zones.find((z) => z.code === Number(raw));
  const w = raw.toLowerCase();
  return zones.find((z) => z.standardName.toLowerCase() === w) ?? zones.find((z) => z.displayName.toLowerCase() === w);
}

export function buildUserPlan(csv: ParsedCsv, catalog: UserCatalog, writer: UserWriter): Plan {
  const { rows, issues } = readRows(csv, COLUMNS, "user");
  const items: PlanItem[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row) => {
    const wanted = row.cell("user");
    const line = row.line;
    const error = (column: string, message: string) => issues.push({ severity: "error", line, column, item: wanted || undefined, message });
    const warning = (column: string, message: string) => issues.push({ severity: "warning", line, column, item: wanted || undefined, message });
    if (!wanted) return error("user", "user is empty. Every row needs the sign-in name or email of a user.");

    const found = findOne(catalog.users, wanted, (u) => [u.signIn, u.email]);
    if (found.count > 1) return error("user", `${found.count} users match "${wanted}". Use the sign-in name.`);
    const user = found.record;
    if (!user) return error("user", `"${wanted}" isn't in this environment yet. Make sure the user is licensed and in the environment's security group in Microsoft Entra ID, then wait for the sync (or have them sign in once) and run this file again.`);
    if (user.disabled) return error("user", `${user.fullName} is disabled in this environment.`);
    if (!user.interactive) return error("user", `${user.fullName} isn't an interactive user (an application or non-interactive account) and can't be an agent.`);
    if (seen.has(user.id)) return error("user", `${user.fullName} is also on line ${seen.get(user.id)}. Put everything for one user on one row.`);
    seen.set(user.id, line);

    const actions: PlannedAction[] = [];

    // Security roles in the user's own business unit.
    const roles: Role[] = [];
    row.list("security_roles").forEach((name) => {
      const anywhere = catalog.roles.filter((r) => r.name.toLowerCase() === name.toLowerCase());
      if (!anywhere.length) return error("security_roles", `No security role named "${name}" exists.`);
      const inUnit = anywhere.find((r) => r.businessUnitId === user.businessUnitId);
      if (!inUnit) return error("security_roles", `The role "${name}" isn't available in ${user.fullName}'s business unit "${user.businessUnitName}".`);
      roles.push(inUnit);
    });
    roles.forEach((role) => actions.push(user.roleIds.includes(role.id)
      ? { key: `role:${role.id}`, label: "Assign role", target: role.name, status: "noChange", reason: "Already assigned" }
      : { key: `role:${role.id}`, label: "Assign role", target: role.name, status: "todo", run: async () => { await writer.addRole(user.id, role.id); } }));

    // Owner teams.
    const teamNames = row.list("teams");
    teamNames.forEach((name) => {
      const matches = catalog.teams.filter((t) => t.name.toLowerCase() === name.toLowerCase());
      if (!matches.length) return error("teams", `No team named "${name}" exists.`);
      const owner = matches.filter((t) => t.teamType === TEAM_TYPE.owner);
      if (!owner.length) {
        const t = matches[0];
        if (t.teamType === TEAM_TYPE.securityGroup || t.teamType === TEAM_TYPE.officeGroup) return error("teams", `"${t.name}" is an Entra ID group team: its members come from the group. Add ${user.fullName} to the group in the Microsoft Entra admin center instead.`);
        return error("teams", `"${t.name}" is an access team: it gives no security roles. Use an owner team.`);
      }
      if (owner.length > 1) return error("teams", `${owner.length} owner teams are named "${name}" (in ${owner.map((t) => t.businessUnitName).join(", ")}). Rename one of them first.`);
      const team: Team = owner[0];
      actions.push(team.memberIds.includes(user.id)
        ? { key: `team:${team.id}`, label: "Add to team", target: team.name, status: "noChange", reason: "Already a member" }
        : { key: `team:${team.id}`, label: "Add to team", target: team.name, status: "todo", run: async () => { await writer.addToTeam(team.id, user.id); } });
    });

    if (!roles.length && !teamNames.length && !user.roleIds.length) warning("security_roles", `${user.fullName} has no security role and none is assigned here, so they can't sign in to the apps. Add a role or an owner team.`);

    // Bookable resource.
    const resource = catalog.resources.find((r) => r.userId === user.id);
    if (resource && !resource.active) error("user", `${user.fullName}'s bookable resource is deactivated. Activate it first.`);
    let timeZone = user.timeZone ?? FALLBACK_TIME_ZONE;
    if (row.has("time_zone")) {
      const zone = findTimeZone(catalog.timeZones, row.cell("time_zone"));
      if (!zone) error("time_zone", `"${row.cell("time_zone")}" isn't a time zone. Use its code (e.g. 110) or name (e.g. W. Europe Standard Time).`);
      else timeZone = zone.code;
      if (resource) warning("time_zone", `${user.fullName} is already a bookable resource, so time_zone isn't used.`);
    } else if (user.timeZone === undefined && !resource) warning("time_zone", `${user.fullName} has no time zone of their own, so the bookable resource gets UTC.`);
    const zoneName = catalog.timeZones.find((z) => z.code === timeZone)?.standardName ?? String(timeZone);
    actions.push(resource
      ? { key: "resource", label: "Make bookable resource", target: user.fullName, status: "noChange", reason: "Already a bookable resource" }
      : { key: "resource", label: "Make bookable resource", target: `${user.fullName} (${zoneName})`, status: "todo", run: () => writer.createResource(resourcePayload(user, timeZone)) });

    // Capacity profiles on the resource.
    const profileNames = row.cell("capacity_profiles").toLowerCase() === "none" ? [] : row.has("capacity_profiles") ? row.list("capacity_profiles") : DEFAULT_CAPACITY_PROFILES;
    profileNames.forEach((name) => {
      const p = findOne(catalog.capacityProfiles, name, (c) => [c.name, c.uniqueName]);
      if (p.count > 1) return error("capacity_profiles", `${p.count} capacity profiles are named "${name}".`);
      if (!p.record) return error("capacity_profiles", row.has("capacity_profiles") ? `No capacity profile named "${name}" exists.` : `The default capacity profile (${name}) wasn't found. Fill in capacity_profiles.`);
      const profile = p.record;
      actions.push(resource?.profileIds.includes(profile.id)
        ? { key: `capacity:${profile.id}`, label: "Link capacity profile", target: profile.name, status: "noChange", reason: "Already linked" }
        : { key: `capacity:${profile.id}`, label: "Link capacity profile", target: profile.name, status: "todo", dependsOn: "resource", run: (ctx) => writer.linkCapacityProfile(capacityLinkPayload(resource?.id ?? ctx.id("resource"), profile)) });
    });
    if (!profileNames.length && !resource?.profileIds.length) warning("capacity_profiles", `${user.fullName} gets no capacity profile, so routing can't assign them work.`);

    items.push({ key: user.id, line, title: user.fullName, facts: [user.signIn, `Business unit: ${user.businessUnitName}`], actions });
  });

  return { items, issues, rowCount: csv.records.length };
}
