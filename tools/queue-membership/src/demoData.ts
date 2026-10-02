// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ToolSource } from "../../shared/src/ProvisioningApp";
import { MembershipCatalog } from "./model";
import { MembershipWriter } from "./plan";

// In-memory sample environment: users (one not yet a bookable resource, one without capacity profile),
// advanced queues (one deactivated) and a classic queue. Memberships are remembered for the session.

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const CATALOG: MembershipCatalog = {
  users: [
    { id: id(100), fullName: "Anna de Vries", signIn: "anna@contoso.com", email: "anna@contoso.com", disabled: false, interactive: true },
    { id: id(101), fullName: "Bram Jansen", signIn: "bram@contoso.com", email: "bram@contoso.com", disabled: false, interactive: true },
    { id: id(102), fullName: "Chris Peters", signIn: "chris@contoso.com", email: "chris@contoso.com", disabled: false, interactive: true },
    { id: id(103), fullName: "Dana Smit", signIn: "dana@contoso.com", email: "dana.smit@contoso.com", disabled: false, interactive: true }
  ],
  resources: [
    { userId: id(100), active: true, profileCount: 2 },
    { userId: id(101), active: true, profileCount: 1 },
    { userId: id(103), active: true, profileCount: 2 }
  ],
  queues: [
    { id: id(600), name: "Sales – NL", advanced: true, active: true, memberIds: [id(100)] },
    { id: id(601), name: "Sales – Priority customers", advanced: true, active: true, memberIds: [] },
    { id: id(602), name: "Support – Overflow", advanced: true, active: true, memberIds: [] },
    { id: id(603), name: "Support – Chat", advanced: true, active: true, memberIds: [] },
    { id: id(604), name: "Old campaign", advanced: true, active: false, memberIds: [] },
    { id: id(605), name: "<Sales email>", advanced: false, active: true, memberIds: [] }
  ]
};

let catalog: MembershipCatalog = JSON.parse(JSON.stringify(CATALOG));

export function resetDemo(): void {
  catalog = JSON.parse(JSON.stringify(CATALOG));
}

export const demoWriter: MembershipWriter = {
  async addToQueue(queueId, userId) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    catalog.queues.find((q) => q.id === queueId)?.memberIds.push(userId);
  }
};

export const demoSource: ToolSource<MembershipCatalog> = {
  mode: "demo",
  environment: "the sample environment",
  async loadCatalog() { return JSON.parse(JSON.stringify(catalog)); },
  recordUrl: () => undefined,
  currentUser: () => "Sample user"
};
