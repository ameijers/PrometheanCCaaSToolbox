export interface User { id: string; fullName: string; signIn: string; email?: string; disabled: boolean; interactive: boolean; }
export interface Resource { userId: string; active: boolean; profileCount: number; }
export interface Queue { id: string; name: string; advanced: boolean; active: boolean; memberIds: string[]; }

export interface MembershipCatalog {
  users: User[];
  resources: Resource[];
  queues: Queue[];
}
