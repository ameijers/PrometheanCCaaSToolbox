// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { findOne, readRows } from "../../shared/src/columns";
import { Issue, Plan, PlanItem, PlannedAction } from "../../shared/src/model";
import { RatingValue, SKILL_TYPE, Skill, SkillCatalog, SkillRequest, User, ratingLabel } from "./model";
import { COLUMNS } from "./template";

// Skills are assigned to a user's bookable resource (bookableresourcecharacteristic), with an optional
// rating. For each requested skill:
//   - not assigned yet                       → Assign skill
//   - assigned with the same rating          → in place
//   - assigned with another rating, asked    → Change rating (only the rating is updated)
//   - assigned, no rating asked              → in place (its rating is kept)
// Skills are never removed. Both the CSV and the selection page build their plan with planForUser,
// so they behave the same.

export interface SkillWriter {
  assign(payload: Record<string, unknown>): Promise<string>;
  changeRating(assignmentId: string, ratingId: string): Promise<void>;
}

// Navigation properties are PascalCase (ManyToOneRelationships metadata).
export function assignmentPayload(resourceId: string, skillId: string, ratingId?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    "Resource@odata.bind": `/bookableresources(${resourceId})`,
    "Characteristic@odata.bind": `/characteristics(${skillId})`
  };
  if (ratingId) payload["RatingValue@odata.bind"] = `/ratingvalues(${ratingId})`;
  return payload;
}

export type UserCheck = { ok: true; resourceId: string } | { ok: false; message: string };

// Whether skills can be assigned to this user at all: an enabled, interactive user with an active
// bookable resource.
export function checkUser(user: User, catalog: SkillCatalog): UserCheck {
  if (user.disabled || !user.interactive) return { ok: false, message: `${user.fullName} is disabled or isn't an interactive user.` };
  const resource = catalog.resources.find((r) => r.userId === user.id);
  if (!resource) return { ok: false, message: `${user.fullName} isn't a bookable resource yet, so skills can't be assigned. Run User Setup for this user first.` };
  if (!resource.active) return { ok: false, message: `${user.fullName}'s bookable resource is deactivated.` };
  return { ok: true, resourceId: resource.id };
}

export function planForUser(user: User, resourceId: string, requests: SkillRequest[], catalog: SkillCatalog, writer: SkillWriter, line: number): PlanItem {
  const assignments = catalog.resources.find((r) => r.id === resourceId)?.assignments ?? [];
  const actions: PlannedAction[] = requests.map(({ skill, rating }): PlannedAction => {
    const existing = assignments.find((a) => a.skillId === skill.id);
    const current = existing?.ratingId ? catalog.ratings.find((r) => r.id === existing.ratingId) : undefined;
    const key = `skill:${skill.id}`;
    if (!existing) {
      return { key, label: "Assign skill", target: `${skill.name} — ${ratingLabel(rating)}`, status: "todo", run: () => writer.assign(assignmentPayload(resourceId, skill.id, rating?.id)) };
    }
    if (!rating) return { key, label: "Assign skill", target: `${skill.name} — ${ratingLabel(current)}`, status: "noChange", reason: current ? "Already assigned; no rating asked, so its rating is kept" : "Already assigned" };
    if (existing.ratingId === rating.id) return { key, label: "Assign skill", target: `${skill.name} — ${ratingLabel(rating)}`, status: "noChange", reason: "Already assigned with this rating" };
    return { key, label: "Change rating", target: `${skill.name}: ${ratingLabel(current)} → ${ratingLabel(rating)}`, status: "todo", run: async () => { await writer.changeRating(existing.id, rating.id); } };
  });
  return { key: user.id, line, title: user.fullName, facts: [user.signIn, `Business unit: ${user.businessUnitName}`], actions };
}

