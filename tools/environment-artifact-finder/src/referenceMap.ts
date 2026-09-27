import { SCAN_SETTINGS } from "./config";
import { EdgeSpec, TableSpec } from "./model";

// The declarative half of the reference-graph engine: which tables are in scope, how each is
// evaluated, and every relationship this tool knows about up front. Relationships for tables with
// no repo-verified schema are NOT listed here as guessed column names — they're discovered from the
// connected environment's relationship metadata at scan time (see scan.ts) and classified using
// each table's `keptAliveBy`. See IMPLEMENTATION_STATUS.md "Step 0" for why.
//
// To switch a table off (e.g. it doesn't exist in your environment and you'd rather not see it in
// the Coverage tab), set `enabled: false`.
export const TABLES: TableSpec[] = [
  // --- Category A: routing configuration --------------------------------------------------------
  {
    logicalName: "msdyn_liveworkstream", label: "Workstream", verification: "verified", enabled: true, check: "rule",
    select: ["msdyn_direction", "msdyn_enablevoicev2"], primaryId: "msdyn_liveworkstreamid", primaryName: "msdyn_name",
    notes: "Evaluated by rules.ts: inactive, no routing, every target queue gone, and (voice only) no channel / channel disabled / no number."
  },
  {
    logicalName: "queue", label: "Queue", verification: "verified", enabled: true, check: "rule",
    select: ["msdyn_isomnichannelqueue"], filter: "msdyn_isomnichannelqueue eq true", primaryId: "queueid", primaryName: "name",
    notes: "Only Omnichannel queues (msdyn_isomnichannelqueue = true). Every user's personal default queue and email/case queues are excluded. Evaluated by rules.ts using routing reachability, not just references."
  },
  {
    logicalName: "msdyn_routingconfiguration", label: "Routing configuration", verification: "verified", enabled: true, check: "generic",
    select: ["msdyn_isactiveconfiguration"], primaryId: "msdyn_routingconfigurationid", primaryName: "msdyn_name",
    notes: "In use when its workstream is active. rules.ts adds: no steps, and superseded (another version is the active one)."
  },
  {
    logicalName: "msdyn_routingconfigurationstep", label: "Routing configuration step", verification: "verified", enabled: true, check: "generic",
    select: ["msdyn_type"], reportBrokenRefs: true, primaryId: "msdyn_routingconfigurationstepid", primaryName: "msdyn_name",
    notes: "In use when its routing configuration is in use. rules.ts adds: a target queue in its rules is deactivated or missing."
  },
  {
    logicalName: "msdyn_decisionruleset", label: "Decision ruleset", verification: "verified", enabled: true, check: "generic",
    select: ["msdyn_rulesetdefinition", "msdyn_disabledrules"], expectedReferencers: ["msdyn_routingconfigurationstep", "queue", "msdyn_assignmentconfigurationstep"],
    primaryId: "msdyn_decisionrulesetid", primaryName: "msdyn_name",
    notes: "In use when referenced by a routing step, a queue's overflow setting, or (discovered) an assignment step. rules.ts adds: no rules / every rule disabled."
  },
  {
    logicalName: "msdyn_overflowactionconfig", label: "Overflow action", verification: "verified", enabled: true, check: "generic",
    select: ["msdyn_overflowactiontype", "msdyn_overflowactiondata"], expectedReferencers: ["msdyn_decisionruleset"],
    primaryId: "msdyn_overflowactionconfigid", primaryName: "msdyn_name",
    notes: "In use when an overflow ruleset's rules point to it (by id, inside the ruleset XML)."
  },
  {
    logicalName: "msdyn_operatinghour", label: "Operating hours", verification: "verified", enabled: true, check: "generic",
    expectedReferencers: ["queue", "msdyn_liveworkstream"], primaryId: "msdyn_operatinghourid", primaryName: "msdyn_name",
    notes: "In use when a queue (verified lookup) or any other in-scope table (discovered) points to it."
  },
  {
    logicalName: "msdyn_ocliveworkstreamcontextvariable", label: "Context variable", verification: "verified", enabled: true, check: "generic",
    select: ["msdyn_name", "msdyn_isdisplayable"], primaryId: "msdyn_ocliveworkstreamcontextvariableid", primaryName: "msdyn_name",
    notes: "In use when its workstream is active. rules.ts adds: never read by any rule condition and not shown to agents."
  },
  {
    logicalName: "msdyn_decisioncontract", label: "Decision contract", verification: "assumed", enabled: true, check: "generic",
    expectedReferencers: ["msdyn_decisionruleset"],
    notes: "Referencing columns are discovered live (typically input/output contract lookups on decision rulesets)."
  },
  {
    logicalName: "msdyn_templateruleset", label: "Template ruleset", verification: "assumed", enabled: true, check: "generic",
    notes: "Referencing columns are discovered live. The 'zero active child rules' part of the brief isn't implemented: the child table is unknown."
  },
  {
    logicalName: "msdyn_assignmentconfiguration", label: "Assignment configuration", verification: "assumed", enabled: true, check: "generic",
    keptAliveBy: ["queue"], expectedReferencers: ["queue"],
    notes: "In use when linked (either direction, discovered) to an active queue. rules.ts adds: no steps (Low confidence — built-in assignment methods may legitimately have none)."
  },
  {
    logicalName: "msdyn_assignmentconfigurationstep", label: "Assignment configuration step", verification: "assumed", enabled: true, check: "generic",
    keptAliveBy: ["msdyn_assignmentconfiguration"], reportBrokenRefs: true,
    notes: "In use when its assignment configuration is in use. Lookups to missing/deactivated capacity profiles, rulesets etc. are reported as broken."
  },
  {
    logicalName: "msdyn_capacityprofile", label: "Capacity profile", verification: "verified", enabled: true, check: "generic",
    expectedReferencers: ["msdyn_bookableresourcecapacityprofile", "msdyn_liveworkstreamcapacityprofile"],
    primaryId: "msdyn_capacityprofileid", primaryName: "msdyn_name",
    notes: "In use when assigned to an agent (verified) or linked to a workstream through msdyn_liveworkstreamcapacityprofile (discovered)."
  },
  {
    logicalName: "msdyn_liveworkstreamcapacityprofile", label: "Workstream capacity profile link", verification: "assumed", enabled: true, check: "generic",
    keptAliveBy: ["msdyn_liveworkstream"], reportBrokenRefs: true,
    notes: "Junction row: in use when its workstream is active; broken when its capacity profile is missing or deactivated."
  },
  {
    logicalName: "characteristic", label: "Skill (characteristic)", verification: "verified", enabled: true, check: "generic",
    expectedReferencers: ["bookableresourcecharacteristic", "msdyn_decisionruleset"], primaryId: "characteristicid", primaryName: "name",
    notes: "In use when assigned to any bookable resource, or mentioned by id in any decision ruleset (skill identification / assignment rules)."
  },
  {
    logicalName: "msdyn_notificationtemplate", label: "Notification template", verification: "assumed", enabled: true, check: "generic",
    expectedReferencers: ["msdyn_liveworkstream", "msdyn_omnichannelconfiguration", "msdyn_soundnotificationsetting"],
    notes: "Referencing columns are discovered live."
  },
  {
    logicalName: "msdyn_soundnotificationsetting", label: "Sound notification setting", verification: "assumed", enabled: true, check: "generic",
    expectedReferencers: ["msdyn_liveworkstream"],
    notes: "Referencing columns are discovered live."
  },
  {
    logicalName: "msdyn_omnichannelconfiguration", label: "Omnichannel configuration", verification: "assumed", enabled: true, check: "rule",
    select: ["modifiedon"],
    notes: "Near-singleton: rules.ts only reports extra (deactivated or older) records when more than one exists."
  },
  {
    logicalName: "msdyn_oclocalizationdata", label: "Localization data", verification: "assumed", enabled: true, check: "generic",
    expectedReferencers: ["msdyn_liveworkstream"],
    notes: "Referencing columns are discovered live."
  },

  // --- Category A: voice channel ---------------------------------------------------------------
  {
    logicalName: "msdyn_ocvoice", label: "Voice channel", verification: "assumed", enabled: true, check: "generic",
    keptAliveBy: ["msdyn_liveworkstream"], flagInactive: true,
    notes: "In use when linked (either direction, discovered) to an active workstream. rules.ts adds: disabled, and no phone/service number attached."
  },
  {
    logicalName: "msdyn_ocvoicechannelsetting", label: "Voice channel setting", verification: "assumed", enabled: true, check: "generic",
    keptAliveBy: ["msdyn_ocvoice", "msdyn_liveworkstream"],
    notes: "In use when its voice channel (or workstream) is in use."
  },
  {
    logicalName: "msdyn_ocvoicechannellanguagesetting", label: "Voice channel language setting", verification: "assumed", enabled: true, check: "generic",
    keptAliveBy: ["msdyn_ocvoicechannelsetting"],
    notes: "In use when its channel setting is in use. The 'language not used by any workstream locale' part of the brief isn't implemented (locale storage unknown)."
  },
  {
    logicalName: "msdyn_ocphonenumber", label: "Phone number (out-of-box)", verification: "assumed", enabled: false, check: "generic",
    keptAliveBy: ["msdyn_ocvoice", "msdyn_liveworkstream"],
    highValueNote: "This may correspond to a real phone number you are billed for.",
    notes: "Candidate addition, disabled by default — enable if your environment stores numbers here rather than in cts_servicenumber."
  },

  // --- Category A: environment-specific (cts_*) — schema entirely discovered live ----------------
  {
    logicalName: "cts_servicenumber", label: "Service number", verification: "custom", enabled: true, check: "generic",
    keptAliveBy: ["msdyn_ocvoice", "msdyn_liveworkstream"], expectedReferencers: ["msdyn_ocvoice", "msdyn_liveworkstream"],
    highValueNote: "This may correspond to a real phone number you are billed for — check with your telephony provider before releasing it.",
    notes: "In use when linked (either direction, discovered) to an active voice channel or workstream."
  },
  {
    logicalName: "cts_contactcenter", label: "Contact center (custom)", verification: "custom", enabled: true, check: "generic",
    flagInactive: true, expectedReferencers: ["msdyn_liveworkstream", "queue"],
    notes: "In use when any in-scope record (discovered) points to it. Deactivated records are also reported."
  },
  {
    logicalName: "cts_openinghour", label: "Opening hours (custom)", verification: "custom", enabled: true, check: "generic",
    notes: "In use when any in-scope record (discovered) points to it."
  },

  // --- Category B: housekeeping ----------------------------------------------------------------
  {
    logicalName: "userquery", label: "Saved view (personal)", verification: "standard", enabled: true, check: "housekeeping",
    select: ["returnedtypecode", "fetchxml", "_ownerid_value"],
    filter: SCAN_SETTINGS.userQueryTables.map((table) => `returnedtypecode eq '${table}'`).join(" or "),
    primaryId: "userqueryid", primaryName: "name",
    notes: "Only views on the Contact Center tables listed in config.ts. No 'last used' signal is available through Dataverse reads."
  },
  {
    logicalName: "bulkdeleteoperation", label: "Bulk-delete job", verification: "standard", enabled: true, check: "housekeeping",
    select: ["statuscode", "isrecurring", "createdon", "modifiedon", "successcount", "failurecount"],
    primaryId: "bulkdeleteoperationid", primaryName: "name",
    notes: "Finished (Completed state), non-recurring jobs older than the threshold in config.ts."
  },

  // --- Supporting reads (evidence only, never reported on) ------------------------------------
  {
    logicalName: "msdyn_ocruleitem", label: "Legacy routing rule", verification: "verified", enabled: true, check: "supporting",
    select: ["msdyn_condition", "msdyn_expression", "msdyn_rulejson"], primaryId: "msdyn_ocruleitemid", primaryName: "msdyn_name",
    notes: "Legacy (pre-unified-routing) rules, so a workstream still using them isn't reported as having no routing."
  },
  {
    logicalName: "queuemembership", label: "Queue membership", verification: "verified", enabled: true, check: "supporting",
    select: ["queueid", "systemuserid"], primaryId: "queuemembershipid",
    notes: "Member counts for the queue checks."
  },
  {
    logicalName: "bookableresourcecharacteristic", label: "Agent skill assignment", verification: "verified", enabled: true, check: "supporting",
    primaryId: "bookableresourcecharacteristicid",
    notes: "An agent holding a skill keeps that characteristic in use."
  },
  {
    logicalName: "msdyn_bookableresourcecapacityprofile", label: "Agent capacity profile assignment", verification: "verified", enabled: true, check: "supporting",
    primaryId: "msdyn_bookableresourcecapacityprofileid",
    notes: "An agent assigned a capacity profile keeps that profile in use."
  },
  {
    logicalName: "systemuser", label: "User (disabled only)", verification: "standard", enabled: true, check: "supporting",
    select: ["isdisabled"], filter: "isdisabled eq true", primaryId: "systemuserid", primaryName: "fullname",
    notes: "Only disabled users are read, to detect saved views owned by a disabled account."
  },
  {
    logicalName: "savedquery", label: "System view (defaults only)", verification: "standard", enabled: true, check: "supporting",
    select: ["returnedtypecode", "fetchxml", "isdefault", "querytype"], filter: "isdefault eq true and querytype eq 0",
    primaryId: "savedqueryid", primaryName: "name",
    notes: "Each table's default public view, to detect personal views that duplicate it."
  }
];

