// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ToolSource } from "../../shared/src/ProvisioningApp";
import { SkillCatalog } from "./model";
import { SkillWriter } from "./plan";

// In-memory sample environment: agents (one already skilled, one not yet a bookable resource), skills
// (one deactivated, one certification) and the 1–5 "Skills Rating Model" as in the reference
// environment. Changes are remembered for the session.

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const RATING = (v: number) => id(700 + v);

const CATALOG: SkillCatalog = {
  users: [
    { id: id(100), fullName: "Anna de Vries", signIn: "anna@contoso.com", email: "anna@contoso.com", disabled: false, interactive: true, businessUnitName: "Sales" },
    { id: id(101), fullName: "Bram Jansen", signIn: "bram@contoso.com", email: "bram@contoso.com", disabled: false, interactive: true, businessUnitName: "Sales" },
    { id: id(102), fullName: "Chris Peters", signIn: "chris@contoso.com", email: "chris@contoso.com", disabled: false, interactive: true, businessUnitName: "Sales" },
    { id: id(103), fullName: "Dana Smit", signIn: "dana@contoso.com", email: "dana.smit@contoso.com", disabled: false, interactive: true, businessUnitName: "Service" }
  ],
  resources: [
    { id: id(400), userId: id(100), active: true, assignments: [{ id: id(800), skillId: id(600), ratingId: RATING(3) }] },
    { id: id(401), userId: id(101), active: true, assignments: [] },
    { id: id(403), userId: id(103), active: true, assignments: [{ id: id(801), skillId: id(600), ratingId: RATING(5) }, { id: id(802), skillId: id(602) }] }
  ],
  skills: [
    { id: id(600), name: "English", active: true, type: 1 },
    { id: id(601), name: "Dutch", active: true, type: 1 },
    { id: id(602), name: "Billing", active: true, type: 1 },
    { id: id(603), name: "Technical support", active: true, type: 1 },
    { id: id(604), name: "Legacy products", active: false, type: 1 },
    { id: id(605), name: "ITIL Foundation", active: true, type: 2 }
  ],
  ratings: ["Poor", "Fair", "Good", "Very Good", "Excellent"].map((name, i) => ({ id: RATING(i + 1), name, value: i + 1, modelName: "Skills Rating Model" }))
};

let catalog: SkillCatalog = JSON.parse(JSON.stringify(CATALOG));
let counter = 1000;

export function resetDemo(): void {
  catalog = JSON.parse(JSON.stringify(CATALOG));
  counter = 1000;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 40));
const bound = (payload: Record<string, unknown>, key: string) => String(payload[key] ?? "").match(/\(([^)]+)\)/)?.[1];

export const demoWriter: SkillWriter = {
  async assign(payload) {
    await pause();
    const newId = id(counter++);
    catalog.resources.find((r) => r.id === bound(payload, "Resource@odata.bind"))?.assignments.push({ id: newId, skillId: bound(payload, "Characteristic@odata.bind")!, ratingId: bound(payload, "RatingValue@odata.bind") });
    return newId;
  },
  async changeRating(assignmentId, ratingId) {
    await pause();
    catalog.resources.forEach((r) => r.assignments.forEach((a) => { if (a.id === assignmentId) a.ratingId = ratingId; }));
  }
};

export const demoSource: ToolSource<SkillCatalog> = {
  mode: "demo",
  environment: "the sample environment",
  async loadCatalog() { return JSON.parse(JSON.stringify(catalog)); },
  recordUrl: () => undefined,
  currentUser: () => "Sample user"
};
