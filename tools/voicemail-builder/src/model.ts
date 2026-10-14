// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { IntakeRule } from "./intake";
import { OverflowWanted, RuleChange, Stage } from "./overflow";
import { AssignmentMethod } from "./schema";

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  message: string;
  line?: number;
  column?: string;
  queue?: string;
}

// What's chosen on the page, for the whole file.
export interface Settings {
  // An existing overflow rule for the same condition with another action: change it to voicemail, or
  // leave it and report it.
  existingRules: "overwrite" | "skip";
  assignmentMethod: AssignmentMethod;   // for new voicemail queues
}

// One row of the CSV.
export interface RowSpec {
  line: number;
  queueName: string;
  overflow: OverflowWanted[];
  voicemailWorkstreamName: string;
  voicemailQueueName: string;
  members: string[];
}

export interface ParsedPlan {
  rows: RowSpec[];
  issues: Issue[];
  rowCount: number;
}

// --- what the environment holds ---------------------------------------------------------------------

export interface RulesetRecord { id: string; name: string; definition?: string; }

export interface QueueRecord {
  id: string;
  name: string;
  type: number;
  hasOperatingHours: boolean;
  prequeue?: RulesetRecord;
  inqueue?: RulesetRecord;
  memberIds: string[];
}

export interface WorkstreamRecord { id: string; name: string; record: boolean; hubId?: string; defaultQueueId?: string; }

export interface UserRecord { id: string; fullName: string; signIn: string; email?: string; disabled: boolean; }

export interface Catalog {
  queues: QueueRecord[];
  workstreams: WorkstreamRecord[];
  users: UserRecord[];
  hub?: { id: string; rulesetId?: string; definition?: string };
  voicemailActionId?: string;
  contracts: Partial<Record<"prequeueInput" | "prequeueOutput" | "inqueueInput" | "inqueueOutput", string>>;
}

// --- the plan -----------------------------------------------------------------------------------------

export interface StagePlan {
  stage: Stage;
  ruleset?: RulesetRecord;       // the queue's existing ruleset for this stage; created when absent
  changes: RuleChange[];
  skipped: string[];             // conditions left alone because the existing rule has another action
}

export interface QueuePlan {
  line: number;
  row: RowSpec;
  queue?: QueueRecord;
  voicemailQueue?: QueueRecord;      // reused when it exists
  voicemailWorkstream?: WorkstreamRecord;
  members: UserRecord[];             // added to the voicemail queue (only those not in it yet)
  intake: "add" | "update" | "keep";
  intakeRule?: IntakeRule;           // the existing rule for this queue
  stages: StagePlan[];
  blocked: boolean;
}

export interface ResolvedPlan {
  settings: Settings;
  queues: QueuePlan[];
  issues: Issue[];
  rowCount: number;
  catalog: Catalog;
}

export function errorCount(issues: Issue[]): number {
  return issues.filter((i) => i.severity === "error").length;
}

// --- execution results -------------------------------------------------------------------------------

export type StepStatus = "created" | "updated" | "added" | "failed" | "skipped";

export interface StepResult {
  label: string;
  name: string;
  status: StepStatus;
  id?: string;
  error?: string;
  at?: string;
}

export type QueueOutcome = "done" | "partial" | "failed";

export interface QueueResult {
  name: string;
  queueId?: string;
  outcome: QueueOutcome;
  steps: StepResult[];
  notes: string[];
}
