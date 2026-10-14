// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  message: string;
  line?: number;
  column?: string;
  workstream?: string;
}

// What's entered on the page, for the whole file.
export interface Settings {
  variable: string;            // the context variable every rule compares, e.g. SelectedMenuItem
  defaultRulesetName: string;  // for workstreams that have no route-to-queue ruleset yet
}

// One rule from the CSV.
export interface RuleSpec {
  line: number;
  workstream: string;
  ruleName: string;
  menuValue: string;
  queueName: string;
}

export interface ParsedPlan {
  rules: RuleSpec[];
  issues: Issue[];
  rowCount: number;
}

// --- what the environment holds ---------------------------------------------------------------------

export interface VariableRecord { id: string; name: string; dataType: number; }

export interface RulesetRecord {
  id: string;
  name: string;
  definition?: string;   // msdyn_rulesetdefinition; empty on a ruleset without rules
}

export interface RoutingRecord {
  configId: string;
  configName: string;
  stepOrders: number[];            // the orders of every step in the configuration
  queueRuleset?: RulesetRecord;    // the route-to-queue ruleset, when there is one
  queueRulesets: number;           // how many route-to-queue steps the configuration has
}

export interface WorkstreamRecord {
  id: string;
  name: string;
  voice: boolean;
  routingContractId?: string;
  variables: VariableRecord[];
  routing?: RoutingRecord;          // the active routing configuration
  routingInactive?: boolean;        // has routing configurations, but none of them active
}

export interface QueueRecord { id: string; name: string; type: number; }

export interface Catalog {
  workstreams: WorkstreamRecord[];
  queues: QueueRecord[];
  outputContractId?: string;
}

// --- the plan ---------------------------------------------------------------------------------------

export interface ResolvedRule extends RuleSpec {
  queueId?: string;
}

export type RulesetMode = "append" | "newRuleset" | "newConfig";

export interface WorkstreamPlan {
  name: string;
  lines: number[];
  workstream?: WorkstreamRecord;
  createVariable: boolean;
  mode: RulesetMode;
  rulesetName: string;
  rules: ResolvedRule[];
  blocked: boolean;
}

export interface ResolvedPlan {
  settings: Settings;
  workstreams: WorkstreamPlan[];
  issues: Issue[];
  rowCount: number;
  outputContractId?: string;
}

export function errorCount(issues: Issue[]): number {
  return issues.filter((i) => i.severity === "error").length;
}

// --- execution results -------------------------------------------------------------------------------

export type StepStatus = "created" | "updated" | "failed" | "skipped";

export interface StepResult {
  label: string;
  name: string;
  status: StepStatus;
  id?: string;
  error?: string;
  at?: string;
}

export type WorkstreamOutcome = "done" | "partial" | "failed";

export interface WorkstreamResult {
  name: string;
  workstreamId?: string;
  outcome: WorkstreamOutcome;
  steps: StepResult[];
  notes: string[];
  rulesAdded: number;
}
