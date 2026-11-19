// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// A custom assignment method as listed on its queue; the steps and rules are read when it's chosen.
export interface MethodSummary {
  id: string;
  name: string;
  active: boolean;
}

// One advanced queue with the assignment method it uses now.
export interface QueueRow {
  id: string;
  name: string;
  type: number;          // msdyn_queuetype
  strategy: number;      // msdyn_assignmentstrategy
  inputContractId?: string; // msdyn_assignmentinputcontractid, the queue's own decision contract
  methods: MethodSummary[];
}

export interface Ruleset {
  id: string;
  name: string;
  description?: string;
  definition: string;    // msdyn_rulesetdefinition (XML)
  rulesetType: number;
  authoringMode?: number;
  inputContractId?: string;
  outputContractId?: string;
  isInputCollection: boolean;
  persistOutputData: boolean;
  refreshInputData: boolean;
  disabledRules?: string;
}

export interface MethodStep {
  id: string;
  name: string;
  type: number;          // msdyn_type
  order: number;
  isDefault: boolean;
  ruleset?: Ruleset;
}

export interface Method {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  queueId: string;
  steps: MethodStep[];
}

// What will be written for one target queue. Payloads are complete except for the ids of records this
// same copy creates first (the method's id on its steps, each ruleset's id on its step).
export interface StepCopy {
  ruleset: Record<string, unknown>;
  step: Record<string, unknown>;
  sourceDefinition: string;
  ruleIds: Record<string, string>; // source rule id -> the copy's rule id
}

// copy: a new method is added. update: a method already on the queue is brought in line with the
// source. upToDate: a method already on the queue matches the source and is in use as asked.
export type CopyStatus = "copy" | "update" | "upToDate" | "blocked";

// How a method already on the target queue is recognised as "the same method".
export interface MatchOptions {
  byName: boolean;   // a method with the same name
  byRules: boolean;  // a method with the same rules (conditions and actions; rule ids and names aside)
}

// What happens to the rules of one ruleset, by rule name.
export interface RuleChanges {
  added: string[];
  changed: string[];
  removed: string[];
}

// One existing ruleset rewritten to match the source, or emptied before the copy.
export interface RulesetUpdate {
  rulesetId: string;
  name: string;
  stepType: number;
  methodId?: string;     // set when it's emptied: the method it belongs to
  methodName?: string;
  columns: Record<string, unknown>;  // msdyn_rulesetdefinition and msdyn_disabledrules
  before: Record<string, unknown>;   // the same columns as they were, written back by an undo
  changes: RuleChanges;
}

export interface ExistingMethod {
  id: string;
  name: string;
  matchedBy: "name" | "rules";
  updates: RulesetUpdate[];
  unchanged: string[];   // rulesets that already match
  extra: string[];       // rulesets the source doesn't have; left as they are
}

export interface QueueCopy {
  queue: QueueRow;
  status: CopyStatus;
  reasons: string[];     // why it's blocked
  notes: string[];       // things worth knowing that don't block
  methodName: string;
  method: Record<string, unknown>;
  // For a copy: every ruleset with its step. For an update: the rulesets the existing method lacks.
  steps: StepCopy[];
  existing?: ExistingMethod;
  // Rulesets on the queue emptied before the copy ("remove all assignment rules first").
  cleared: RulesetUpdate[];
  // The queue is switched to the method (the copy, or the existing one when it isn't in use yet).
  activate: boolean;
  // Restored by an undo: the method the queue used before.
  before: { strategy: number; activeMethodIds: string[] };
}

export type ApplyStatus = "copied" | "notVerified" | "partial" | "failed";

export interface CopyResult {
  copy: QueueCopy;
  status: ApplyStatus;
  error?: string;
  methodId?: string;
  created: { table: string; id: string; name: string }[];
  updated: { id: string; name: string }[];  // rulesets rewritten
  activated: boolean;
  at?: string; // ISO time the copy started
}
