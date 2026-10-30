// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

export interface User { id: string; fullName: string; signIn: string; email?: string; disabled: boolean; interactive: boolean; businessUnitName: string; }

// A user's bookable resource, with the capacity profiles linked to it (active msdyn_bookableresourcecapacityprofile rows).
export interface Resource { id: string; userId: string; active: boolean; profileIds: string[]; }

// msdyn_capacityprofile. defaultMaxUnits = how many items of this kind an agent can have at the same time.
export interface CapacityProfile { id: string; name: string; uniqueName?: string; active: boolean; defaultMaxUnits?: number; }

export interface CapacityCatalog {
  users: User[];
  resources: Resource[];
  profiles: CapacityProfile[]; // active and deactivated; only active ones can be assigned
}

export function profileLabel(p: CapacityProfile): string {
  return p.defaultMaxUnits === undefined ? p.name : `${p.name} (${p.defaultMaxUnits} unit${p.defaultMaxUnits === 1 ? "" : "s"})`;
}
