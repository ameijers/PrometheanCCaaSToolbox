// Tunables for the checks. Kept separate from referenceMap.ts (which describes the schema) so an
// administrator adapting the tool to their environment has one small file of "policy" to review.
export const SCAN_SETTINGS = {
  // A finished, non-recurring bulk-delete job older than this is reported as housekeeping.
  bulkDeleteAgeDays: 90,

  // Personal views (userquery) are only checked on these tables — never on every table in the org.
  // Tables not present in an environment simply never match.
  userQueryTables: [
    "queue",
    "msdyn_liveworkstream",
    "msdyn_ocliveworkitem",
    "msdyn_ocsession",
    "msdyn_routingconfiguration",
    "msdyn_decisionruleset",
    "msdyn_ocliveworkstreamcontextvariable",
    "msdyn_operatinghour",
    "msdyn_capacityprofile",
    "characteristic",
    "cts_contactcenter",
    "cts_servicenumber",
    "cts_openinghour"
  ],

  // Tables whose records represent a voice channel, and tables whose records represent a phone /
  // service number. The workstream voice checks look for records of these tables linked to the
  // workstream (directly, or through a linked voice channel record) via any known relationship —
  // the relationship columns themselves are discovered live, not named here.
  voiceChannelTables: ["msdyn_ocvoice", "msdyn_ocvoicechannelsetting"],
  phoneNumberTables: ["cts_servicenumber", "msdyn_ocphonenumber"],

  // How many tables are read from Dataverse at the same time.
  readConcurrency: 4
};
