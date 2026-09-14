import { Condition, ContextVariable, EnrichmentRule, OperatingHoursRule, Outcome, OverflowRule, Queue, QueueRoutingRule, QueueRoutingTarget, RoutingModel, Workstream } from "./model";
import { ParsedCondition, ParsedDecision, ParsedRule, parseDecisionXml } from "./ruleXml";

declare const Xrm: any;

// As a web resource, this control may run as the top-level page (Xrm on window) or embedded via
// IFRAME on a form/dashboard (Xrm only on the parent/top window) — check both.
function resolveXrm(): any {
  if (typeof Xrm !== "undefined" && Xrm?.WebApi) return Xrm;
  if (typeof window === "undefined") return undefined;
  const w = window as any;
  if (w.parent && w.parent !== w && w.parent.Xrm?.WebApi) return w.parent.Xrm;
  if (w.top && w.top !== w && w.top.Xrm?.WebApi) return w.top.Xrm;
  return undefined;
}

interface EntityDefinition {
  LogicalName: string;
  EntitySetName: string;
  PrimaryIdAttribute?: string;
  PrimaryNameAttribute?: string;
}

const definitions = [
  { logicalName: "msdyn_liveworkstream", setName: "msdyn_liveworkstreams" },
  { logicalName: "msdyn_ocliveworkstreamcontextvariable", setName: "msdyn_ocliveworkstreamcontextvariables" },
  { logicalName: "msdyn_ocruleitem", setName: "msdyn_ocruleitems" },
  { logicalName: "queue", setName: "queues" },
  { logicalName: "msdyn_decisionruleset", setName: "msdyn_decisionrulesets" },
  { logicalName: "msdyn_routingconfiguration", setName: "msdyn_routingconfigurations" },
  { logicalName: "msdyn_routingconfigurationstep", setName: "msdyn_routingconfigurationsteps" },
  { logicalName: "msdyn_overflowactionconfig", setName: "msdyn_overflowactionconfigs" },
  { logicalName: "msdyn_operatinghour", setName: "msdyn_operatinghours" },
  { logicalName: "calendar", setName: "calendars" }
];

// Routing-configuration-step type codes, confirmed against a live Contact Center environment.
const STEP_TYPE_ENRICHMENT = 192350000; // The real "Work classification" stage.
const STEP_TYPE_QUEUE_IDENTIFICATION = 192350002; // "Route to Queue".
const STEP_TYPE_ASSIGNMENT_LIKE = new Set([192350001, 192350003]); // Skill identification, Agent Group identification

async function findDefinition(logicalName: string): Promise<EntityDefinition> {
  const xrm = resolveXrm();
  if (!xrm) throw new Error("This app must run inside a Dataverse model-driven app (as a web resource on a form, dashboard, or sitemap page).");
  const fallback = definitions.find((definition) => definition.logicalName === logicalName);
  try {
    const result = await xrm.WebApi.retrieveMultipleRecords("EntityDefinitions", `?$select=LogicalName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute&$filter=LogicalName eq '${logicalName}'`);
    return result.entities[0] ?? { LogicalName: logicalName, EntitySetName: fallback?.setName ?? `${logicalName}s` };
  } catch {
    return { LogicalName: logicalName, EntitySetName: fallback?.setName ?? `${logicalName}s` };
  }
}

// `error instanceof Error` is unreliable here: Xrm is accessed via window.parent (iframe hosting),
// so errors it throws belong to the parent window's realm, where our Error constructor doesn't match.
function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

function missingPropertyName(message: string): string | undefined {
  return message.match(/property named '([^']+)'/i)?.[1];
}

function classifyError(logicalName: string, error: unknown): Error {
  const message = errorMessage(error);
  if (/0x80040220|privilege|permission denied|access is denied/i.test(message)) {
    return new Error(`You don't have permission to read “${logicalName}” records. Ask your Dataverse administrator for read access to this table. (${message})`);
  }
  // A missing *property* just means one column isn't queryable this way in this environment/API
  // version — it says nothing about the table itself, so it must not be classified as "not configured".
  if (missingPropertyName(message)) {
    return new Error(`Unable to read “${logicalName}”: ${message}`);
  }
  if (/could not find|does not exist|invalid entity|resource not found|entitydefinition/i.test(message)) {
    return new Error(`This environment does not appear to have Contact Center unified routing configured (the “${logicalName}” table was not found). (${message})`);
  }
  return new Error(`Unable to read “${logicalName}”: ${message}`);
}

