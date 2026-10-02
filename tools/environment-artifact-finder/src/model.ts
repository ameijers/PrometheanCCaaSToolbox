// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// How this tool knows a table or relationship exists in the shape it reads:
// - verified:   confirmed against a live environment by one of the toolbox's other tools (see README).
// - standard:   standard Dataverse platform schema, well documented, but not yet read live by this toolbox.
// - assumed:    named in the product brief; existence and columns unverified — the table degrades to
//               "not available" if missing, and its lookup columns are discovered live, never guessed.
// - custom:     an environment-specific (cts_*) table — same handling as "assumed".
// - discovered: a relationship read from the connected environment's own relationship metadata at scan time.
export type Verification = "verified" | "standard" | "assumed" | "custom" | "discovered";

// A — reference-graph orphans and functional dead-ends. B — housekeeping / usage staleness.
export type Category = "A" | "B";
export type CheckType = "structural" | "functional" | "broken" | "housekeeping";
export type Confidence = "high" | "medium" | "low";

export const CONFIDENCE_LABELS: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low" };
export const CONFIDENCE_ORDER: Confidence[] = ["high", "medium", "low"];
export const CHECK_TYPE_LABELS: Record<CheckType, string> = { structural: "Structural", functional: "Functional", broken: "Broken reference", housekeeping: "Housekeeping" };

// How a table's records are evaluated.
// - generic:      the reference-graph engine's structural check (plus any rule that layers on top).
// - rule:         no generic structural check; rules.ts decides entirely (e.g. queue reachability).
// - housekeeping: Category B checks only (housekeeping.ts).
// - supporting:   read only as evidence for other tables' checks; never produces findings itself.
export type TableCheckMode = "generic" | "rule" | "housekeeping" | "supporting";

export interface TableSpec {
  logicalName: string;
  label: string;
  verification: Verification;
  enabled: boolean;
  check: TableCheckMode;
  // Non-lookup columns this tool reads. Lookup columns come from edges (curated or discovered).
  select?: string[];
  // Server-side OData filter, purely an optimization: every rule re-applies the same condition to
  // the rows it gets, so a data source that ignores it (demo mode) still produces correct results.
  filter?: string;
  // Tables whose linked, in-use records keep this table's records in use — parent/owner
  // relationships. Any lookup FROM this table TO one of these is treated as "belongs to"
  // (parent semantics) rather than "uses" (reference semantics), whichever column it turns out to be.
  keptAliveBy?: string[];
  // Tables expected (per the product brief) to reference this one. If any of them can't be read,
  // a "nothing references this" finding can't be High confidence — see engine.ts.
  expectedReferencers?: string[];
  // Report lookups from this table to missing or deactivated records as broken references.
  reportBrokenRefs?: boolean;
  // Report deactivated records of this table as a functional finding in their own right.
  flagInactive?: boolean;
  // Findings on this table can correspond to something that costs money outside Dataverse.
  highValueNote?: string;
  // Fallbacks when live metadata can't be read (demo mode, or a metadata failure).
  primaryId?: string;
  primaryName?: string;
  notes: string;
}

// "reference": a `from` row uses the `to` record it points at (a queue uses its operating hours).
// "parent":    a `from` row belongs to the `to` record it points at (a routing step belongs to its
//              routing configuration) — the parent keeps the child in use, not the other way round.
export type EdgeSemantics = "reference" | "parent";

export interface EdgeSpec {
  id: string;
  // lookup:  `field` is a lookup attribute's logical name; its value is read from `_<field>_value`.
  // content: `field` is a text column scanned for record ids (e.g. decision-ruleset XML).
  kind: "lookup" | "content";
  from: string;
  field: string;
  // Target tables. "*" (content edges only) means every in-scope table except `from` itself.
  to: string[];
  semantics: EdgeSemantics;
  verification: Verification;
  description: string;
  // For lookups that only come back via $expand (msdyn_liveworkstream.msdyn_defaultqueue).
  expandIdField?: string;
}

export type TableStatus = "ok" | "notFound" | "noPermission" | "error" | "disabled";

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  ok: "Scanned",
  notFound: "Not found in this environment",
  noPermission: "No read permission",
  error: "Could not be read",
  disabled: "Disabled in configuration"
};

export interface RecordRow {
  table: string;
  id: string;
  name: string;
  active: boolean;
  raw: Record<string, unknown>;
}

