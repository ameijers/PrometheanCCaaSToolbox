// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Every table, column and option value this tool reads or writes, read from the live academyexperiment
// environment's metadata and from a custom assignment method the admin center created there (see
// IMPLEMENTATION_STATUS.md, "Step 0"). Nothing here is guessed.

export const QUEUE_TABLE = "queue";
export const METHOD_TABLE = "msdyn_assignmentconfiguration";
export const STEP_TABLE = "msdyn_assignmentconfigurationstep";
export const RULESET_TABLE = "msdyn_decisionruleset";

export const QUEUE_SET = "queues";
export const METHOD_SET = "msdyn_assignmentconfigurations";
export const STEP_SET = "msdyn_assignmentconfigurationsteps";
export const RULESET_SET = "msdyn_decisionrulesets";
export const CONTRACT_SET = "msdyn_decisioncontracts";

// Where each table is written in the Web API.
export const ENTITY_SETS: Record<string, string> = { [QUEUE_TABLE]: QUEUE_SET, [METHOD_TABLE]: METHOD_SET, [STEP_TABLE]: STEP_SET, [RULESET_TABLE]: RULESET_SET };

// msdyn_queuetype
export const QUEUE_TYPE_LABELS: Record<number, string> = { 192350002: "Voice", 192350000: "Messaging", 192350001: "Record" };

// msdyn_assignmentstrategy, with the admin center's names for the built-in methods.
export const CUSTOM_STRATEGY = 192350002;
export const STRATEGY_LABELS: Record<number, string> = {
  192350003: "Least active", 192350000: "Highest capacity", 192350001: "Advanced round robin", 192350002: "Custom", 192350005: "No assignment"
};

// msdyn_assignmentconfigurationstep.msdyn_type
export const STEP_TYPE_LABELS: Record<number, string> = { 192350000: "Prioritization", 192350001: "Assignment rule selection", 192350002: "Assignment" };

// msdyn_decisionruleset.msdyn_rulesettype: only rule-based (declarative) rulesets are copied.
export const DECLARATIVE_RULESET = 192350000;

// The columns each write may carry. dataverse.ts refuses anything else at runtime, and
// tests/writeScope.test.ts pins these lists.
export const CREATE_COLUMNS: Record<string, string[]> = {
  [RULESET_TABLE]: [
    "msdyn_name", "msdyn_uniquename", "msdyn_description", "msdyn_rulesetdefinition", "msdyn_rulesettype", "msdyn_authoringmode", "msdyn_isinputcollection",
    "msdyn_persistoutputdata", "msdyn_refreshinputdata", "msdyn_disabledrules", "msdyn_inputcontractid@odata.bind", "msdyn_outputcontractid@odata.bind"
  ],
  [METHOD_TABLE]: ["msdyn_name", "msdyn_uniquename", "msdyn_description", "msdyn_isactiveconfiguration", "msdyn_queueid@odata.bind"],
  [STEP_TABLE]: ["msdyn_name", "msdyn_uniquename", "msdyn_type", "msdyn_steporder", "msdyn_isdefaultruleset", "msdyn_assignmentconfigurationid@odata.bind", "msdyn_rulesetid@odata.bind"]
};
export const UPDATE_COLUMNS: Record<string, string[]> = {
  [METHOD_TABLE]: ["msdyn_isactiveconfiguration"],
  [QUEUE_TABLE]: ["msdyn_assignmentstrategy"]
};
