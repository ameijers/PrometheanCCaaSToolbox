// Reuses the pure, dependency-free unified-routing decision-XML parser Visual Routing Tester
// already verified against a live environment, rather than re-deriving XML parsing from scratch.
// This is a read-only import of a pure function (no Xrm, no shared runtime state) — it does not
// couple this tool's web resource bundle to Visual Routing Tester's, and never modifies that tool.
import { parseDecisionXml } from "../../visual-routing-tester/src/ruleXml";
import {
  AccessMode, AgentRecord, AgentSkillInfo, CapacityProfileInfo, Field, PresenceInfo,
  QueueMembershipInfo, QueueSkillRequirement, RequiredSkillInfo, known, unknownField
} from "./model";

declare const Xrm: any;

// Same iframe/top-window resolution as the other two tools — this control may run as the
// top-level sitemap page or embedded via IFRAME on a form/dashboard.
function resolveXrm(): any {
  if (typeof Xrm !== "undefined" && Xrm?.WebApi) return Xrm;
  if (typeof window === "undefined") return undefined;
  const w = window as any;
  if (w.parent && w.parent !== w && w.parent.Xrm?.WebApi) return w.parent.Xrm;
  if (w.top && w.top !== w && w.top.Xrm?.WebApi) return w.top.Xrm;
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

function classifyError(logicalName: string, error: unknown): Error {
  const message = errorMessage(error);
  if (/0x80040220|privilege|permission denied|access is denied/i.test(message)) {
    return new Error(`No permission to read "${logicalName}" (${message})`);
  }
  if (/could not find|does not exist|invalid entity|resource not found|entitydefinition|property named/i.test(message)) {
    return new Error(`"${logicalName}" is not available in this environment in the shape this tool expects (${message})`);
  }
  return new Error(`Unable to read "${logicalName}": ${message}`);
}

// Follows @odata.nextLink until exhausted — Xrm.WebApi does not page automatically. The SDK's
// nextLink is a full URL; retrieveMultipleRecords wants only the query-string portion.
async function readAll(logicalName: string, initialQuery: string): Promise<any[]> {
  const xrm = resolveXrm();
  if (!xrm) throw new Error("This app must run inside a Dataverse model-driven app (as a web resource on a form, dashboard, or sitemap page).");
  let query: string | undefined = initialQuery;
  const entities: any[] = [];
  try {
    for (;;) {
      const result: { entities: any[]; nextLink?: string } = await xrm.WebApi.retrieveMultipleRecords(logicalName, query);
      entities.push(...result.entities);
      if (!result.nextLink) break;
      const qIndex: number = result.nextLink.indexOf("?");
      query = qIndex >= 0 ? result.nextLink.slice(qIndex) : undefined;
      if (!query) break;
    }
    return entities;
  } catch (error) {
    throw classifyError(logicalName, error);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Dataverse URLs have practical length limits, so a big "field eq id1 or field eq id2 or ..." filter
// is issued in batches rather than one unbounded OR clause — this is the "avoid N+1, but also avoid
// one giant fragile request" middle ground for bulk-loading by id.
async function readByIdBatches(logicalName: string, idField: string, ids: string[], selectAndExpand: string, batchSize = 25): Promise<any[]> {
  if (!ids.length) return [];
  const batches = chunk([...new Set(ids)], batchSize);
  const results = await Promise.all(batches.map((batchIds) => {
    const filter = batchIds.map((id) => `${idField} eq ${id}`).join(" or ");
    return readAll(logicalName, `?${selectAndExpand}&$filter=${filter}`);
  }));
  return results.flat();
}

// systemuser.accessmode option set (standard Dataverse, not Contact-Center-specific).
const ACCESS_MODE_BY_CODE: Record<number, AccessMode> = { 0: "readWrite", 1: "administrative", 2: "read", 3: "supportUser", 4: "nonInteractive", 5: "delegatedAdmin" };

function accessModeOf(code: unknown): AccessMode {
  return typeof code === "number" && ACCESS_MODE_BY_CODE[code] ? ACCESS_MODE_BY_CODE[code] : "other";
}

// Presence status *names* are fairly standard across Omnichannel/Contact Center environments even
// though this tool couldn't confirm an exact "does this status allow assignment" column — inferring
// from the name is a defensible heuristic that degrades to "undetermined" for anything unrecognized,
// rather than guessing a boolean column name that might not exist.
function inferAllowsAssignment(presenceName: string): boolean | undefined {
  const normalized = presenceName.toLowerCase();
  if (/available|online/.test(normalized)) return true;
  if (/busy|away|offline|do\s*not\s*disturb|dnd|break/.test(normalized)) return false;
  return undefined;
}

interface VoiceRoutingReachability {
  // queueId -> names of active inbound-voice workstreams that route to it (directly or as fallback).
  reachableQueues: Map<string, string[]>;
  // queueId -> best-effort required skills for that queue, parsed from a reaching workstream's
  // skill-identification routing step. Absent from the map (vs. an empty array) means "no reaching
  // workstream had a parseable skill step" — the caller treats that as `required: null` (undetermined).
  requiredSkillsByQueue: Map<string, RequiredSkillInfo[]>;
}

// Routing-configuration-step type codes, confirmed against a live Contact Center environment (see
// Visual Routing Tester's dataverse.ts, which this reuses the same constants' meaning from).
const STEP_TYPE_QUEUE_IDENTIFICATION = 192350002;
const STEP_TYPE_SKILL_IDENTIFICATION = 192350001;

function cleanGuid(raw: string): string { return raw.replace(/[{}]/g, "").trim(); }

// Extracts just the target queue ids a queue-routing decision ruleset can send work to — a smaller,
// purpose-built slice of Visual Routing Tester's full rule parsing (which also tracks conditions,
// hit policy, and agent-direct targets this tool doesn't need): for readiness checking we only need
// to know which queues are wired in as *possible* destinations, not which condition selects which.
function extractTargetQueueIds(decisionXml: string | undefined): string[] {
  const decision = decisionXml ? parseDecisionXml(decisionXml) : null;
  if (!decision) return [];
  const ids: string[] = [];
  decision.rules.forEach((rule) => {
    const queueAssign = rule.setAttributes.find((sa) => sa.lhs === "assign_to.queue");
    if (queueAssign) ids.push(cleanGuid(queueAssign.rhs));
    rule.distributionRecords.forEach((record) => {
      const queueId = record.find((sa) => sa.lhs === "queuedetails.queueid");
      if (queueId) ids.push(cleanGuid(queueId.rhs));
    });
  });
  return ids;
}

// Best-effort extraction of required skills from a skill-identification step's ruleset. The exact
// action shape for "set required skills on the work item" was not confirmed against a live
// environment (unlike the queue/classification steps Visual Routing Tester verified) — this looks
// for any set-attribute whose left-hand side mentions "characteristic" or "skill" and tries a couple
// of plausible JSON shapes for its value. Returns [] (not null) when the step exists but nothing
// recognizable was found, since the caller distinguishes "no reaching step at all" (undetermined)
// from "a step exists but requires nothing" via map presence, not this function's return value.
function extractRequiredSkills(decisionXml: string | undefined): RequiredSkillInfo[] {
  const decision = decisionXml ? parseDecisionXml(decisionXml) : null;
  if (!decision) return [];
  const skills: RequiredSkillInfo[] = [];
  decision.rules.forEach((rule) => {
    rule.setAttributes.filter((sa) => /characteristic|skill/i.test(sa.lhs)).forEach((sa) => {
      try {
        const parsed = JSON.parse(sa.rhs);
        (Array.isArray(parsed) ? parsed : [parsed]).forEach((entry: any) => {
          const name = entry?.name ?? entry?.characteristicname ?? entry?.skill ?? entry?.Name;
          if (typeof name !== "string" || !name) return;
          const rank = entry?.proficiency ?? entry?.ratingvalue ?? entry?.minproficiency ?? entry?.rating;
          skills.push({ name, minProficiencyRank: typeof rank === "number" ? rank : undefined, minProficiencyLabel: typeof rank === "string" ? rank : undefined });
        });
      } catch { /* unrecognized shape for this attribute — skip it, don't fail the whole extraction */ }
    });
  });
  return skills;
}

async function loadVoiceRoutingReachability(): Promise<VoiceRoutingReachability> {
  const reachableQueues = new Map<string, string[]>();
  const requiredSkillsByQueue = new Map<string, RequiredSkillInfo[]>();

  const workstreamRows = await readAll("msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,statecode,msdyn_direction,msdyn_enablevoicev2");
  const voiceRows = workstreamRows.filter((row) => row.statecode === 0 && row.msdyn_enablevoicev2 === true && (row.msdyn_direction === 0 || row.msdyn_direction === undefined));
  if (!voiceRows.length) return { reachableQueues, requiredSkillsByQueue };

  const expandedFallback = await readAll("msdyn_liveworkstream", `?$select=msdyn_liveworkstreamid&$expand=msdyn_defaultqueue($select=queueid)&$filter=${voiceRows.map((r) => `msdyn_liveworkstreamid eq ${r.msdyn_liveworkstreamid}`).join(" or ")}`);
  const fallbackQueueByWorkstreamId = new Map<string, string>(expandedFallback.filter((r) => r.msdyn_defaultqueue?.queueid).map((r) => [r.msdyn_liveworkstreamid, r.msdyn_defaultqueue.queueid]));

  for (const workstream of voiceRows) {
    const configs = await readAll("msdyn_routingconfiguration", `?$select=msdyn_routingconfigurationid,msdyn_isactiveconfiguration&$filter=_msdyn_liveworkstreamid_value eq ${workstream.msdyn_liveworkstreamid}`);
    const activeConfig = configs.find((c) => c.msdyn_isactiveconfiguration === true) ?? configs[0];
    const targetQueueIds = new Set<string>();
    const fallback = fallbackQueueByWorkstreamId.get(workstream.msdyn_liveworkstreamid);
    if (fallback) targetQueueIds.add(fallback);

    if (activeConfig) {
      const steps = await readAll("msdyn_routingconfigurationstep", `?$select=msdyn_type,_msdyn_rulesetid_value&$filter=_msdyn_routingconfigurationid_value eq ${activeConfig.msdyn_routingconfigurationid}`);
      const rulesetIds = steps.filter((s) => s._msdyn_rulesetid_value).map((s) => s._msdyn_rulesetid_value);
      if (rulesetIds.length) {
        const rulesets = await readAll("msdyn_decisionruleset", `?$select=msdyn_decisionrulesetid,msdyn_rulesetdefinition&$filter=${[...new Set(rulesetIds)].map((id) => `msdyn_decisionrulesetid eq ${id}`).join(" or ")}`);
        const rulesetById = new Map(rulesets.map((r) => [r.msdyn_decisionrulesetid, r]));

        steps.filter((s) => s.msdyn_type === STEP_TYPE_QUEUE_IDENTIFICATION && s._msdyn_rulesetid_value).forEach((step) => {
          extractTargetQueueIds(rulesetById.get(step._msdyn_rulesetid_value)?.msdyn_rulesetdefinition).forEach((id) => targetQueueIds.add(id));
        });

        const skillSteps = steps.filter((s) => s.msdyn_type === STEP_TYPE_SKILL_IDENTIFICATION && s._msdyn_rulesetid_value);
        if (skillSteps.length) {
          const skills = skillSteps.flatMap((step) => extractRequiredSkills(rulesetById.get(step._msdyn_rulesetid_value)?.msdyn_rulesetdefinition));
          targetQueueIds.forEach((queueId) => requiredSkillsByQueue.set(queueId, [...(requiredSkillsByQueue.get(queueId) ?? []), ...skills]));
        }
      }
    }

    targetQueueIds.forEach((queueId) => reachableQueues.set(queueId, [...(reachableQueues.get(queueId) ?? []), workstream.msdyn_name ?? workstream.msdyn_liveworkstreamid]));
  }

  return { reachableQueues, requiredSkillsByQueue };
}

// --- Candidate agent set --------------------------------------------------------------------
// "Agent" for this tool means: any user who is a member of at least one queue, OR holds one of the
// configured agent security roles — the union, not just queue members, so a user who holds an agent
// role but was never added to a queue (a common real misconfiguration) is still surfaced rather than
// silently excluded from the roster.

async function loadCandidateUserIds(): Promise<{ ids: string[]; queueMembershipRows: any[]; roleRows: any[] }> {
  const queueMembershipRows = await readAll("queuemembership", "?$select=queueid,systemuserid");
  const roleNameRows = await readAll("role", "?$select=roleid,name");
  const roleIdByName = new Map(roleNameRows.map((r) => [String(r.name).toLowerCase(), r.roleid]));
  const { REQUIRED_SECURITY_ROLE_NAMES } = await import("./config");
  const relevantRoleIds = REQUIRED_SECURITY_ROLE_NAMES.map((name) => roleIdByName.get(name.toLowerCase())).filter(Boolean) as string[];

  const roleRows = relevantRoleIds.length
    ? await readAll("systemuserroles", `?$select=systemuserid,roleid&$filter=${relevantRoleIds.map((id) => `roleid eq ${id}`).join(" or ")}`)
    : [];

  const ids = new Set<string>();
  queueMembershipRows.forEach((r) => { if (r.systemuserid) ids.add(r.systemuserid); });
  roleRows.forEach((r) => { if (r.systemuserid) ids.add(r.systemuserid); });
  return { ids: [...ids], queueMembershipRows, roleRows };
}

export interface LoadProgress { message: string; }

export async function loadAgentRoster(onProgress?: (progress: LoadProgress) => void): Promise<AgentRecord[]> {
  const report = (message: string) => onProgress?.({ message });

  report("Finding agents (queue members + agent-role holders)…");
  const { ids: candidateIds, queueMembershipRows } = await loadCandidateUserIds();
  if (!candidateIds.length) return [];

  report(`Loading ${candidateIds.length} agent account(s)…`);
  const userRows = await readByIdBatches("systemuser", "systemuserid", candidateIds, "$select=systemuserid,fullname,domainname,isdisabled,accessmode");

  report("Reading security roles…");
  const allRoleAssignments = await readByIdBatches("systemuserroles", "systemuserid", candidateIds, "$select=systemuserid,roleid");
  const roleIds = [...new Set(allRoleAssignments.map((r) => r.roleid))];
  const roleRows = roleIds.length ? await readByIdBatches("role", "roleid", roleIds, "$select=roleid,name") : [];
  const roleNameById = new Map(roleRows.map((r) => [r.roleid, r.name as string]));
  const roleNamesByUserId = new Map<string, string[]>();
  allRoleAssignments.forEach((r) => {
    const name = roleNameById.get(r.roleid);
    if (!name) return;
    roleNamesByUserId.set(r.systemuserid, [...(roleNamesByUserId.get(r.systemuserid) ?? []), name]);
  });

  report("Reading queue memberships and routing configuration…");
  let reachability: VoiceRoutingReachability | Error;
  try { reachability = await loadVoiceRoutingReachability(); } catch (error) { reachability = error instanceof Error ? error : new Error(String(error)); }

  const queueIds = [...new Set(queueMembershipRows.map((r) => r.queueid).filter(Boolean))];
  const queueRows = queueIds.length ? await readByIdBatches("queue", "queueid", queueIds, "$select=queueid,name,statecode") : [];
  const queueById = new Map(queueRows.map((q) => [q.queueid, q]));
  const membershipsByUserId = new Map<string, QueueMembershipInfo[]>();
  queueMembershipRows.forEach((row) => {
    const queue = queueById.get(row.queueid);
    if (!row.systemuserid || !queue) return;
    const reachInfo = reachability instanceof Error ? undefined : reachability.reachableQueues.get(row.queueid);
    const info: QueueMembershipInfo = {
      queueId: row.queueid,
      queueName: queue.name ?? row.queueid,
      queueActive: queue.statecode === 0,
      reachableByActiveVoiceWorkstream: !!reachInfo,
      reachingWorkstreamNames: reachInfo ?? []
    };
    membershipsByUserId.set(row.systemuserid, [...(membershipsByUserId.get(row.systemuserid) ?? []), info]);
  });

  report("Reading capacity profiles…");
  const capacityByUserId = await loadCapacityProfiles(candidateIds);

  report("Reading skills…");
  const skillsByUserId = await loadSkills(candidateIds);

  report("Reading presence…");
  const presenceByUserId = await loadPresence(candidateIds);

  return userRows.map((row): AgentRecord => {
    const id = row.systemuserid;
    const memberships = membershipsByUserId.get(id) ?? [];
    const queueSkillRequirements: Field<QueueSkillRequirement[]> = reachability instanceof Error
      ? unknownField(`Could not read routing configuration to determine required skills: ${reachability.message}`)
      : known(memberships.map((m): QueueSkillRequirement => ({
        queueId: m.queueId,
        queueName: m.queueName,
        required: reachability.requiredSkillsByQueue.has(m.queueId) ? (reachability.requiredSkillsByQueue.get(m.queueId) ?? []) : null
      })));

    const reachableUnitCosts: number[] = []; // see workItemUnitCost comment below — always empty in live mode today.

    return {
      id,
      name: row.fullname ?? id,
      domainName: row.domainname,
      disabled: known(row.isdisabled === true),
      accessMode: known(accessModeOf(row.accessmode)),
      securityRoles: known(roleNamesByUserId.get(id) ?? []),
      // No stable, documented read-only source for per-agent channel enablement was confirmed for
      // this tool (see README's schema-confidence table) — always unknown rather than guessing a
      // table name with no real basis. Queue membership / workstream reachability below are the
      // reliable proxy for practical voice access.
      channels: unknownField("This environment's per-agent channel configuration could not be confirmed from a documented Dataverse schema; verify manually in the Customer Service admin center under Users → Channels."),
      queueMemberships: reachability instanceof Error
        ? unknownField(`Could not read the routing configuration needed to determine which queues are reachable: ${reachability.message}`)
        : known(memberships),
      capacityProfile: capacityByUserId.get(id) ?? unknownField("Could not read capacity profile assignment."),
      // This tool could not confirm a stable, documented source for a workstream's work-item unit
      // cost (the "Set Work Item Unit Capacity" configuration) — always unknown in live mode; the
      // comparison logic itself is fully implemented and tested (see checks.test.ts) against
      // synthetic values, and demo mode exercises it end-to-end with hand-authored sample data.
      workItemUnitCost: reachableUnitCosts.length ? known(Math.min(...reachableUnitCosts)) : unknownField("This tool could not confirm this environment's work-item unit-cost configuration from a documented schema; verify manually whether this agent's capacity covers the relevant workstream's per-conversation cost."),
      skills: skillsByUserId.get(id) ?? unknownField("Could not read this agent's skills."),
      queueSkillRequirements,
      presence: presenceByUserId.get(id) ?? unknownField("Could not read this agent's current presence."),
      // No defensible read-only source found for an explicit assignment exclusion/opt-out — see
      // README. Always unknown, matching this tool's own guidance to mark truly unverifiable things
      // as such rather than guess.
      routingExclusion: unknownField("Not verifiable via read-only client-side access in this environment.")
    };
  });
}

async function loadCapacityProfiles(userIds: string[]): Promise<Map<string, Field<CapacityProfileInfo | null>>> {
  const result = new Map<string, Field<CapacityProfileInfo | null>>();
  try {
    // The $expand-not-plain-$select lesson from Visual Routing Tester's msdyn_defaultqueue finding
    // applies here too: a lookup's plain _value alias can come back silently omitted where $expand
    // reliably returns it, so this uses $expand for the capacity profile lookup.
    const rows = await readByIdBatches("systemuser", "systemuserid", userIds, "$select=systemuserid&$expand=msdyn_capacityprofileid($select=msdyn_name,msdyn_totalcapacity)");
    rows.forEach((row) => {
      const profile = row.msdyn_capacityprofileid;
      result.set(row.systemuserid, known(profile ? { id: profile.msdyn_agentcapacityprofileid ?? profile.msdyn_name, name: profile.msdyn_name ?? "Capacity profile", totalCapacity: Number(profile.msdyn_totalcapacity ?? 0) } : null));
    });
  } catch (error) {
    const reason = `Could not read capacity profile assignment: ${errorMessage(error)}`;
    userIds.forEach((id) => result.set(id, unknownField(reason)));
  }
  return result;
}

async function loadSkills(userIds: string[]): Promise<Map<string, Field<AgentSkillInfo[]>>> {
  const result = new Map<string, Field<AgentSkillInfo[]>>();
  try {
    const resources = await readByIdBatches("bookableresource", "_userid_value", userIds, "$select=bookableresourceid,_userid_value");
    const resourceUserById = new Map(resources.map((r) => [r.bookableresourceid, r._userid_value]));
    const resourceIds = resources.map((r) => r.bookableresourceid);
    const characteristics = resourceIds.length
      ? await readByIdBatches("bookableresourcecharacteristic", "_bookableresourceid_value", resourceIds, "$select=_bookableresourceid_value&$expand=characteristic($select=name),ratingvalue($select=name,value)")
      : [];
    userIds.forEach((id) => result.set(id, known([])));
    characteristics.forEach((row) => {
      const userId = resourceUserById.get(row._bookableresourceid_value);
      if (!userId || !row.characteristic?.name) return;
      const skill: AgentSkillInfo = {
        characteristicId: row.characteristic.characteristicid ?? row.characteristic.name,
        name: row.characteristic.name,
        proficiencyLabel: row.ratingvalue?.name,
        proficiencyRank: typeof row.ratingvalue?.value === "number" ? row.ratingvalue.value : undefined
      };
      const existing = result.get(userId);
      if (existing?.known) result.set(userId, known([...existing.value, skill]));
    });
  } catch (error) {
    const reason = `Could not read skills (bookableresource/bookableresourcecharacteristic): ${errorMessage(error)}`;
    userIds.forEach((id) => result.set(id, unknownField(reason)));
  }
  return result;
}

async function loadPresence(userIds: string[]): Promise<Map<string, Field<PresenceInfo | null>>> {
  const result = new Map<string, Field<PresenceInfo | null>>();
  try {
    const rows = await readByIdBatches("systemuser", "systemuserid", userIds, "$select=systemuserid,modifiedon&$expand=msdyn_presenceid($select=msdyn_name)");
    rows.forEach((row) => {
      const presence = row.msdyn_presenceid;
      result.set(row.systemuserid, known(presence?.msdyn_name ? { name: presence.msdyn_name, allowsAssignment: inferAllowsAssignment(presence.msdyn_name) } : null));
    });
  } catch (error) {
    const reason = `Could not read presence: ${errorMessage(error)}`;
    userIds.forEach((id) => result.set(id, unknownField(reason)));
  }
  return result;
}