async function read(logicalName: string, query: string): Promise<any[]> {
  const definition = await findDefinition(logicalName);
  try {
    const result = await resolveXrm().WebApi.retrieveMultipleRecords(definition.LogicalName, query);
    return result.entities;
  } catch (error) {
    throw classifyError(logicalName, error);
  }
}

// Converts a UTC instant to the wall-clock time in a Dataverse timezone (by its integer
// TimeZoneCode), via Dataverse's own LocalTimeFromUtcTime unbound function — this is the only
// reliable way to get a DST-correct local time for a calendar's timezone without shipping a
// Windows-timezone-id -> offset table and guessing. Xrm.WebApi has no helper for unbound functions,
// so this calls the Web API endpoint directly; the browser's existing session cookie (the same one
// backing Xrm.WebApi) authenticates it since it's a same-origin request.
export async function resolveLocalTime(timeZoneCode: number, utcTime: Date): Promise<Date | undefined> {
  const xrm = resolveXrm();
  const clientUrl = xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.();
  if (!clientUrl) return undefined;
  try {
    const iso = utcTime.toISOString().replace(/\.\d+Z$/, "Z");
    const response = await fetch(`${clientUrl}/api/data/v9.2/LocalTimeFromUtcTime(UtcTime=${iso},TimeZoneCode=${timeZoneCode})`, {
      credentials: "include",
      headers: { Accept: "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" }
    });
    if (!response.ok) return undefined;
    const body = await response.json();
    return typeof body.LocalTime === "string" ? new Date(body.LocalTime) : undefined;
  } catch {
    return undefined;
  }
}

// Some selected columns are newer/optional and may not be queryable in every environment or API
// version even when confirmed present in metadata. Drop just the offending column and retry rather
// than letting one missing field take down the whole read (and everything downstream of it).
async function readSelect(logicalName: string, fields: string[], filter: string | undefined, warnings: string[]): Promise<any[]> {
  let remaining = [...fields];
  for (;;) {
    const query = `?$select=${remaining.join(",")}${filter ? `&$filter=${filter}` : ""}`;
    try {
      return await read(logicalName, query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = missingPropertyName(message);
      if (missing && remaining.includes(missing)) {
        warnings.push(`“${logicalName}” does not have a “${missing}” column in this environment; related data will be skipped.`);
        remaining = remaining.filter((field) => field !== missing);
        continue;
      }
      throw error;
    }
  }
}

function asArray(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function cleanGuid(raw: string): string { return raw.replace(/[{}]/g, "").trim(); }

function variableType(value: unknown): ContextVariable["type"] {
  // msdyn_ocliveworkstreamcontextvariable.msdyn_datatype: 192350000 Text, 192350001 Number, 192350002 Boolean, 192350100 Entity Reference.
  if (value === 192350001) return "number";
  if (value === 192350002) return "boolean";
  if (value === 192350100) return "entityReference";
  if (value === 192350000) return "text";
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized.includes("bool")) return "boolean";
    if (normalized.includes("number") || normalized.includes("int") || normalized.includes("decimal")) return "number";
    if (normalized.includes("entity") || normalized.includes("reference")) return "entityReference";
  }
  return "text";
}

// System attributes exposed by the routing engine itself (queue wait time / capacity / operating
// hours) rather than caller-supplied context variables. Confirmed from real overflow ruleset XML.
const QUEUE_STATE_FIELDS: Record<string, { label: string; type: "number" | "boolean" }> = {
  // "prequeue" fields are a live forecast checked BEFORE the caller joins the queue — e.g. "if this
  // caller joined right now, how long would they be predicted to wait" — not a delay before joining.
  "queue_prequeue.estimatedwaittimeinminutes": { label: "Predicted wait time if the caller joins now (minutes)", type: "number" },
  "queue_prequeue.currentqueuesize": { label: "Current queue size before joining", type: "number" },
  "queue_prequeue.iswithinoperatinghour": { label: "Within operating hours", type: "boolean" },
  // "inqueue" fields are the caller's own actual elapsed time, checked periodically once already waiting.
  "queue_inqueue.lapsedwaittime": { label: "Time already waited in this queue (seconds)", type: "number" }
};