export interface TableData {
  spec: TableSpec;
  status: TableStatus;
  message?: string;
  primaryId: string;
  primaryName?: string;
  rows: RecordRow[];
  // Columns that were requested but don't exist (or aren't queryable) in this environment.
  droppedColumns: string[];
  // True when a server-side filter limited which rows were read — "not found" in a partial
  // table can mean "exists, but outside the filter", so broken-reference wording must hedge.
  partial: boolean;
  // Whether this table's relationship metadata could be read (drives edge discovery).
  discovery: "ok" | "unavailable" | "notRun";
}

export interface Snapshot {
  mode: "live" | "demo";
  scannedAt: string;
  tables: Record<string, TableData>;
  edges: EdgeSpec[];
  warnings: string[];
}

export type CheckId =
  | "structural.orphan"
  | "structural.onlyInactiveUsers"
  | "structural.usedOnlyByCandidates"
  | "broken.missingTarget"
  | "broken.inactiveTarget"
  | "record.inactive"
  | "queue.noMembersNoRoutes"
  | "queue.unreachable"
  | "workstream.inactive"
  | "workstream.noRouting"
  | "workstream.allTargetsUnreachable"
  | "workstream.voiceNoChannel"
  | "workstream.voiceChannelDisabled"
  | "workstream.voiceNoNumber"
  | "voicechannel.noNumber"
  | "routingconfig.noSteps"
  | "routingconfig.superseded"
  | "routingstep.targetQueueBroken"
  | "ruleset.noRules"
  | "assignmentconfig.noSteps"
  | "contextvariable.unused"
  | "omnichannelconfig.duplicate"
  | "housekeeping.bulkDeleteOld"
  | "housekeeping.userQueryDisabledOwner"
  | "housekeeping.userQueryDuplicatesDefault"
  | "housekeeping.userQueryInactive";

export interface CheckDefinition {
  title: string;
  category: Category;
  checkType: CheckType;
  description: string;
}

