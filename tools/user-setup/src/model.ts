// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

export interface User {
  id: string;
  fullName: string;
  signIn: string;
  email?: string;
  disabled: boolean;
  interactive: boolean;   // accessmode 0
  businessUnitId: string;
  businessUnitName: string;
  roleIds: string[];
  timeZone?: number;      // from the user's own settings
}
export interface Role { id: string; name: string; businessUnitId: string; }
export interface Team { id: string; name: string; teamType: number; businessUnitName: string; memberIds: string[]; }
export interface Resource { id: string; userId: string; active: boolean; profileIds: string[]; }
export interface CapacityProfile { id: string; name: string; uniqueName?: string; }
export interface TimeZone { code: number; standardName: string; displayName: string; }

export interface UserCatalog {
  users: User[];
  roles: Role[];
  teams: Team[];
  resources: Resource[];
  capacityProfiles: CapacityProfile[];
  timeZones: TimeZone[];
}

// team.teamtype
export const TEAM_TYPE = { owner: 0, access: 1, securityGroup: 2, officeGroup: 3 } as const;
// bookableresource.resourcetype
export const RESOURCE_TYPE_USER = 3;
// The admin center's default capacity profiles for voice agents (msdyn_uniquename).
export const DEFAULT_CAPACITY_PROFILES = ["msdyn_voice_inbound_profile", "msdyn_voice_default_outbound_profile"];
// Fallback when a user has no time zone of their own: UTC.
export const FALLBACK_TIME_ZONE = 92;