// Simulated overflow inputs are per-queue, not shared across the workstream: a call can overflow
// from one queue into another (Queue Transfer), and each queue's wait time/size/hours are its own.
export function queueStateVariables(queue: Queue): ContextVariable[] {
  const rules = [...queue.preQueueOverflowRules, ...queue.inQueueOverflowRules];
  const variableIds = [...new Set(rules.flatMap((rule) => rule.conditions.map((condition) => condition.variableId)))];
  return variableIds.map((variableId) => {
    const known = QUEUE_STATE_FIELDS[variableId];
    const usedByRuleIds = rules.filter((rule) => rule.conditions.some((condition) => condition.variableId === variableId)).map((rule) => rule.id);
    return { id: variableId, name: known?.label ?? variableId, type: known?.type ?? "text", origin: "queueState", usedByRuleIds };
  });
}

// Custom context variables are referenced as "liveworkitemcontext.<Name>"; system work-item fields
// use "msdyn_ocliveworkitem.<name>" — both confirmed against real condition XML.
const WORKITEM_PREFIXES = ["msdyn_ocliveworkitem.", "liveworkitemcontext."];

const OPERATOR_MAP: Record<string, Condition["operator"]> = {
  "==": "equals", "=": "equals", "!=": "notEquals", "<>": "notEquals",
  ">": "greaterThan", "<": "lessThan", ">=": "greaterOrEqual", "<=": "lessOrEqual",
  "not-null": "notNull", "notnull": "notNull", "contains": "contains"
};

