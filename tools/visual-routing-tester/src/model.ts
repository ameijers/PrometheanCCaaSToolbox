export type VariableType = "text" | "number" | "boolean" | "entityReference";
export type VariableOrigin = "ivr" | "queueState";
export type Outcome = "Agent" | "Voicemail" | "Callback" | "Scheduled Callback" | "End Call" | "Transfer to Phone" | "Queue Transfer" | "Remain In Queue";
export type HitPolicy = "first" | "all";

export interface ContextVariable {
  id: string;
  name: string;
  type: VariableType;
  origin: VariableOrigin;
  required?: boolean;
  choices?: string[];
  value?: string | number | boolean;
  usedByRuleIds: string[];
}

export interface Condition {
  variableId: string;
  operator: "equals" | "notEquals" | "contains" | "greaterThan" | "lessThan" | "greaterOrEqual" | "lessOrEqual" | "notNull";
  value: string | number | boolean;
}

// The real "Work classification" stage: enriches/sets attributes on the work item (e.g. a
// priority score). It does not pick a queue — that's a separate, later stage (QueueRoutingRule).
export interface EnrichmentRule {
  id: string;
  name: string;
  order: number;
  hitPolicy: HitPolicy;
  conditionLogic: "AND" | "OR";
  conditions: Condition[];
  enabled: boolean;
  sets: { attribute: string; value: string | number | boolean }[];
}

// One possible destination for a matched queue-routing rule. Most rules have exactly one target
// (weightPercent undefined, i.e. always this one); a percentage-based weighted-distribution action
// produces several targets that share the call randomly by weightPercent (confirmed against real data).
export interface QueueRoutingTarget {
  queueId?: string;
  agentId?: string;
  weightPercent?: number;
}

// The "Route to Queue" stage: picks a destination queue (or, on the legacy path, a specific agent).
export interface QueueRoutingRule {
  id: string;
  name: string;
  order: number;
  hitPolicy: HitPolicy;
  conditionLogic: "AND" | "OR";
  conditions: Condition[];
  targets: QueueRoutingTarget[];
  targetLabel?: string;
  enabled: boolean;
}

export interface OverflowRule {
  id: string;
  name: string;
  trigger: string;
  order: number;
  hitPolicy: HitPolicy;
  conditionLogic: "AND" | "OR";
  conditions: Condition[];
  outcome?: Outcome;
  targetQueueId?: string;
}

// A single weekly operating-hours window, flattened from Dataverse's outer (weekday-recurrence)
// + inner (daily time-of-day) calendar-rule pair into something directly checkable against a
// clock time. weekdays use JS Date.getDay() convention (0 = Sunday .. 6 = Saturday).
export interface OperatingHoursRule {
  timeZoneCode: number;
  weekdays: number[];
  intervalWeeks: number;
  anchorDate: string; // ISO date (yyyy-mm-dd) the recurrence is anchored to, for interval > 1
  startMinutes: number;
  durationMinutes: number;
  validFrom?: string; // ISO date, inclusive
  validTo?: string; // ISO date, inclusive; absent = open-ended
}

export interface Queue {
  id: string;
  name: string;
  assignmentMethod: string;
  preQueueOverflowRules: OverflowRule[];
  inQueueOverflowRules: OverflowRule[];
  operatingHours?: OperatingHoursRule[];
}

export interface Workstream {
  id: string;
  name: string;
  active: boolean;
  variables: ContextVariable[];
  // Real "Work classification" (enrichment) — runs first, can set attributes queue-routing rules condition on.
  classificationRules: EnrichmentRule[];
  // Real "Route to Queue" — runs second, picks the destination queue (or agent).
  queueRoutingRules: QueueRoutingRule[];
  fallbackQueueId?: string;
}

export interface RoutingModel {
  workstreams: Workstream[];
  queues: Queue[];
  warnings: string[];
}

export interface TraceStep {
  id: string;
  kind: "workstream" | "enrichment" | "queueRouting" | "queue" | "overflow" | "outcome" | "warning";
  label: string;
  detail: string;
  status: "evaluated" | "matched" | "skipped" | "warning";
}

export interface SimulationResult {
  steps: TraceStep[];
  outcome?: Outcome;
  queue?: Queue;
  warnings: string[];
}
