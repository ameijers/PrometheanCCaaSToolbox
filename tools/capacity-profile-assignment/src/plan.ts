// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { findOne, readRows } from "../../shared/src/columns";
import { Issue, Plan, PlanItem, PlannedAction } from "../../shared/src/model";
import { CapacityCatalog, CapacityProfile, User, profileLabel } from "./model";
import { COLUMNS } from "./template";

// A capacity profile is assigned to a user by linking it to the user's bookable resource
// (msdyn_bookableresourcecapacityprofile), the same record User Setup and the admin center create.
// For each requested profile:
//   - not linked yet → Assign capacity profile
//   - already linked → in place
// Profiles are never removed. Both the CSV and the selection page build their plan with planForUser,
// so they behave the same.

export interface CapacityWriter {
  link(payload: Record<string, unknown>): Promise<string>;
}

// Named after the profile's unique name, as the admin center names them. Max units is left empty, so the
// profile's default applies.
export function linkPayload(resourceId: string, profile: CapacityProfile): Record<string, unknown> {
  return {
    msdyn_name: profile.uniqueName ?? profile.name,
    "msdyn_bookableresourceid@odata.bind": `/bookableresources(${resourceId})`,
    "msdyn_capacityprofileid@odata.bind": `/msdyn_capacityprofiles(${profile.id})`
  };
}

export type UserCheck = { ok: true; resourceId: string } | { ok: false; message: string };

// Whether profiles can be assigned to this user at all: an enabled, interactive user with an active
// bookable resource.
export function checkUser(user: User, catalog: CapacityCatalog): UserCheck {
  if (user.disabled || !user.interactive) return { ok: false, message: `${user.fullName} is disabled or isn't an interactive user.` };
  const resource = catalog.resources.find((r) => r.userId === user.id);
  if (!resource) return { ok: false, message: `${user.fullName} isn't a bookable resource yet, so capacity profiles can't be assigned. Run User Setup for this user first.` };
  if (!resource.active) return { ok: false, message: `${user.fullName}'s bookable resource is deactivated.` };
  return { ok: true, resourceId: resource.id };
}

export function planForUser(user: User, resourceId: string, profiles: CapacityProfile[], catalog: CapacityCatalog, writer: CapacityWriter, line: number): PlanItem {
  const linked = catalog.resources.find((r) => r.id === resourceId)?.profileIds ?? [];
  const actions: PlannedAction[] = profiles.map((profile): PlannedAction => {
    const base = { key: `capacity:${profile.id}`, label: "Assign capacity profile", target: profileLabel(profile) };
    return linked.includes(profile.id)
      ? { ...base, status: "noChange", reason: "Already assigned" }
      : { ...base, status: "todo", run: () => writer.link(linkPayload(resourceId, profile)) };
  });
  return { key: user.id, line, title: user.fullName, facts: [user.signIn, `Business unit: ${user.businessUnitName}`], actions };
}

export function findProfile(profiles: CapacityProfile[], name: string): { profile?: CapacityProfile; problem?: string } {
  const found = findOne(profiles, name, (p) => [p.name, p.uniqueName]);
  if (found.count > 1) return { problem: `${found.count} capacity profiles are named "${name}". Use the unique name.` };
  const profile = found.record;
  if (!profile) return { problem: `No capacity profile named "${name}" exists.` };
  if (!profile.active) return { problem: `The capacity profile "${profile.name}" is deactivated.` };
  return { profile };
}

export function buildCsvPlan(csv: ParsedCsv, catalog: CapacityCatalog, writer: CapacityWriter): Plan {
  const { rows, issues } = readRows(csv, COLUMNS, "user");
  const items: PlanItem[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row) => {
    const wanted = row.cell("user");
    const line = row.line;
    const error = (column: string, message: string) => issues.push({ severity: "error", line, column, item: wanted || undefined, message });
    if (!wanted) return error("user", "user is empty. Every row needs the sign-in name or email of a user.");

    const found = findOne(catalog.users, wanted, (u) => [u.signIn, u.email]);
    if (found.count > 1) return error("user", `${found.count} users match "${wanted}". Use the sign-in name.`);
    const user = found.record;
    if (!user) return error("user", `"${wanted}" isn't in this environment.`);
    if (seen.has(user.id)) return error("user", `${user.fullName} is also on line ${seen.get(user.id)}. Put all capacity profiles for one user on one row.`);
    seen.set(user.id, line);
    const check = checkUser(user, catalog);
    if (!check.ok) return error("user", check.message);

    const names = row.list("capacity_profiles");
    if (!names.length) return error("capacity_profiles", "capacity_profiles is empty. List at least one capacity profile.");
    const profiles: CapacityProfile[] = [];
    names.forEach((name) => {
      const p = findProfile(catalog.profiles, name);
      if (!p.profile) return error("capacity_profiles", p.problem!);
      if (profiles.some((x) => x.id === p.profile!.id)) return error("capacity_profiles", `"${p.profile.name}" is listed more than once on this row.`);
      profiles.push(p.profile);
    });
    items.push(planForUser(user, check.resourceId, profiles, catalog, writer, line));
  });

  return { items, issues, rowCount: csv.records.length };
}

// The selection page: the same capacity profiles for every selected user.
export function buildSelectionPlan(userIds: string[], profiles: CapacityProfile[], catalog: CapacityCatalog, writer: CapacityWriter): Plan {
  const issues: Issue[] = [];
  const items: PlanItem[] = [];
  userIds.forEach((id, index) => {
    const user = catalog.users.find((u) => u.id === id);
    if (!user) return;
    const check = checkUser(user, catalog);
    if (!check.ok) { issues.push({ severity: "error", item: user.fullName, message: check.message }); return; }
    items.push(planForUser(user, check.resourceId, profiles, catalog, writer, index + 1));
  });
  if (!userIds.length) issues.push({ severity: "error", message: "Select at least one user." });
  if (!profiles.length) issues.push({ severity: "error", message: "Select at least one capacity profile." });
  return { items, issues, rowCount: userIds.length };
}