// The single registry of every check this tool can report — used by the UI's legend/coverage view,
// the demo-coverage test (every check must be exercised by the sample data) and the README.
export const CHECKS: Record<CheckId, CheckDefinition> = {
  "structural.orphan": { title: "Nothing references it", category: "A", checkType: "structural", description: "No record in any scanned table points to this record through any known relationship." },
  "structural.onlyInactiveUsers": { title: "Only referenced by inactive or detached records", category: "A", checkType: "structural", description: "Something points to this record, but every record that does is deactivated, or itself belongs to nothing active." },
  "structural.usedOnlyByCandidates": { title: "Only used by other cleanup candidates", category: "A", checkType: "structural", description: "Every record that still uses this one is itself flagged by this scan, so it would become unused if those were removed." },
  "broken.missingTarget": { title: "Points to a record that doesn't exist", category: "A", checkType: "broken", description: "A lookup on this record holds the id of a record that couldn't be found (deleted, or outside what you can read)." },
  "broken.inactiveTarget": { title: "Points to a deactivated record", category: "A", checkType: "broken", description: "A lookup on this record points to a record that exists but is deactivated." },
  "record.inactive": { title: "Deactivated but still present", category: "A", checkType: "functional", description: "The record is deactivated, so it can't take part in routing, but it still exists." },
  "queue.noMembersNoRoutes": { title: "Queue with no members and no route to it", category: "A", checkType: "structural", description: "No agent is a member, and no workstream, routing rule, fallback setting or overflow action points to this queue." },
  "queue.unreachable": { title: "No route reaches this queue", category: "A", checkType: "functional", description: "The queue may have members or be mentioned somewhere, but no active workstream's routing (including its fallback queue and overflow transfers) can deliver work to it." },
  "workstream.inactive": { title: "Deactivated workstream", category: "A", checkType: "functional", description: "The workstream is deactivated, so it receives no work, but it and its routing configuration still exist." },
  "workstream.noRouting": { title: "Workstream with no routing", category: "A", checkType: "functional", description: "No routing configuration step, legacy routing rule or fallback queue is configured, so nothing tells work where to go." },
  "workstream.allTargetsUnreachable": { title: "Every routing target is gone", category: "A", checkType: "functional", description: "Every queue this workstream can route to is deactivated or no longer exists." },
  "workstream.voiceNoChannel": { title: "Voice workstream with no voice channel", category: "A", checkType: "functional", description: "The workstream is a voice workstream, but no voice channel record is linked to it." },
  "workstream.voiceChannelDisabled": { title: "Voice workstream whose channel is disabled", category: "A", checkType: "functional", description: "Every voice channel record linked to this workstream is deactivated." },
  "workstream.voiceNoNumber": { title: "Voice workstream with no phone number", category: "A", checkType: "functional", description: "No phone/service number is linked to the workstream or its voice channel, so no call can arrive through it." },
  "voicechannel.noNumber": { title: "Voice channel with no phone number", category: "A", checkType: "functional", description: "No phone/service number is attached to this voice channel record." },
  "routingconfig.noSteps": { title: "Routing configuration with no steps", category: "A", checkType: "functional", description: "The routing configuration belongs to a workstream but contains no steps, so it routes nothing." },
  "routingconfig.superseded": { title: "Superseded routing configuration version", category: "A", checkType: "functional", description: "The workstream has a different routing configuration marked active; this version is kept but unused." },
  "routingstep.targetQueueBroken": { title: "Routing step targets a deactivated or missing queue", category: "A", checkType: "broken", description: "A queue named in this step's routing rules is deactivated or couldn't be found." },
  "ruleset.noRules": { title: "Ruleset with no active rules", category: "A", checkType: "functional", description: "The decision ruleset contains no rules, or every rule in it is disabled, so it never produces an outcome." },
  "assignmentconfig.noSteps": { title: "Assignment configuration with no steps", category: "A", checkType: "functional", description: "The assignment configuration has no steps attached." },
  "contextvariable.unused": { title: "Context variable never used in a rule", category: "A", checkType: "functional", description: "The variable is defined on a workstream, isn't shown to agents, and no routing rule condition reads it." },
  "omnichannelconfig.duplicate": { title: "Extra Omnichannel configuration record", category: "A", checkType: "functional", description: "More than one Omnichannel configuration record exists; this one is deactivated or older than the one in use." },
  "housekeeping.bulkDeleteOld": { title: "Old finished bulk-delete job", category: "B", checkType: "housekeeping", description: "A non-recurring bulk-delete job that finished (succeeded, failed or was canceled) longer ago than the configured threshold." },
  "housekeeping.userQueryDisabledOwner": { title: "Saved view owned by a disabled user", category: "B", checkType: "housekeeping", description: "A personal view on a Contact Center table whose owner's account is disabled." },
  "housekeeping.userQueryDuplicatesDefault": { title: "Saved view identical to the default view", category: "B", checkType: "housekeeping", description: "A personal view whose query is identical to the table's default system view." },
  "housekeeping.userQueryInactive": { title: "Deactivated saved view", category: "B", checkType: "housekeeping", description: "A personal view on a Contact Center table that has been deactivated." }
};

export interface RelatedRecord {
  table: string;
  id: string;
  name: string;
  active: boolean;
  relation: string;
}

export interface Finding {
  id: string;
  checkId: CheckId;
  table: string;
  recordId: string;
  recordName: string;
  category: Category;
  checkType: CheckType;
  confidence: Confidence;
  confidenceReason: string;
  title: string;
  explanation: string;
  evidence: string[];
  nextStep: string;
  related: RelatedRecord[];
  highValueNote?: string;
  // True when the finding means "this record no longer does anything" — records used only by such
  // records are themselves reported (structural.usedOnlyByCandidates). Broken-reference and
  // housekeeping findings don't mark a record dead.
  marksDead: boolean;
}

export function recordKey(table: string, id: string): string {
  return `${table}:${id}`;
}

export function isActive(raw: Record<string, unknown>): boolean {
  // statecode 0 is "Active" for every Dataverse table that has a state; tables without one (or where
  // the column couldn't be read) are treated as active — the conservative choice for this tool.
  return raw.statecode === undefined || raw.statecode === null || raw.statecode === 0;
}

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function normalizeId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const match = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0].toLowerCase() : undefined;
}

export function extractIds(text: unknown): string[] {
  if (typeof text !== "string") return [];
  return [...new Set((text.match(GUID_RE) ?? []).map((id) => id.toLowerCase()))];
}

export function lookupValueKey(attribute: string): string {
  return `_${attribute}_value`;
}
