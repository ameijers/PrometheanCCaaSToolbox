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

export type CopyStatus = "copy" | "blocked";

export interface QueueCopy {
  queue: QueueRow;
  status: CopyStatus;
  reasons: string[];     // why it's blocked
  notes: string[];       // things worth knowing that don't block
  methodName: string;
  method: Record<string, unknown>;
  steps: StepCopy[];
  activate: boolean;
  // Restored by a revert: the method the queue used before.
  before: { strategy: number; activeMethodIds: string[] };
}

export type ApplyStatus = "copied" | "notVerified" | "partial" | "failed";

export interface CopyResult {
  copy: QueueCopy;
  status: ApplyStatus;
  error?: string;
  methodId?: string;
  created: { table: string; id: string; name: string }[];
  activated: boolean;
  at?: string; // ISO time the copy started
}
