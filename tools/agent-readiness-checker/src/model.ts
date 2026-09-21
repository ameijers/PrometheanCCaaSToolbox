// A single, uniform way to represent "we tried to read this from Dataverse and either got a real
// value or couldn't" — every field on AgentRecord that comes from a table/column this tool isn't
// 100% sure exists in every environment is wrapped in this, so check functions never have to guess
// whether an absence means "confirmed empty" vs "could not be read" (see README's schema-assumptions
// table for which fields are high vs. low confidence).
export type Field<T> = { known: true; value: T } | { known: false; reason: string };

export function known<T>(value: T): Field<T> { return { known: true, value }; }
export function unknownField<T>(reason: string): Field<T> { return { known: false, reason }; }

export type AccessMode = "readWrite" | "administrative" | "read" | "supportUser" | "nonInteractive" | "delegatedAdmin" | "other";

// systemuser.accessmode option set (standard Dataverse): 0 Read-Write, 1 Administrative, 2 Read,
// 3 Support User, 4 Non-interactive, 5 Delegated Admin.
export const ACCESS_MODE_LABELS: Record<AccessMode, string> = {
  readWrite: "Read-Write",
  administrative: "Administrative",
  read: "Read",
  supportUser: "Support User",
  nonInteractive: "Non-interactive (application user)",
  delegatedAdmin: "Delegated Admin",
  other: "Unrecognized access mode"
};

export interface QueueMembershipInfo {
  queueId: string;
  queueName: string;
  queueActive: boolean;
  // True when at least one active inbound-voice workstream's routing configuration actually
  // targets this queue (directly, or as its fallback/no-match queue) — see dataverse.ts.
  reachableByActiveVoiceWorkstream: boolean;
  reachingWorkstreamNames: string[];
}

export interface AgentSkillInfo {
  characteristicId: string;
  name: string;
  proficiencyLabel?: string;
  proficiencyRank?: number;
}

export interface RequiredSkillInfo {
  name: string;
  minProficiencyLabel?: string;
  minProficiencyRank?: number;
}

// Required skills for one queue the agent belongs to, as best-effort-parsed from that queue's
// reaching workstream(s) skill-identification routing step. `required: null` means this tool could
// not determine the requirement (unparseable/absent step, or no reaching workstream) — evaluated as
// "unknown" by the skills check for that queue, never assumed to mean "no requirement".
export interface QueueSkillRequirement {
  queueId: string;
  queueName: string;
  required: RequiredSkillInfo[] | null;
}

export interface PresenceInfo {
  name: string;
  allowsAssignment: boolean | undefined; // undefined = status found, but whether it allows assignment couldn't be determined
  capturedOn?: string; // ISO — presence is a point-in-time snapshot, not historical
}

export interface AgentRecord {
  id: string;
  name: string;
  domainName?: string;
  disabled: Field<boolean>;
  accessMode: Field<AccessMode>;
  securityRoles: Field<string[]>;
  channels: Field<string[]>; // enabled channels, e.g. ["Voice", "Chat"] — see README, low confidence
  queueMemberships: Field<QueueMembershipInfo[]>;
  // systemuser.msdyn_Capacity — a plain whole number directly on the user record. Confirmed live
  // against academyexperiment: there is no separate reusable "capacity profile" entity in this
  // product, despite the name administrators commonly use for this concept. null = no value set.
  agentCapacity: Field<number | null>;
  // msdyn_liveworkstream.msdyn_CapacityRequired (confirmed live, a required whole-number field) —
  // the smallest such value among this agent's reachable voice workstreams. null = none reachable
  // to compare against.
  workItemUnitCost: Field<number | null>;
  skills: Field<AgentSkillInfo[]>;
  queueSkillRequirements: Field<QueueSkillRequirement[]>;
  presence: Field<PresenceInfo | null>; // null = no presence record found for this user
  routingExclusion: Field<boolean>; // true = confirmed excluded/opted out of assignment
}

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

export type CheckCategory =
  | "account"
  | "securityRoles"
  | "channelEnablement"
  | "queueMembership"
  | "workstreamReachability"
  | "capacityProfile"
  | "skills"
  | "presence"
  | "unifiedRoutingState";

export interface CheckResult {
  id: CheckCategory;
  category: CheckCategory;
  status: CheckStatus;
  title: string;
  evidence: string;
  explanation: string;
  suggestedFix?: string;
}

export const CATEGORY_LABELS: Record<CheckCategory, string> = {
  account: "Account",
  securityRoles: "Security roles",
  channelEnablement: "Channel enablement",
  queueMembership: "Queue membership",
  workstreamReachability: "Workstream reachability",
  capacityProfile: "Capacity",
  skills: "Skills",
  presence: "Presence",
  unifiedRoutingState: "Unified routing state"
};

// The order checks are always run and displayed in — "why isn't this agent receiving calls" reads
// top to bottom as a diagnosis funnel: is the account even usable, then can it reach a queue at all,
// then the finer-grained reasons an otherwise-reachable agent still wouldn't get assigned work.
export const CHECK_ORDER: CheckCategory[] = [
  "account",
  "securityRoles",
  "channelEnablement",
  "queueMembership",
  "workstreamReachability",
  "capacityProfile",
  "skills",
  "presence",
  "unifiedRoutingState"
];

export type OverallStatus = "ready" | "warning" | "notReady" | "notVerifiable";

export const OVERALL_STATUS_LABELS: Record<OverallStatus, string> = {
  ready: "Ready",
  warning: "Warning",
  notReady: "Not ready",
  notVerifiable: "Not verifiable"
};

export interface AgentReadiness {
  agentId: string;
  agentName: string;
  domainName?: string;
  overallStatus: OverallStatus;
  checks: CheckResult[];
  failedCount: number;
  warnCount: number;
  unknownCount: number;
  topIssue?: string;
}

export interface ReadinessSummary {
  total: number;
  ready: number;
  warning: number;
  notReady: number;
  notVerifiable: number;
  mostCommonFailingCheck?: { category: CheckCategory; title: string; count: number };
}
