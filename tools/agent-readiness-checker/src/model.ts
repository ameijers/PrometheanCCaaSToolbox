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

// Required skills for one queue the agent belongs to. `required: []` is used both for "confirmed no
// skill requirement" (the queue's reaching workstream(s) have no Skill identification routing step
// at all — confirmed live against academyexperiment, see IMPLEMENTATION_STATUS.md "Round 7": a step
// type that's simply absent from a workstream's active routing configuration means unified routing
// never attempts to skill-match work for it) and for "a skill-identification step exists but named no
// skills" (a real, if less common, admin configuration). `required: null` means a skill-identification
// step exists but this tool's best-effort ruleset parser couldn't extract a structured requirement
// from it — evaluated as "unknown" by the skills check for that queue, never assumed to mean "no
// requirement".
export interface QueueSkillRequirement {
  queueId: string;
  queueName: string;
  required: RequiredSkillInfo[] | null;
}

export interface PresenceInfo {
  name: string;
  // msdyn_agentstatus.msdyn_isagentloggedin — confirmed live: whether the agent's workspace client
  // is currently connected, independent of what their last-known presence label says. undefined if
  // this tool couldn't read it.
  isLoggedIn: boolean | undefined;
  allowsAssignment: boolean | undefined; // undefined = status found, but whether it allows assignment couldn't be determined
  capturedOn?: string; // ISO — presence is a point-in-time snapshot, not historical
}

// One capacity-profile assignment on the agent's bookableresource (via the
// msdyn_bookableresourcecapacityprofile join table — confirmed live against academyexperiment).
// Profiles are per-channel (e.g. "Default voice inbound" / "Default voice outbound" were both
// observed on the same real agent), which is why an agent can have several of these, not just one
// flat number — systemuser.msdyn_capacity, this tool's first two guesses, doesn't reflect this at
// all and was confirmed to sit outside this relationship entirely.
export interface CapacityProfileAssignment {
  profileName: string;
  // The join row's own msdyn_maxunits if set, else the profile's own msdyn_defaultmaxunits, else
  // null if neither carries a value — never silently defaulted to 0, since an unset value and a
  // deliberately-zero one mean different things.
  effectiveUnits: number | null;
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
  // This agent's capacity-profile assignments (see CapacityProfileAssignment) — an empty array
  // means confirmed no profile assigned at all, not "couldn't read".
  agentCapacity: Field<CapacityProfileAssignment[]>;
  // msdyn_liveworkstream.msdyn_capacityrequired — but ONLY from reachable workstreams using the
  // "Unit based" capacity format (msdyn_capacityformat), confirmed live to be one of two real
  // values on this field: "Unit based" (numeric comparison applies) or "Profile based" (it doesn't
  // — see hasProfileBasedReachableWorkstream). null = no reachable *unit-based* workstream to
  // compare against, which is a different situation from "nothing reachable at all" — see below.
  workItemUnitCost: Field<number | null>;
  // True if at least one reachable voice workstream uses the "Profile based" capacity format,
  // confirmed live against academyexperiment (a real environment where ALL inbound voice
  // workstreams used this format — a real agent's own capacity check was reporting a false
  // failure, comparing their capacity against an unrelated "Unit based" threshold that doesn't
  // apply under this format). Under "Profile based", a non-zero capacity-profile assignment is
  // sufficient on its own; no numeric comparison against workItemUnitCost is meaningful.
  hasProfileBasedReachableWorkstream: Field<boolean>;
  skills: Field<AgentSkillInfo[]>;
  queueSkillRequirements: Field<QueueSkillRequirement[]>;
  presence: Field<PresenceInfo | null>; // null = no presence record found for this user
  // msdyn_agentstatus.msdyn_isblockedbysomeprofile — confirmed live against academyexperiment (see
  // IMPLEMENTATION_STATUS.md "Round 7"): true means unified routing currently won't assign this agent
  // ANY new work because they've hit the ceiling of every capacity profile assigned to them, even
  // though everything else about their setup is correct. This is a live, point-in-time condition (like
  // presence) that clears on its own as their active work drops — distinct from capacityProfile above,
  // which checks whether a big-enough profile is assigned at all, not their current utilization against
  // it. No separate "explicitly excluded/opted out" admin toggle was ever found to exist in this
  // product (searched broadly across systemuser/bookableresource for anything matching
  // exclu/optout/workdistribution/routing-related names — nothing besides GDPR opt-out turned up) —
  // this field is the closest defensible, live signal for "currently not receiving new work" that this
  // tool could verify.
  capacityBlocked: Field<boolean>;
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
  evidence: string; // full sentence — always populated, used verbatim in CSV/Markdown export
  // Optional structured breakdown of `evidence` for checks whose evidence is naturally a list
  // (roles, channels, queues, skills) — the UI renders this as a bullet list instead of the prose
  // sentence when present; undefined for checks where a single short sentence reads better as-is.
  evidenceItems?: string[];
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
