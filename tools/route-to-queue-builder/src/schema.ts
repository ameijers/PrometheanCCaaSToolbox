// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Every table, column and option value this tool reads or writes, read from the live academyexperiment
// environment's metadata and from a route-to-queue ruleset the admin center created there (see
// IMPLEMENTATION_STATUS.md, "Step 0"). Nothing here is guessed.

export const WORKSTREAM_TABLE = "msdyn_liveworkstream";
export const VARIABLE_TABLE = "msdyn_ocliveworkstreamcontextvariable";
export const CONFIG_TABLE = "msdyn_routingconfiguration";
export const STEP_TABLE = "msdyn_routingconfigurationstep";
export const RULESET_TABLE = "msdyn_decisionruleset";
export const CONTRACT_TABLE = "msdyn_decisioncontract";
export const QUEUE_TABLE = "queue";

// Where each table is in the Web API.
export const ENTITY_SETS: Record<string, string> = {
  [WORKSTREAM_TABLE]: "msdyn_liveworkstreams",
  [VARIABLE_TABLE]: "msdyn_ocliveworkstreamcontextvariables",
  [CONFIG_TABLE]: "msdyn_routingconfigurations",
  [STEP_TABLE]: "msdyn_routingconfigurationsteps",
  [RULESET_TABLE]: "msdyn_decisionrulesets",
  [CONTRACT_TABLE]: "msdyn_decisioncontracts",
  [QUEUE_TABLE]: "queues"
};

// msdyn_ocliveworkstreamcontextvariable.msdyn_datatype
export const TEXT_VARIABLE = 192350000;
export const VARIABLE_TYPE_LABELS: Record<number, string> = { 192350000: "Text", 192350001: "Number", 192350002: "Boolean", 192350100: "Entity Reference" };

// msdyn_routingconfigurationstep.msdyn_type: route-to-queue is the "Queue identification" step.
export const QUEUE_IDENTIFICATION = 192350002;

// msdyn_decisionruleset
export const DECLARATIVE_RULESET = 192350000;
export const DECISION_LIST = 192350000;

// The managed contract every route-to-queue ruleset outputs to. Looked up by name, never by id.
export const QUEUE_OUTPUT_CONTRACT_NAME = "Demand queue identification output contract";

// msdyn_liveworkstream.msdyn_streamsource for voice, and queue.msdyn_queuetype for voice queues.
export const VOICE_STREAM = 192440000;
export const VOICE_QUEUE = 192350002;
export const QUEUE_TYPE_LABELS: Record<number, string> = { 192350002: "Voice", 192350000: "Messaging", 192350001: "Record" };

// The columns each write may carry. dataverse.ts refuses anything else at runtime, and
// tests/writeScope.test.ts pins these lists.
export const CREATE_COLUMNS: Record<string, string[]> = {
  [VARIABLE_TABLE]: [
    "msdyn_name", "msdyn_displayname", "msdyn_datatype", "msdyn_isdisplayable", "msdyn_islist", "msdyn_ismodifiable", "msdyn_issystemdefined",
    "msdyn_liveworkstreamid@odata.bind"
  ],
  [CONFIG_TABLE]: ["msdyn_name", "msdyn_uniquename", "msdyn_isactiveconfiguration", "msdyn_liveworkstreamid@odata.bind"],
  [RULESET_TABLE]: [
    "msdyn_name", "msdyn_uniquename", "msdyn_rulesetdefinition", "msdyn_rulesettype", "msdyn_authoringmode", "msdyn_isinputcollection",
    "msdyn_persistoutputdata", "msdyn_refreshinputdata", "msdyn_inputcontractid@odata.bind", "msdyn_outputcontractid@odata.bind"
  ],
  [STEP_TABLE]: ["msdyn_name", "msdyn_uniquename", "msdyn_type", "msdyn_steporder", "msdyn_routingconfigurationid@odata.bind", "msdyn_rulesetid@odata.bind"]
};
export const UPDATE_COLUMNS: Record<string, string[]> = {
  [RULESET_TABLE]: ["msdyn_rulesetdefinition"]
};