// "Good", "good", "3" — a rating name or number. With more than one rating model, a name or number
// can mean several values; "Model / Good" picks one.
export function findRating(ratings: RatingValue[], raw: string): { rating?: RatingValue; problem?: string } {
  const text = raw.trim();
  const [modelPart, valuePart] = text.includes("/") ? text.split("/").map((s) => s.trim()) : [undefined, text];
  const pool = modelPart ? ratings.filter((r) => r.modelName.toLowerCase() === modelPart.toLowerCase()) : ratings;
  const matches = /^\d+$/.test(valuePart) ? pool.filter((r) => r.value === Number(valuePart)) : pool.filter((r) => r.name.toLowerCase() === valuePart.toLowerCase());
  if (matches.length === 1) return { rating: matches[0] };
  if (matches.length > 1) return { problem: `The rating "${raw}" exists in more than one rating model (${[...new Set(matches.map((m) => m.modelName))].join(", ")}). Write it as "Model / ${valuePart}".` };
  const names = [...new Set(ratings.map((r) => `${r.name} (${r.value})`))].join(", ");
  return { problem: `"${raw}" isn't a rating. Use one of: ${names || "— no rating model is active"}.` };
}

export function findSkill(skills: Skill[], name: string): { skill?: Skill; problem?: string } {
  const found = findOne(skills, name, (s) => [s.name]);
  if (found.count > 1) return { problem: `${found.count} skills are named "${name}".` };
  const skill = found.record;
  if (!skill) return { problem: `No skill named "${name}" exists.` };
  if (skill.type !== SKILL_TYPE) return { problem: `"${skill.name}" is a certification, not a skill. This tool assigns skills only.` };
  if (!skill.active) return { problem: `The skill "${skill.name}" is deactivated.` };
  return { skill };
}

// "English:Good" → skill "English", rating "Good". The last colon separates the rating, so a skill name
// with a colon still works when a rating is given.
export function splitSkill(entry: string): { name: string; rating?: string } {
  const i = entry.lastIndexOf(":");
  if (i < 0) return { name: entry.trim() };
  return { name: entry.slice(0, i).trim(), rating: entry.slice(i + 1).trim() || undefined };
}

export function buildCsvPlan(csv: ParsedCsv, catalog: SkillCatalog, writer: SkillWriter): Plan {
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
    if (seen.has(user.id)) return error("user", `${user.fullName} is also on line ${seen.get(user.id)}. Put all skills for one user on one row.`);
    seen.set(user.id, line);
    const check = checkUser(user, catalog);
    if (!check.ok) return error("user", check.message);

    const entries = row.list("skills");
    if (!entries.length) return error("skills", "skills is empty. List at least one skill.");
    const requests: SkillRequest[] = [];
    const bySkill = new Set<string>();
    entries.forEach((entry) => {
      const { name, rating } = splitSkill(entry);
      const s = findSkill(catalog.skills, name);
      if (!s.skill) return error("skills", s.problem!);
      if (bySkill.has(s.skill.id)) return error("skills", `"${s.skill.name}" is listed more than once on this row.`);
      bySkill.add(s.skill.id);
      let ratingValue: RatingValue | undefined;
      if (rating) {
        const r = findRating(catalog.ratings, rating);
        if (!r.rating) return error("skills", `${s.skill.name}: ${r.problem}`);
        ratingValue = r.rating;
      }
      requests.push({ skill: s.skill, rating: ratingValue });
    });
    items.push(planForUser(user, check.resourceId, requests, catalog, writer, line));
  });

  return { items, issues, rowCount: csv.records.length };
}

// The selection page: the same skills (each with its rating, or none) for every selected user.
export function buildSelectionPlan(userIds: string[], requests: SkillRequest[], catalog: SkillCatalog, writer: SkillWriter): Plan {
  const issues: Issue[] = [];
  const items: PlanItem[] = [];
  userIds.forEach((id, index) => {
    const user = catalog.users.find((u) => u.id === id);
    if (!user) return;
    const check = checkUser(user, catalog);
    if (!check.ok) { issues.push({ severity: "error", item: user.fullName, message: check.message }); return; }
    items.push(planForUser(user, check.resourceId, requests, catalog, writer, index + 1));
  });
  if (!userIds.length) issues.push({ severity: "error", message: "Select at least one user." });
  if (!requests.length) issues.push({ severity: "error", message: "Select at least one skill." });
  return { items, issues, rowCount: userIds.length };
}
