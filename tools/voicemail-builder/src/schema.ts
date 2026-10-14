// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Every table, column and option value this tool reads or writes, read from the live academyexperiment
// environment's metadata, from overflow rules and a voicemail workstream with its intake rule that the
// admin center created there (see IMPLEMENTATION_STATUS.md, "Step 0"). Nothing here is guessed.

export const QUEUE_TABLE = "queue";
export const WORKSTREAM_TABLE = "msdyn_liveworkstream";
export const RULESET_TABLE = "msdyn_decisionruleset";
export const CONTRACT_TABLE = "msdyn_decisioncontract";
export const HUB_TABLE = "msdyn_masterentityroutingconfiguration";
export const OVERFLOW_ACTION_TABLE = "msdyn_overflowactionconfig";
export const USER_TABLE = "systemuser";

export const ENTITY_SETS: Record<string, string> = {
  [QUEUE_TABLE]: "queues",
  [WORKSTREAM_TABLE]: "msdyn_liveworkstreams",
  [RULESET_TABLE]: "msdyn_decisionrulesets",
  [CONTRACT_TABLE]: "msdyn_decisioncontracts",
  [HUB_TABLE]: "msdyn_masterentityroutingconfigurations",
  [USER_TABLE]: "systemusers"
};

// The queue's lookups to its overflow rulesets. The pre-queue lookup's navigation property is named
// msdyn_decisionrulesetid, not after its column.
export const PREQUEUE_NAV = "msdyn_decisionrulesetid";
export const INQUEUE_NAV = "msdyn_inqueueoverflowrulesetid";
export const MEMBERSHIP_RELATIONSHIP = "queuemembership_association";

// queue.msdyn_queuetype
export const VOICE_QUEUE = 192350002;
export const RECORD_QUEUE = 192350001;
export const QUEUE_TYPE_LABELS: Record<number, string> = { 192350002: "Voice", 192350000: "Messaging", 192350001: "Record" };

// queue.msdyn_assignmentstrategy, with the admin center's names.
export const ASSIGNMENT_METHODS = { "Least active": 192350003, "Highest capacity": 192350000, "Advanced round robin": 192350001 } as const;
export type AssignmentMethod = keyof typeof ASSIGNMENT_METHODS;

// msdyn_liveworkstream.msdyn_streamsource for record workstreams.
export const RECORD_STREAM = 192350000;

// The voicemail record-routing hub: the msdyn_masterentityroutingconfiguration for this table.
export const VOICEMAIL_TABLE = "msdyn_ocvoicemail";

// msdyn_overflowactionconfig.msdyn_overflowactiontype for Voicemail. Every queue's voicemail rule points
// to the one record of this type.
export const VOICEMAIL_ACTION = 192350004;

// The platform's managed contracts for overflow rulesets, looked up by name.
export const PREQUEUE_CONTRACTS = { input: "Queue Overflow Management ruleset input contract", output: "Queue Overflow Management ruleset output contract" };
export const INQUEUE_CONTRACTS = { input: "Inqueue Overflow Management ruleset input contract", output: "Inqueue Overflow Management ruleset output contract" };

export const DECLARATIVE_RULESET = 192350000;
export const DECISION_LIST = 192350000;

// A new voicemail workstream, as the admin center made "Contoso Flags Sales Voicemail": record routing,
// simplified, push, unit-based capacity 30, screen pop with timeout (120 s), all presences.
export const VOICEMAIL_WORKSTREAM_DEFAULTS: Record<string, unknown> = {
  msdyn_streamsource: RECORD_STREAM,
  msdyn_mode: 717210001,
  msdyn_direction: 0,
  msdyn_conversationmode: 192350000,
  msdyn_workdistributionmode: 192350000,
  msdyn_capacityformat: 192350000,
  msdyn_capacityrequired: 30,
  msdyn_allowedpresences: "192360000,192360001,192360002,192360003,192360004",
  msdyn_notification: 100000001,
  msdyn_screenpoptimeout_optionSet: 120,
  msdyn_blockcapacityforwrapup: 1,
  msdyn_enableselectingfrompushbasedworkstreams: true,
  msdyn_enableagentaffinity: false,
  msdyn_restrictdownloadrecording: false,
  msdyn_restrictdownloadtranscript: false
};

// The columns each write may carry. dataverse.ts refuses anything else at runtime, and
// tests/writeScope.test.ts pins these lists.
export const CREATE_COLUMNS: Record<string, string[]> = {
  [QUEUE_TABLE]: ["name", "msdyn_isomnichannelqueue", "msdyn_queuetype", "msdyn_assignmentstrategy", "msdyn_priority", "queueviewtype"],
  [WORKSTREAM_TABLE]: ["msdyn_name", ...Object.keys(VOICEMAIL_WORKSTREAM_DEFAULTS), "msdyn_masterentityroutingconfigurationId@odata.bind", "msdyn_defaultqueue@odata.bind"],
  [RULESET_TABLE]: [
    "msdyn_name", "msdyn_uniquename", "msdyn_rulesetdefinition", "msdyn_rulesettype", "msdyn_authoringmode", "msdyn_isinputcollection",
    "msdyn_persistoutputdata", "msdyn_refreshinputdata", "msdyn_inputcontractid@odata.bind", "msdyn_outputcontractid@odata.bind"
  ]
};
export const UPDATE_COLUMNS: Record<string, string[]> = {
  [RULESET_TABLE]: ["msdyn_rulesetdefinition"],
  [QUEUE_TABLE]: [`${PREQUEUE_NAV}@odata.bind`, `${INQUEUE_NAV}@odata.bind`]
};
