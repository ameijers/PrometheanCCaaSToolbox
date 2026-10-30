// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ToolSource } from "../../shared/src/ProvisioningApp";
import { CapacityCatalog } from "./model";
import { CapacityWriter } from "./plan";

// In-memory sample environment: agents (one with both voice profiles, one with only inbound, two without
// any, one not yet a bookable resource) and the capacity profiles of the reference environment plus a
// chat profile and a deactivated one. Changes are remembered for the session.

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const INBOUND = id(600), OUTBOUND = id(601), ESCALATION = id(602), CHAT = id(603), OLD = id(604);

const CATALOG: CapacityCatalog = {
  users: [
    { id: id(100), fullName: "Anna de Vries", signIn: "anna@contoso.com", email: "anna@contoso.com", disabled: false, interactive: true, businessUnitName: "Sales" },
    { id: id(101), fullName: "Bram Jansen", signIn: "bram@contoso.com", email: "bram@contoso.com", disabled: false, interactive: true, businessUnitName: "Sales" },
    { id: id(102), fullName: "Chris Peters", signIn: "chris@contoso.com", email: "chris@contoso.com", disabled: false, interactive: true, businessUnitName: "Sales" },
    { id: id(103), fullName: "Dana Smit", signIn: "dana@contoso.com", email: "dana.smit@contoso.com", disabled: false, interactive: true, businessUnitName: "Service" },
    { id: id(104), fullName: "Eva Bakker", signIn: "eva@contoso.com", email: "eva@contoso.com", disabled: false, interactive: true, businessUnitName: "Service" }
  ],
  resources: [
    { id: id(400), userId: id(100), active: true, profileIds: [INBOUND, OUTBOUND] },
    { id: id(401), userId: id(101), active: true, profileIds: [] },
    { id: id(403), userId: id(103), active: true, profileIds: [INBOUND] },
    { id: id(404), userId: id(104), active: true, profileIds: [] }
  ],
  profiles: [
    { id: INBOUND, name: "Default voice inbound", uniqueName: "msdyn_voice_inbound_profile", active: true, defaultMaxUnits: 1 },
    { id: OUTBOUND, name: "Default voice outbound", uniqueName: "msdyn_voice_default_outbound_profile", active: true, defaultMaxUnits: 1 },
    { id: ESCALATION, name: "Escalation profile", uniqueName: "msdyn_escalationprofile", active: true, defaultMaxUnits: 1 },
    { id: CHAT, name: "Chat - 3 conversations", uniqueName: "contoso_chat_three", active: true, defaultMaxUnits: 3 },
    { id: OLD, name: "Legacy email", uniqueName: "contoso_legacy_email", active: false, defaultMaxUnits: 5 }
  ]
};

let catalog: CapacityCatalog = JSON.parse(JSON.stringify(CATALOG));
let counter = 1000;

export function resetDemo(): void {
  catalog = JSON.parse(JSON.stringify(CATALOG));
  counter = 1000;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 40));
const bound = (payload: Record<string, unknown>, key: string) => String(payload[key] ?? "").match(/\(([^)]+)\)/)?.[1];

export const demoWriter: CapacityWriter = {
  async link(payload) {
    await pause();
    catalog.resources.find((r) => r.id === bound(payload, "msdyn_bookableresourceid@odata.bind"))?.profileIds.push(bound(payload, "msdyn_capacityprofileid@odata.bind")!);
    return id(counter++);
  }
};

export const demoSource: ToolSource<CapacityCatalog> = {
  mode: "demo",
  environment: "the sample environment",
  async loadCatalog() { return JSON.parse(JSON.stringify(catalog)); },
  recordUrl: () => undefined,
  currentUser: () => "Sample user"
};