function coerceValue(raw: string | undefined): string | number | boolean {
  if (raw === undefined) return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function stripWorkItemPrefix(lhs: string): string {
  const prefix = WORKITEM_PREFIXES.find((candidate) => lhs.startsWith(candidate));
  return prefix ? lhs.slice(prefix.length) : lhs;
}

function buildConditions(parsed: ParsedCondition[], warnings: string[], ruleLabel: string, normalizeVariableId: (lhs: string) => string): Condition[] {
  return parsed.map((condition) => {
    let operator = OPERATOR_MAP[condition.operator.toLowerCase()];
    if (!operator) { warnings.push(`Rule “${ruleLabel}” uses an unsupported condition operator “${condition.operator}”; treated as equals.`); operator = "equals"; }
    return { variableId: normalizeVariableId(condition.lhs), operator, value: coerceValue(condition.rhs) };
  });
}

function parseDisabledRuleIds(raw: unknown): Set<string> {
  if (typeof raw !== "string" || !raw.trim()) return new Set();
  try { return new Set(asArray(JSON.parse(raw)).map(String)); } catch { /* fall through */ }
  return new Set(raw.split(/[,\s]+/).filter(Boolean));
}

function decisionOf(ruleset: any, kind: string, warnings: string[]): ParsedDecision | undefined {
  const parsed = parseDecisionXml(ruleset?.msdyn_rulesetdefinition);
  if (parsed === null && ruleset?.msdyn_rulesetdefinition) {
    warnings.push(`${kind} ruleset “${ruleset.msdyn_name ?? ruleset.msdyn_decisionrulesetid}” has an unsupported definition shape; its rules were not evaluated.`);
  }
  return parsed ?? undefined;
}

// The real "Work classification" stage: enriches attributes on the work item. Any setattribute
// action counts (not just a specific known one), since enrichment can set arbitrary attributes.
function parseEnrichmentRuleset(ruleset: any, orderOffset: number, warnings: string[]): EnrichmentRule[] {
  const decision = decisionOf(ruleset, "Classification", warnings);
  if (!decision) return [];
  const disabled = parseDisabledRuleIds(ruleset?.msdyn_disabledrules);
  return decision.rules.map((rule: ParsedRule, index: number): EnrichmentRule => ({
    id: rule.id,
    name: rule.name,
    order: orderOffset + index,
    hitPolicy: decision.hitPolicy,
    conditionLogic: rule.conditionLogic,
    conditions: buildConditions(rule.conditions, warnings, rule.name, stripWorkItemPrefix),
    enabled: !disabled.has(rule.id),
    sets: rule.setAttributes.map((sa) => ({ attribute: stripWorkItemPrefix(sa.lhs), value: coerceValue(sa.rhs) }))
  }));
}

// A rule's action is either a single setattribute (assign_to.queue / assign_to.user) or a
// percentage-based weighted distribution across several queues (<upsertrecords><records><record>
// holding queuedetails.queueid + queuedetails.percentage per record — confirmed against real data).
function parseTargets(rule: ParsedRule, warnings: string[]): QueueRoutingTarget[] {
  if (rule.distributionRecords.length) {
    return rule.distributionRecords.map((record) => {
      const queueId = record.find((sa) => sa.lhs === "queuedetails.queueid");
      const percentage = record.find((sa) => sa.lhs === "queuedetails.percentage");
      if (!queueId) warnings.push(`Queue-routing rule “${rule.name}” has a weighted-distribution entry with no queue id and was skipped.`);
      return { queueId: queueId ? cleanGuid(queueId.rhs) : undefined, weightPercent: percentage ? Number(percentage.rhs) : undefined };
    }).filter((target) => target.queueId);
  }
  const queueAssign = rule.setAttributes.find((sa) => sa.lhs === "assign_to.queue");
  const agentAssign = rule.setAttributes.find((sa) => sa.lhs === "assign_to.user" || sa.lhs === "assign_to.agent");
  if (!queueAssign && !agentAssign && rule.setAttributes.length) {
    warnings.push(`Queue-routing rule “${rule.name}” has an action this tool doesn't recognize (“${rule.setAttributes[0].lhs}”) and was not evaluated for routing.`);
    return [];
  }
  if (queueAssign) return [{ queueId: cleanGuid(queueAssign.rhs) }];
  if (agentAssign) return [{ agentId: cleanGuid(agentAssign.rhs) }];
  return [];
}

// The "Route to Queue" stage: picks a destination queue (possibly one of several weighted options),
// or (legacy path only) a specific agent.
function parseQueueRoutingRuleset(ruleset: any, orderOffset: number, warnings: string[]): QueueRoutingRule[] {
  const decision = decisionOf(ruleset, "Queue-routing", warnings);
  if (!decision) return [];
  const disabled = parseDisabledRuleIds(ruleset?.msdyn_disabledrules);
  return decision.rules.map((rule: ParsedRule, index: number): QueueRoutingRule => ({
    id: rule.id,
    name: rule.name,
    order: orderOffset + index,
    hitPolicy: decision.hitPolicy,
    conditionLogic: rule.conditionLogic,
    conditions: buildConditions(rule.conditions, warnings, rule.name, stripWorkItemPrefix),
    enabled: !disabled.has(rule.id),
    targets: parseTargets(rule, warnings)
  }));
}

function mapOverflowOutcome(actionTypeLabel: string | undefined): Outcome | undefined {
  switch (actionTypeLabel) {
    case "End Conversation": return "End Call";
    case "Voicemail": return "Voicemail";
    case "Direct Callback": return "Callback";
    case "Scheduled Callback": return "Scheduled Callback";
    case "Queue Transfer": return "Queue Transfer";
    case "Remain In Queue": return "Remain In Queue";
    case "Transfer to Phone": return "Transfer to Phone";
    default: return undefined; // "Default" and anything unrecognized: no special outcome, falls through to Agent.
  }
}

function humanizeOverflowFlag(lhs: string): string | undefined {
  const match = lhs.match(/^overflow\.(\w+)overflow$/i);
  if (!match) return undefined;
  return match[1].replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function parseOverflowRuleset(ruleset: any, overflowActionsById: Map<string, any>, warnings: string[]): OverflowRule[] {
  const decision = decisionOf(ruleset, "Overflow", warnings);
  if (!decision) return [];
  return decision.rules.map((rule: ParsedRule, index: number): OverflowRule => {
    const configAssign = rule.setAttributes.find((sa) => sa.lhs === "overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid");
    const flagAttribute = rule.setAttributes.find((sa) => /^overflow\.\w+overflow$/i.test(sa.lhs));
    const config = configAssign ? overflowActionsById.get(cleanGuid(configAssign.rhs)) : undefined;
    if (configAssign && !config) warnings.push(`Overflow rule “${rule.name}” references an overflow action configuration that was not found.`);
    const trigger = (flagAttribute && humanizeOverflowFlag(flagAttribute.lhs)) ?? "Configured overflow trigger";
    const outcome = mapOverflowOutcome(config?.["msdyn_overflowactiontype@OData.Community.Display.V1.FormattedValue"]);
    return {
      id: rule.id,
      name: rule.name,
      order: index,
      hitPolicy: decision.hitPolicy,
      trigger,
      conditionLogic: rule.conditionLogic,
      conditions: buildConditions(rule.conditions, warnings, rule.name, (lhs) => lhs),
      outcome,
      targetQueueId: outcome === "Queue Transfer" && config?.msdyn_overflowactiondata ? cleanGuid(config.msdyn_overflowactiondata) : undefined
    };
  });
}

function normalizeQueueRoutingLegacy(row: any, index: number): QueueRoutingRule {
  const conditions = asArray((() => { try { return JSON.parse(row.msdyn_rulejson ?? row.msdyn_condition ?? row.msdyn_expression ?? "[]"); } catch { return []; } })())
    .filter((condition) => condition?.variableId && condition?.operator)
    .map((condition): Condition => ({ variableId: condition.variableId, operator: condition.operator, value: condition.value }));
  const isAgent = row["msdyn_assignedto@OData.Community.Display.V1.FormattedValue"] === "Agent";
  const targets: QueueRoutingTarget[] = isAgent
    ? (row._msdyn_userassignid_value ? [{ agentId: row._msdyn_userassignid_value }] : [])
    : ((row._msdyn_queueassignid_value ?? row._msdyn_cdsqueueassignid_value) ? [{ queueId: row._msdyn_queueassignid_value ?? row._msdyn_cdsqueueassignid_value }] : []);
  return {
    id: row.msdyn_ocruleitemid,
    name: row.msdyn_name ?? `Queue-routing rule ${index + 1}`,
    order: Number(row.msdyn_priority ?? index + 1),
    hitPolicy: "first", // The legacy engine is priority-ordered, first-match-wins.
    conditionLogic: "AND",
    enabled: row.statecode === undefined || row.statecode === 0,
    conditions,
    targets
  };
}

async function loadRoutingSteps(workstreamId: string, warnings: string[]): Promise<{ enrichmentRules: EnrichmentRule[]; queueRoutingRules: QueueRoutingRule[] }> {
  const configs = await read("msdyn_routingconfiguration", `?$select=msdyn_routingconfigurationid,msdyn_isactiveconfiguration&$filter=_msdyn_liveworkstreamid_value eq ${workstreamId}`);
  const activeConfig = configs.find((c) => c.msdyn_isactiveconfiguration === true) ?? configs[0];

  if (activeConfig) {
    const steps = await read("msdyn_routingconfigurationstep", `?$select=msdyn_type,msdyn_name,msdyn_steporder,_msdyn_rulesetid_value&$filter=_msdyn_routingconfigurationid_value eq ${activeConfig.msdyn_routingconfigurationid}&$orderby=msdyn_steporder`);
    const assignmentStep = steps.find((s) => STEP_TYPE_ASSIGNMENT_LIKE.has(s.msdyn_type));
    if (assignmentStep) warnings.push(`This workstream also configures skill/agent-group based assignment (“${assignmentStep.msdyn_name}”); this tool does not yet parse that step type, only classification, queue selection, and overflow.`);

    const enrichmentSteps = steps.filter((s) => s.msdyn_type === STEP_TYPE_ENRICHMENT && s._msdyn_rulesetid_value);
    const queueSteps = steps.filter((s) => s.msdyn_type === STEP_TYPE_QUEUE_IDENTIFICATION && s._msdyn_rulesetid_value);

    if (enrichmentSteps.length || queueSteps.length) {
      const rulesetIds = [...enrichmentSteps, ...queueSteps].map((s) => s._msdyn_rulesetid_value);
      const rulesets = await read("msdyn_decisionruleset", `?$select=msdyn_decisionrulesetid,msdyn_name,msdyn_rulesetdefinition,msdyn_disabledrules&$filter=${rulesetIds.map((id) => `msdyn_decisionrulesetid eq ${id}`).join(" or ")}`);
      const rulesetById = new Map(rulesets.map((r) => [r.msdyn_decisionrulesetid, r]));

      let enrichmentRules: EnrichmentRule[] = [];
      for (const step of enrichmentSteps) enrichmentRules = enrichmentRules.concat(parseEnrichmentRuleset(rulesetById.get(step._msdyn_rulesetid_value), enrichmentRules.length, warnings));

      let queueRoutingRules: QueueRoutingRule[] = [];
      for (const step of queueSteps) queueRoutingRules = queueRoutingRules.concat(parseQueueRoutingRuleset(rulesetById.get(step._msdyn_rulesetid_value), queueRoutingRules.length, warnings));

      return { enrichmentRules, queueRoutingRules };
    }
  }

  const legacyRows = await read("msdyn_ocruleitem", `?$select=msdyn_ocruleitemid,msdyn_name,msdyn_priority,msdyn_condition,msdyn_expression,msdyn_rulejson,statecode,msdyn_assignedto,_msdyn_queueassignid_value,_msdyn_cdsqueueassignid_value,_msdyn_userassignid_value&$filter=_msdyn_liveworkstream_value eq ${workstreamId}`);
  return { enrichmentRules: [], queueRoutingRules: legacyRows.map(normalizeQueueRoutingLegacy) };
}

const WEEKDAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Only the common weekly-recurrence shape used by Dataverse's own operating-hours UI is supported
// (FREQ=WEEKLY;BYDAY=...); anything else is treated as unparseable so the caller can warn instead
// of silently guessing.
function parseByDay(pattern: string | undefined): number[] | undefined {
  if (!pattern || !/FREQ=WEEKLY/i.test(pattern)) return undefined;
  const match = pattern.match(/BYDAY=([A-Z,]+)/i);
  if (!match) return undefined;
  const codes = match[1].split(",").map((code) => WEEKDAY_CODES[code.toUpperCase()]);
  return codes.every((code) => code !== undefined) ? codes : undefined;
}

function parseInterval(pattern: string | undefined): number {
  const match = pattern?.match(/INTERVAL=(\d+)/i);
  return match ? Number(match[1]) : 1;
}

function isoDate(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 10) : undefined;
}

// Dataverse represents a business-hours calendar as an outer, weekly-recurring "which days" rule
// (calendarrule) whose actual daily time window lives on a separate "inner calendar" it points to
// via _innercalendarid_value — confirmed against the real Contoso Sales calendar. Fetches and
// flattens that two-level structure into directly-checkable OperatingHoursRule windows, keyed by
// the msdyn_operatinghour id queues point to (msdyn_operatinghourid on msdyn_operatinghour, not to
// be confused with the queue's own _msdyn_operatinghourid_value lookup to that record).
async function loadOperatingHoursByOpHourId(opHourIds: string[], warnings: string[]): Promise<Map<string, OperatingHoursRule[]>> {
  const result = new Map<string, OperatingHoursRule[]>();
  if (!opHourIds.length) return result;
  try {
    const opHours = await read("msdyn_operatinghour", `?$select=msdyn_operatinghourid,msdyn_calendarid&$filter=${opHourIds.map((id) => `msdyn_operatinghourid eq ${id}`).join(" or ")}`);
    const calendarIdByOpHourId = new Map<string, string>(opHours.filter((row) => row.msdyn_calendarid).map((row) => [row.msdyn_operatinghourid, row.msdyn_calendarid]));
    const calendarIds = [...new Set(calendarIdByOpHourId.values())];
    if (!calendarIds.length) return result;

    const outerCalendars = await read("calendar", `?$select=calendarid&$expand=calendar_calendar_rules&$filter=${calendarIds.map((id) => `calendarid eq ${id}`).join(" or ")}`);

    const innerIds = new Set<string>();
    outerCalendars.forEach((cal) => asArray(cal.calendar_calendar_rules).forEach((rule) => { if (rule._innercalendarid_value) innerIds.add(rule._innercalendarid_value); }));
    const innerRulesByCalendarId = new Map<string, any[]>();
    if (innerIds.size) {
      const innerCalendars = await read("calendar", `?$select=calendarid&$expand=calendar_calendar_rules&$filter=${[...innerIds].map((id) => `calendarid eq ${id}`).join(" or ")}`);
      innerCalendars.forEach((cal) => innerRulesByCalendarId.set(cal.calendarid, asArray(cal.calendar_calendar_rules)));
    }

    const rulesByCalendarId = new Map<string, OperatingHoursRule[]>();
    outerCalendars.forEach((cal) => {
      const parsed: OperatingHoursRule[] = [];
      asArray(cal.calendar_calendar_rules).forEach((outerRule) => {
        const weekdays = parseByDay(outerRule.pattern);
        const windows: { startMinutes: number; durationMinutes: number }[] = outerRule._innercalendarid_value
          ? asArray(innerRulesByCalendarId.get(outerRule._innercalendarid_value)).filter((inner) => inner.offset != null && inner.duration != null).map((inner) => ({ startMinutes: inner.offset, durationMinutes: inner.duration }))
          : (outerRule.offset != null && outerRule.duration != null ? [{ startMinutes: outerRule.offset, durationMinutes: outerRule.duration }] : []);
        if (!weekdays || !windows.length) {
          warnings.push("A queue’s operating-hours calendar uses a pattern this tool could not parse; hours-based overflow may not evaluate correctly.");
          return;
        }
        const validTo = isoDate(outerRule.effectiveintervalend);
        windows.forEach((window) => parsed.push({
          timeZoneCode: outerRule.timezonecode,
          weekdays,
          intervalWeeks: parseInterval(outerRule.pattern),
          anchorDate: isoDate(outerRule.effectiveintervalstart) ?? isoDate(outerRule.starttime) ?? "1970-01-01",
          startMinutes: window.startMinutes,
          durationMinutes: window.durationMinutes,
          validFrom: isoDate(outerRule.effectiveintervalstart),
          validTo: validTo && !validTo.startsWith("9999") ? validTo : undefined
        }));
      });
      rulesByCalendarId.set(cal.calendarid, parsed);
    });

    calendarIdByOpHourId.forEach((calendarId, opHourId) => {
      const rules = rulesByCalendarId.get(calendarId);
      if (rules?.length) result.set(opHourId, rules);
    });
  } catch (error) {
    warnings.push(`Unable to read operating hours: ${errorMessage(error)}`);
  }
  return result;
}

export async function loadRoutingModel(): Promise<RoutingModel> {
  const warnings: string[] = [];
  const workstreamRows = await readSelect("msdyn_liveworkstream", ["msdyn_liveworkstreamid", "msdyn_name", "statecode", "msdyn_direction", "msdyn_enablevoicev2"], undefined, warnings);
  // msdyn_direction: 0 Inbound, 1 Outbound, 2 Direct Inbound, 3 Direct Outbound, 4 ProactiveOutbound (confirmed against a live environment).
  const voiceRows = workstreamRows.filter((row) => row.msdyn_enablevoicev2 === true && (row.msdyn_direction === 0 || row.msdyn_direction === undefined));
  if (!workstreamRows.length) warnings.push("No workstreams were found in this environment.");
  else if (!voiceRows.length) warnings.push(`No inbound voice workstreams were found among the ${workstreamRows.length} workstream(s) in this environment.`);

  // msdyn_defaultqueue is a lookup whose plain-value alias (_msdyn_defaultqueue_value) was
  // confirmed, against real data, to come back silently omitted (no error) from a plain
  // $select in this environment — only $expand reliably returns it. Fetch it separately rather
  // than folding it into the readSelect above.
  const fallbackQueueIdByWorkstreamId = new Map<string, string>();
  if (voiceRows.length) {
    const idsFilter = voiceRows.map((row) => `msdyn_liveworkstreamid eq ${row.msdyn_liveworkstreamid}`).join(" or ");
    try {
      const expanded = await read("msdyn_liveworkstream", `?$select=msdyn_liveworkstreamid&$expand=msdyn_defaultqueue($select=queueid)&$filter=${idsFilter}`);
      expanded.forEach((row) => { if (row.msdyn_defaultqueue?.queueid) fallbackQueueIdByWorkstreamId.set(row.msdyn_liveworkstreamid, row.msdyn_defaultqueue.queueid); });
    } catch (error) {
      warnings.push(`Unable to read fallback queues for workstreams: ${errorMessage(error)}`);
    }
  }

  const [queueRows, decisionRows, overflowActionRows] = await Promise.all([
    // msdyn_prequeueoverflowrulesetid's own navigation-property name is misdeclared as
    // "msdyn_decisionrulesetid" in this environment's metadata (confirmed against the raw $metadata
    // document — its sibling msdyn_inqueueoverflowrulesetid is named correctly), so the bare logical
    // name 400s on $select; the underscored _value alias bypasses that and works.
    readSelect("queue", ["queueid", "name", "statecode", "msdyn_assignmentstrategy", "msdyn_inqueueoverflowrulesetid", "_msdyn_prequeueoverflowrulesetid_value", "msdyn_isomnichannelqueue", "_msdyn_operatinghourid_value"], undefined, warnings),
    read("msdyn_decisionruleset", "?$select=msdyn_decisionrulesetid,msdyn_name,msdyn_rulesetdefinition,msdyn_disabledrules,statecode"),
    read("msdyn_overflowactionconfig", "?$select=msdyn_overflowactionconfigid,msdyn_name,msdyn_overflowactiontype,msdyn_overflowactiondata")
  ]);
  const decisionById = new Map(decisionRows.map((row) => [row.msdyn_decisionrulesetid, row]));
  const overflowActionsById = new Map(overflowActionRows.map((row) => [row.msdyn_overflowactionconfigid, row]));
  const opHourIds = [...new Set(queueRows.map((row) => row._msdyn_operatinghourid_value).filter(Boolean))] as string[];
  const operatingHoursByOpHourId = await loadOperatingHoursByOpHourId(opHourIds, warnings);

  const queues: Queue[] = queueRows.map((row) => {
    const assignmentMethod = row["msdyn_assignmentstrategy@OData.Community.Display.V1.FormattedValue"] ?? String(row.msdyn_assignmentstrategy ?? "Configured assignment");
    return {
      id: row.queueid,
      name: row.name ?? row.queueid,
      assignmentMethod,
      preQueueOverflowRules: parseOverflowRuleset(decisionById.get(row._msdyn_prequeueoverflowrulesetid_value ?? ""), overflowActionsById, warnings),
      inQueueOverflowRules: parseOverflowRuleset(decisionById.get(row._msdyn_inqueueoverflowrulesetid_value ?? ""), overflowActionsById, warnings),
      operatingHours: row._msdyn_operatinghourid_value ? operatingHoursByOpHourId.get(row._msdyn_operatinghourid_value) : undefined
    };
  });
  const queueIds = new Set(queues.map((queue) => queue.id));

  const workstreams: Workstream[] = [];
  for (const row of voiceRows) {
    const id = row.msdyn_liveworkstreamid;
    const [variableRows, routingSteps] = await Promise.all([
      read("msdyn_ocliveworkstreamcontextvariable", `?$select=msdyn_ocliveworkstreamcontextvariableid,msdyn_name,msdyn_displayname,msdyn_datatype,msdyn_isdisplayable&$filter=_msdyn_liveworkstreamid_value eq ${id}`),
      loadRoutingSteps(id, warnings)
    ]);
    const { enrichmentRules, queueRoutingRules } = routingSteps;
    const fallbackQueueId = fallbackQueueIdByWorkstreamId.get(id);

    const variables: ContextVariable[] = variableRows.map((variable) => {
      const variableId = variable.msdyn_name ?? variable.msdyn_ocliveworkstreamcontextvariableid;
      const usedByRuleIds = [...enrichmentRules, ...queueRoutingRules]
        .filter((rule) => rule.conditions.some((condition) => condition.variableId.toLowerCase() === variableId.toLowerCase()))
        .map((rule) => rule.id);
      return { id: variableId, name: variable.msdyn_displayname ?? variable.msdyn_name, type: variableType(variable.msdyn_datatype), origin: "ivr", usedByRuleIds };
    });

    workstreams.push({ id, name: row.msdyn_name ?? id, active: row.statecode === 0, variables, classificationRules: enrichmentRules, queueRoutingRules, fallbackQueueId });
    queueRoutingRules.forEach((rule) => {
      rule.targets.forEach((target) => {
        if (target.queueId && !queueIds.has(target.queueId)) warnings.push(`Queue-routing rule “${rule.name}” points to queue ${target.queueId}, which was not found.`);
      });
    });
    if (fallbackQueueId && !queueIds.has(fallbackQueueId)) {
      warnings.push(`Workstream “${row.msdyn_name ?? id}” has a fallback queue (${fallbackQueueId}) that was not found among the read queues.`);
    }
  }
  return { workstreams, queues, warnings };
}

export function emptyModel(): RoutingModel { return { workstreams: [], queues: [], warnings: [] }; }