// Relationships known up front. Anything marked "verified" was confirmed live by another toolbox tool
// (see IMPLEMENTATION_STATUS.md "Step 0"); everything else is discovered at scan time.
export const CURATED_EDGES: EdgeSpec[] = [
  { id: "queue.operatinghour", kind: "lookup", from: "queue", field: "msdyn_operatinghourid", to: ["msdyn_operatinghour"], semantics: "reference", verification: "verified", description: "Queue operating hours" },
  { id: "queue.prequeueoverflow", kind: "lookup", from: "queue", field: "msdyn_prequeueoverflowrulesetid", to: ["msdyn_decisionruleset"], semantics: "reference", verification: "verified", description: "Queue pre-queue overflow ruleset" },
  { id: "queue.inqueueoverflow", kind: "lookup", from: "queue", field: "msdyn_inqueueoverflowrulesetid", to: ["msdyn_decisionruleset"], semantics: "reference", verification: "verified", description: "Queue in-queue overflow ruleset" },
  { id: "workstream.defaultqueue", kind: "lookup", from: "msdyn_liveworkstream", field: "msdyn_defaultqueue", to: ["queue"], semantics: "reference", verification: "verified", description: "Workstream fallback queue", expandIdField: "queueid" },
  { id: "routingconfig.workstream", kind: "lookup", from: "msdyn_routingconfiguration", field: "msdyn_liveworkstreamid", to: ["msdyn_liveworkstream"], semantics: "parent", verification: "verified", description: "Routing configuration's workstream" },
  { id: "routingstep.config", kind: "lookup", from: "msdyn_routingconfigurationstep", field: "msdyn_routingconfigurationid", to: ["msdyn_routingconfiguration"], semantics: "parent", verification: "verified", description: "Routing step's routing configuration" },
  { id: "routingstep.ruleset", kind: "lookup", from: "msdyn_routingconfigurationstep", field: "msdyn_rulesetid", to: ["msdyn_decisionruleset"], semantics: "reference", verification: "verified", description: "Routing step's ruleset" },
  { id: "contextvariable.workstream", kind: "lookup", from: "msdyn_ocliveworkstreamcontextvariable", field: "msdyn_liveworkstreamid", to: ["msdyn_liveworkstream"], semantics: "parent", verification: "verified", description: "Context variable's workstream" },
  { id: "ruleitem.workstream", kind: "lookup", from: "msdyn_ocruleitem", field: "msdyn_liveworkstream", to: ["msdyn_liveworkstream"], semantics: "parent", verification: "verified", description: "Legacy routing rule's workstream" },
  { id: "ruleitem.queue", kind: "lookup", from: "msdyn_ocruleitem", field: "msdyn_queueassignid", to: ["queue"], semantics: "reference", verification: "verified", description: "Legacy routing rule's target queue" },
  { id: "ruleitem.cdsqueue", kind: "lookup", from: "msdyn_ocruleitem", field: "msdyn_cdsqueueassignid", to: ["queue"], semantics: "reference", verification: "verified", description: "Legacy routing rule's target queue" },
  { id: "resourceskill.characteristic", kind: "lookup", from: "bookableresourcecharacteristic", field: "characteristic", to: ["characteristic"], semantics: "reference", verification: "verified", description: "Skill assigned to an agent" },
  { id: "resourcecapacity.profile", kind: "lookup", from: "msdyn_bookableresourcecapacityprofile", field: "msdyn_capacityprofileid", to: ["msdyn_capacityprofile"], semantics: "reference", verification: "verified", description: "Capacity profile assigned to an agent" },
  // Content edges: any record id mentioned in a ruleset's XML (queue targets, overflow action ids,
  // skill ids in skill-identification/assignment rules, ...). Record ids are GUIDs and so unique
  // across tables — a mention can't be mistaken for a different record.
  { id: "ruleset.mentions", kind: "content", from: "msdyn_decisionruleset", field: "msdyn_rulesetdefinition", to: ["*"], semantics: "reference", verification: "verified", description: "Mentioned by id in a ruleset's rules" },
  { id: "overflowaction.transferqueue", kind: "content", from: "msdyn_overflowactionconfig", field: "msdyn_overflowactiondata", to: ["queue"], semantics: "reference", verification: "verified", description: "Overflow action's transfer queue" }
];

// Lookups every table has (ownership, auditing, currency, process) — never meaningful as "this
// record uses that one", so they're excluded from relationship discovery.
export const SYSTEM_LOOKUPS = new Set([
  "ownerid", "owninguser", "owningteam", "owningbusinessunit", "createdby", "modifiedby", "createdonbehalfby",
  "modifiedonbehalfby", "transactioncurrencyid", "organizationid", "stageid", "processid", "slaid", "slainvokedid",
  "createdbyexternalparty", "modifiedbyexternalparty"
]);

export function tableSpec(logicalName: string): TableSpec | undefined {
  return TABLES.find((table) => table.logicalName === logicalName);
}

export function tableLabel(logicalName: string): string {
  return tableSpec(logicalName)?.label ?? logicalName;
}

// Tables whose records can receive findings, and so can be the target of a relationship worth tracking.
export function isSubjectTable(spec: TableSpec): boolean {
  return spec.check !== "supporting" && spec.check !== "housekeeping";
}
