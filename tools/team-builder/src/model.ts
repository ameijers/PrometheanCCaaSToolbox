export interface BusinessUnit { id: string; name: string; parentId?: string; disabled: boolean; }
export interface User { id: string; fullName: string; signIn: string; email?: string; disabled: boolean; interactive: boolean; }
export interface Role { id: string; name: string; businessUnitId: string; }
export interface Team { id: string; name: string; teamType: number; businessUnitId: string; groupId?: string; roleIds: string[]; }

export interface TeamCatalog {
  businessUnits: BusinessUnit[];
  users: User[];
  roles: Role[];
  teams: Team[];
  currentUserId?: string;
}

// team.teamtype and team.membershiptype option values (from the option sets' own metadata).
export const TEAM_TYPES = { "Owner": 0, "Entra ID security group": 2 } as const;
export type TeamTypeName = keyof typeof TEAM_TYPES;
export const MEMBERSHIP_TYPES = { "Members and guests": 0, "Members": 1, "Owners": 2, "Guests": 3 } as const;
export type MembershipTypeName = keyof typeof MEMBERSHIP_TYPES;
