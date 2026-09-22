// Reuses the pure, dependency-free unified-routing decision-XML parser Visual Routing Tester
// already verified against a live environment, rather than re-deriving XML parsing from scratch.
// This is a read-only import of a pure function (no Xrm, no shared runtime state) — it does not
// couple this tool's web resource bundle to Visual Routing Tester's, and never modifies that tool.
import { parseDecisionXml } from "../../visual-routing-tester/src/ruleXml";
import {
  AccessMode, AgentRecord, AgentSkillInfo, CapacityProfileAssignment, Field, PresenceInfo,
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

// msdyn_liveworkstream.msdyn_capacityformat — confirmed live (via the option set's own metadata
// against academyexperiment) to have exactly two real values. Under "Unit based", capacityRequired
// is a literal number of capacity units directly comparable to the agent's own capacity. Under
// "Profile based" it is NOT meaningfully comparable that way — a real environment had every inbound
// voice workstream set to "Profile based" with capacityRequired=30, which produced a false "capacity
// too low" failure for an agent whose actual (correct, sufficient) capacity was 1.
const CAPACITY_FORMAT_UNIT_BASED = 192350000;
const CAPACITY_FORMAT_PROFILE_BASED = 192360000;

interface ReachingWorkstream {
  name: string;
  // Only set when this workstream's capacity format is confirmed "Unit based" — see above. Under
  // "Profile based" (or an unrecognized format value), this stays undefined so it never
  // contributes a misleading unit-cost comparison; reachability and capacity-data-availability are
  // independent — a missing capacity value must never look like "this queue isn't routed to".
  capacityRequired: number | undefined;
  profileBasedCapacity: boolean;
}

interface VoiceRoutingReachability {
  // queueId -> active inbound-voice workstreams that route to it (directly or as fallback).
  reachableQueues: Map<string, ReachingWorkstream[]>;
  // queueId -> best-effort required skills for that queue, parsed from a reaching workstream's
  // skill-identification routing step. Only meaningful for queueIds also present in
  // queueIdsWithSkillRouting below — the caller treats an absent entry there as `required: null`
  // (a step exists but this tool's parser found nothing usable in it — genuinely undetermined).
  requiredSkillsByQueue: Map<string, RequiredSkillInfo[]>;
  // queueId -> true if at least one reaching workstream's active routing configuration has a Skill
  // identification step at all (msdyn_type 192350001 — confirmed against academyexperiment's real
  // step-type option set, see IMPLEMENTATION_STATUS.md "Round 7"). A queue absent from this set is
  // reached only by workstream(s) with NO such step — a confirmed structural fact, not a guess, since
  // it's read from the same routing-configuration steps already fetched for queue targeting — meaning
  // unified routing never attempts to skill-match work for it, so `required: []` there is a known
  // answer, not "couldn't determine".
  queueIdsWithSkillRouting: Set<string>;
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
  const reachableQueues = new Map<string, ReachingWorkstream[]>();
  const requiredSkillsByQueue = new Map<string, RequiredSkillInfo[]>();
  const queueIdsWithSkillRouting = new Set<string>();

  const workstreamRows = await readAll("msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,statecode,msdyn_direction,msdyn_enablevoicev2,msdyn_capacityrequired,msdyn_capacityformat");
  const voiceRows = workstreamRows.filter((row) => row.statecode === 0 && row.msdyn_enablevoicev2 === true && (row.msdyn_direction === 0 || row.msdyn_direction === undefined));
  if (!voiceRows.length) return { reachableQueues, requiredSkillsByQueue, queueIdsWithSkillRouting };

  const expandedFallback = await readAll("msdyn_liveworkstream", `?$select=msdyn_liveworkstreamid&$expand=msdyn_defaultqueue($select=queueid)&$filter=${voiceRows.map((r) => `msdyn_liveworkstreamid eq ${r.msdyn_liveworkstreamid}`).join(" or ")}`);
  const fallbackQueueByWorkstreamId = new Map<string, string>(expandedFallback.filter((r) => r.msdyn_defaultqueue?.queueid).map((r) => [r.msdyn_liveworkstreamid, r.msdyn_defaultqueue.queueid]));

  for (const workstream of voiceRows) {
    const configs = await readAll("msdyn_routingconfiguration", `?$select=msdyn_routingconfigurationid,msdyn_isactiveconfiguration&$filter=_msdyn_liveworkstreamid_value eq ${workstream.msdyn_liveworkstreamid}`);
    const activeConfig = configs.find((c) => c.msdyn_isactiveconfiguration === true) ?? configs[0];
    const targetQueueIds = new Set<string>();
    const fallback = fallbackQueueByWorkstreamId.get(workstream.msdyn_liveworkstreamid);
    if (fallback) targetQueueIds.add(fallback);
    let workstreamHasSkillStep = false;

    if (activeConfig) {
      const steps = await readAll("msdyn_routingconfigurationstep", `?$select=msdyn_type,_msdyn_rulesetid_value&$filter=_msdyn_routingconfigurationid_value eq ${activeConfig.msdyn_routingconfigurationid}`);
      // Presence of the step type itself (not whether it has a parseable ruleset) is what determines
      // whether unified routing skill-matches for this workstream at all — confirmed against the real
      // step-type option set (192350000 Enrichment, 192350001 Skill identification, 192350002 Queue
      // identification, 192350003 Agent Group identification). None of a real environment's three
      // inbound voice workstreams had a Skill identification step, which is what originally made this
      // check permanently "Not verifiable" — that absence is itself the (confirmed) answer, not a gap.
      workstreamHasSkillStep = steps.some((s) => s.msdyn_type === STEP_TYPE_SKILL_IDENTIFICATION);
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

    const isProfileBased = workstream.msdyn_capacityformat === CAPACITY_FORMAT_PROFILE_BASED;
    const isUnitBased = workstream.msdyn_capacityformat === CAPACITY_FORMAT_UNIT_BASED;
    const rawCapacity = Number(workstream.msdyn_capacityrequired);
    const entry: ReachingWorkstream = {
      name: workstream.msdyn_name ?? workstream.msdyn_liveworkstreamid,
      capacityRequired: isUnitBased && Number.isFinite(rawCapacity) ? rawCapacity : undefined,
      profileBasedCapacity: isProfileBased
    };
    targetQueueIds.forEach((queueId) => {
      reachableQueues.set(queueId, [...(reachableQueues.get(queueId) ?? []), entry]);
      if (workstreamHasSkillStep) queueIdsWithSkillRouting.add(queueId);
    });
  }

  return { reachableQueues, requiredSkillsByQueue, queueIdsWithSkillRouting };
}

// --- Candidate agent set --------------------------------------------------------------------
// "Agent" for this tool means: any user holding at least one of the role groups selected in the
// UI's live role picker (Agent / Supervisor / Omnichannel Admin — see App.tsx and config.ts's
// RoleSelection). Queue membership alone is deliberately NOT a trigger for inclusion — this tool
// originally also included any queue member, on the theory that a queue member without a role was a
// misconfiguration worth surfacing, but live testing showed the opposite problem dominates in
// practice: queues can contain users who were never meant to be agents at all (e.g.
// incidental/legacy queue membership), producing a roster full of "failing" checks for people who
// were never going to receive calls in the first place. Role membership is the more defensible
// signal of who this tool's checks are actually relevant to.
//
// Role names themselves are never guessed against live data (see config.ts's comment on
// DEFAULT_ROLE_GROUPS for why) — the caller resolves whichever roles the person picked into ids via
// loadAllRoles() first, and passes those ids in here directly.

export async function loadAllRoles(): Promise<{ roleId: string; name: string }[]> {
  const rows = await readAll("role", "?$select=roleid,name&$orderby=name asc");
  return rows
    .filter((r) => r.roleid && r.name)
    .map((r) => ({ roleId: r.roleid as string, name: r.name as string }))
    // Sorted again client-side rather than trusting $orderby alone — cheap, and guarantees the
    // picker's dropdowns are alphabetical regardless of server behavior.
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadCandidateUserIds(relevantRoleIds: string[]): Promise<{ ids: string[]; queueMembershipRows: any[] }> {
  const queueMembershipRows = await readAll("queuemembership", "?$select=queueid,systemuserid");
  if (!relevantRoleIds.length) return { ids: [], queueMembershipRows };

  const roleFilter = relevantRoleIds.map((id) => `roleid eq ${id}`).join(" or ");
  const directRoleRows = await readAll("systemuserroles", `?$select=systemuserid,roleid&$filter=${roleFilter}`);

  // Dataverse also grants a role to every member of a Dataverse Team the role is assigned to, not
  // just users with a direct role assignment — confirmed live against academyexperiment (see
  // IMPLEMENTATION_STATUS.md "Round 9"): a real team ("Sales-Supervisor") held a renamed Supervisor
  // role directly, with no user in this environment holding that same role individually. Without
  // this, a user who only gets agent access via team membership would never appear on the roster.
  // The team-role intersect entity's logical name ("teamroles") is what belongs here, NOT its
  // EntitySetName ("teamrolescollection") — that distinction only matters for raw REST calls (which
  // is how this was first verified live, against academyexperiment's metadata, and where "teamroles"
  // 404s). `Xrm.WebApi.retrieveMultipleRecords` takes the entity's logical name and resolves the
  // correct endpoint internally, the same as every other entity this tool queries — passing the
  // EntitySetName here instead broke it live with "The entity 'teamrolescollection' cannot be
  // found." (see IMPLEMENTATION_STATUS.md "Round 11" for the full account of this mix-up).
  const relevantTeamRoleRows = await readAll("teamroles", `?$select=teamid,roleid&$filter=${roleFilter}`);
  const relevantTeamIds = [...new Set(relevantTeamRoleRows.map((r) => r.teamid).filter(Boolean))];
  const teamMemberRows = relevantTeamIds.length
    ? await readAll("teammembership", `?$select=systemuserid,teamid&$filter=${relevantTeamIds.map((id) => `teamid eq ${id}`).join(" or ")}`)
    : [];

  const ids = new Set<string>();
  directRoleRows.forEach((r) => { if (r.systemuserid) ids.add(r.systemuserid); });
  teamMemberRows.forEach((r) => { if (r.systemuserid) ids.add(r.systemuserid); });
  return { ids: [...ids], queueMembershipRows };
}

export interface LoadProgress { message: string; }

export interface AgentRosterResult {
  agents: AgentRecord[];
}

export async function loadAgentRoster(relevantRoleIds: string[], onProgress?: (progress: LoadProgress) => void): Promise<AgentRosterResult> {
  const report = (message: string) => onProgress?.({ message });

  report("Finding agents (selected role holders, direct or via team)…");
  const { ids: candidateIds, queueMembershipRows } = await loadCandidateUserIds(relevantRoleIds);
  if (!candidateIds.length) return { agents: [] };

  report(`Loading ${candidateIds.length} agent account(s)…`);
  const userRows = await readByIdBatches("systemuser", "systemuserid", candidateIds, "$select=systemuserid,fullname,domainname,isdisabled,accessmode");

  // A candidate's full effective role list is their own direct assignments UNION every role granted
  // by a Dataverse Team they belong to (see loadCandidateUserIds' comment on "teamroles") — both are
  // equally real from Dataverse's own point of view, so they're merged into one de-duplicated list
  // rather than tracked separately; the "Security roles" check (and the UI's role-group filter)
  // shouldn't need to know or care which mechanism actually granted a given role.
  report("Reading security roles (direct and via team membership)…");
  const directRoleAssignments = await readByIdBatches("systemuserroles", "systemuserid", candidateIds, "$select=systemuserid,roleid");
  const candidateTeamMemberships = await readByIdBatches("teammembership", "systemuserid", candidateIds, "$select=systemuserid,teamid");
  const teamIds = [...new Set(candidateTeamMemberships.map((r) => r.teamid).filter(Boolean))];
  const teamRoleRows = teamIds.length ? await readByIdBatches("teamroles", "teamid", teamIds, "$select=teamid,roleid") : [];
  const roleIdsByTeamId = new Map<string, string[]>();
  teamRoleRows.forEach((r) => { if (r.teamid && r.roleid) roleIdsByTeamId.set(r.teamid, [...(roleIdsByTeamId.get(r.teamid) ?? []), r.roleid]); });

  const roleIdsByUserId = new Map<string, Set<string>>();
  const addRole = (userId: string, roleId: string) => roleIdsByUserId.set(userId, (roleIdsByUserId.get(userId) ?? new Set<string>()).add(roleId));
  directRoleAssignments.forEach((r) => { if (r.systemuserid && r.roleid) addRole(r.systemuserid, r.roleid); });
  candidateTeamMemberships.forEach((r) => {
    if (!r.systemuserid) return;
    (roleIdsByTeamId.get(r.teamid) ?? []).forEach((roleId) => addRole(r.systemuserid, roleId));
  });

  const allInvolvedRoleIds = [...new Set([...directRoleAssignments.map((r) => r.roleid), ...teamRoleRows.map((r) => r.roleid)].filter(Boolean))];
  const roleRows = allInvolvedRoleIds.length ? await readByIdBatches("role", "roleid", allInvolvedRoleIds, "$select=roleid,name") : [];
  const roleNameById = new Map(roleRows.map((r) => [r.roleid, r.name as string]));
  const roleNamesByUserId = new Map<string, string[]>();
  roleIdsByUserId.forEach((roleIdSet, userId) => {
    const names = [...roleIdSet].map((id) => roleNameById.get(id)).filter((n): n is string => !!n);
    roleNamesByUserId.set(userId, [...new Set(names)]);
  });

  report("Reading queue memberships and routing configuration…");
  let reachability: VoiceRoutingReachability | Error;
  try { reachability = await loadVoiceRoutingReachability(); } catch (error) { reachability = error instanceof Error ? error : new Error(String(error)); }

  const queueIds = [...new Set(queueMembershipRows.map((r) => r.queueid).filter(Boolean))];
  const queueRows = queueIds.length ? await readByIdBatches("queue", "queueid", queueIds, "$select=queueid,name,statecode") : [];
  const queueById = new Map(queueRows.map((q) => [q.queueid, q]));
  const membershipsByUserId = new Map<string, QueueMembershipInfo[]>();
  const unitCostsByUserId = new Map<string, number[]>();
  const profileBasedReachByUserId = new Set<string>();
  queueMembershipRows.forEach((row) => {
    const queue = queueById.get(row.queueid);
    if (!row.systemuserid || !queue) return;
    const reachInfo = reachability instanceof Error ? undefined : reachability.reachableQueues.get(row.queueid);
    const info: QueueMembershipInfo = {
      queueId: row.queueid,
      queueName: queue.name ?? row.queueid,
      queueActive: queue.statecode === 0,
      reachableByActiveVoiceWorkstream: !!reachInfo,
      reachingWorkstreamNames: (reachInfo ?? []).map((w) => w.name)
    };
    membershipsByUserId.set(row.systemuserid, [...(membershipsByUserId.get(row.systemuserid) ?? []), info]);
    const costs = (reachInfo ?? []).map((w) => w.capacityRequired).filter((c): c is number => c !== undefined);
    if (costs.length) unitCostsByUserId.set(row.systemuserid, [...(unitCostsByUserId.get(row.systemuserid) ?? []), ...costs]);
    if ((reachInfo ?? []).some((w) => w.profileBasedCapacity)) profileBasedReachByUserId.add(row.systemuserid);
  });

  report("Reading agent capacity…");
  const capacityByUserId = await loadAgentCapacity(candidateIds);

  report("Reading skills…");
  const skillsByUserId = await loadSkills(candidateIds);

  report("Reading presence…");
  const presenceByUserId = await loadPresence(candidateIds);

  const agents = userRows.map((row): AgentRecord => {
    const id = row.systemuserid;
    const memberships = membershipsByUserId.get(id) ?? [];
    const queueSkillRequirements: Field<QueueSkillRequirement[]> = reachability instanceof Error
      ? unknownField(`Could not read routing configuration to determine required skills: ${reachability.message}`)
      : known(memberships.map((m): QueueSkillRequirement => ({
        queueId: m.queueId,
        queueName: m.queueName,
        // required: [] both when a queue's reaching workstream(s) confirm no Skill identification
        // step exists at all (a known fact, not a guess — see queueIdsWithSkillRouting above) and when
        // a step exists but genuinely lists no skills; required: null only when a step exists and this
        // tool's parser couldn't extract a usable requirement from it — see model.ts.
        required: !reachability.queueIdsWithSkillRouting.has(m.queueId) ? [] : (reachability.requiredSkillsByQueue.get(m.queueId) ?? null)
      })));

    const reachableUnitCosts = unitCostsByUserId.get(id) ?? [];

    return {
      id,
      name: row.fullname ?? id,
      domainName: row.domainname,
      disabled: known(row.isdisabled === true),
      accessMode: known(accessModeOf(row.accessmode)),
      securityRoles: known(roleNamesByUserId.get(id) ?? []),
      // Confirmed directly by the environment's own administrator, after two schema dead ends
      // (see IMPLEMENTATION_STATUS.md "Round 6"): this product has no separate per-agent "enable
      // this channel" setting at all — voice access is entirely a function of queue membership and
      // workstream routing, which this tool already determines with high confidence. So rather than
      // guess at a table that doesn't represent this concept, "channels" is derived from that same
      // reachability data — not an independent read.
      channels: reachability instanceof Error
        ? unknownField(`Could not read the routing configuration needed to determine channel access: ${reachability.message}`)
        : known(memberships.some((m) => m.reachableByActiveVoiceWorkstream) ? ["Voice"] : []),
      queueMemberships: reachability instanceof Error
        ? unknownField(`Could not read the routing configuration needed to determine which queues are reachable: ${reachability.message}`)
        : known(memberships),
      agentCapacity: capacityByUserId.get(id) ?? unknownField("Could not read capacity profile assignment."),
      workItemUnitCost: reachability instanceof Error
        ? unknownField(`Could not read the routing configuration needed to determine work-item unit cost: ${reachability.message}`)
        : known(reachableUnitCosts.length ? Math.min(...reachableUnitCosts) : null),
      hasProfileBasedReachableWorkstream: reachability instanceof Error
        ? unknownField(`Could not read the routing configuration needed to determine capacity format: ${reachability.message}`)
        : known(profileBasedReachByUserId.has(id)),
      skills: skillsByUserId.get(id) ?? unknownField("Could not read this agent's skills."),
      queueSkillRequirements,
      presence: presenceByUserId.get(id)?.presence ?? unknownField("Could not read this agent's current presence."),
      // msdyn_agentstatus.msdyn_isblockedbysomeprofile — confirmed live (see model.ts / Round 7).
      capacityBlocked: presenceByUserId.get(id)?.capacityBlocked ?? unknownField("Could not read this agent's current status.")
    };
  });

  return { agents };
}

// Confirmed live against academyexperiment (two rounds — see IMPLEMENTATION_STATUS.md): capacity
// is NOT systemuser.msdyn_capacity (that field exists but was confirmed empty/unused on a real
// agent who nonetheless had capacity profiles assigned in the admin UI). The real chain is
// bookableresource -> msdyn_bookableresourcecapacityprofile (the join table, one row per
// channel/profile assignment, e.g. "Default voice inbound" and "Default voice outbound" were both
// observed on the same agent) -> msdyn_capacityprofile (msdyn_name, msdyn_defaultmaxunits). The
// join row's own msdyn_maxunits overrides the profile's msdyn_defaultmaxunits when set; both were
// observed unset on a real assignment, in which case only the profile default applies.
async function loadAgentCapacity(userIds: string[]): Promise<Map<string, Field<CapacityProfileAssignment[]>>> {
  const result = new Map<string, Field<CapacityProfileAssignment[]>>();
  try {
    const resources = await readByIdBatches("bookableresource", "_userid_value", userIds, "$select=bookableresourceid,_userid_value");
    const resourceUserById = new Map(resources.map((r) => [r.bookableresourceid, r._userid_value]));
    const resourceIds = resources.map((r) => r.bookableresourceid);
    userIds.forEach((id) => result.set(id, known([])));
    if (resourceIds.length) {
      const rows = await readByIdBatches(
        "msdyn_bookableresourcecapacityprofile", "_msdyn_bookableresourceid_value", resourceIds,
        "$select=_msdyn_bookableresourceid_value,msdyn_maxunits&$expand=msdyn_capacityprofileid($select=msdyn_name,msdyn_defaultmaxunits)"
      );
      rows.forEach((row) => {
        const userId = resourceUserById.get(row._msdyn_bookableresourceid_value);
        const profile = row.msdyn_capacityprofileid;
        if (!userId || !profile?.msdyn_name) return;
        const effectiveUnits = typeof row.msdyn_maxunits === "number" ? row.msdyn_maxunits : (typeof profile.msdyn_defaultmaxunits === "number" ? profile.msdyn_defaultmaxunits : null);
        const assignment: CapacityProfileAssignment = { profileName: profile.msdyn_name, effectiveUnits };
        const existing = result.get(userId);
        if (existing?.known) result.set(userId, known([...existing.value, assignment]));
      });
    }
  } catch (error) {
    const reason = `Could not read capacity profile assignment (bookableresource/msdyn_bookableresourcecapacityprofile): ${errorMessage(error)}`;
    userIds.forEach((id) => result.set(id, unknownField(reason)));
  }
  return result;
}

// bookableresourcecharacteristic's lookup to its owning resource is confirmed (via
// EntityDefinitions metadata against academyexperiment) to be logical name "resource" (not
// "bookableresourceid" as originally guessed), and its $expand navigation properties to
// characteristic/ratingvalue use their PascalCase schema names ("Characteristic"/"RatingValue"),
// unlike simple value fields, which are always lowercase. The "_value" filter/select alias itself
// stays lowercase either way (_resource_value) — that convention is separate from $expand casing.
async function loadSkills(userIds: string[]): Promise<Map<string, Field<AgentSkillInfo[]>>> {
  const result = new Map<string, Field<AgentSkillInfo[]>>();
  try {
    const resources = await readByIdBatches("bookableresource", "_userid_value", userIds, "$select=bookableresourceid,_userid_value");
    const resourceUserById = new Map(resources.map((r) => [r.bookableresourceid, r._userid_value]));
    const resourceIds = resources.map((r) => r.bookableresourceid);
    const characteristics = resourceIds.length
      ? await readByIdBatches("bookableresourcecharacteristic", "_resource_value", resourceIds, "$select=_resource_value&$expand=Characteristic($select=name),RatingValue($select=name,value)")
      : [];
    userIds.forEach((id) => result.set(id, known([])));
    characteristics.forEach((row) => {
      const userId = resourceUserById.get(row._resource_value);
      if (!userId || !row.Characteristic?.name) return;
      const skill: AgentSkillInfo = {
        characteristicId: row.Characteristic.characteristicid ?? row.Characteristic.name,
        name: row.Characteristic.name,
        proficiencyLabel: row.RatingValue?.name,
        proficiencyRank: typeof row.RatingValue?.value === "number" ? row.RatingValue.value : undefined
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

interface AgentStatusInfo {
  presence: Field<PresenceInfo | null>;
  capacityBlocked: Field<boolean>;
}

// Confirmed live against academyexperiment: systemuser.msdyn_defaultpresenceiduser (this tool's
// first guess, found via EntityDefinitions metadata) is NOT live/current presence — it's a
// "default" preference field, confirmed empty on a real agent who was actively logged in and
// online at the time, which produced a false "may never have signed in" result. The real live
// status lives on msdyn_agentstatus (one row per agent, updated in real time): msdyn_agentid
// (lookup to systemuser), msdyn_isagentloggedin (boolean — whether the workspace client is
// currently connected, independent of the presence label), msdyn_currentpresenceid (lookup to
// msdyn_presence), and msdyn_isblockedbysomeprofile (boolean — confirmed live in Round 7: "Indicates
// if agent's capacity is currently blocked by any capacity profile and hence, they can't get any
// work assigned", the live signal behind the unified-routing-state check). $expand navigation
// properties here are confirmed lowercase (matching the logical name), unlike the PascalCase ones
// needed for skills — this varies per relationship, not per table, and has to be checked each time
// rather than assumed from a prior finding.
async function loadPresence(userIds: string[]): Promise<Map<string, AgentStatusInfo>> {
  const result = new Map<string, AgentStatusInfo>();
  try {
    const rows = await readByIdBatches(
      "msdyn_agentstatus", "_msdyn_agentid_value", userIds,
      "$select=_msdyn_agentid_value,msdyn_isagentloggedin,msdyn_isblockedbysomeprofile,modifiedon&$expand=msdyn_currentpresenceid($select=msdyn_name)"
    );
    userIds.forEach((id) => result.set(id, { presence: known(null), capacityBlocked: known(false) }));
    rows.forEach((row) => {
      const userId = row._msdyn_agentid_value;
      if (!userId) return;
      const capacityBlocked = known(row.msdyn_isblockedbysomeprofile === true);
      const presence = row.msdyn_currentpresenceid;
      if (!presence?.msdyn_name) { result.set(userId, { presence: known(null), capacityBlocked }); return; }
      const isLoggedIn = typeof row.msdyn_isagentloggedin === "boolean" ? row.msdyn_isagentloggedin : undefined;
      result.set(userId, {
        presence: known({
          name: presence.msdyn_name,
          isLoggedIn,
          allowsAssignment: inferAllowsAssignment(presence.msdyn_name),
          capturedOn: row.modifiedon
        }),
        capacityBlocked
      });
    });
  } catch (error) {
    const reason = `Could not read agent status: ${errorMessage(error)}`;
    userIds.forEach((id) => result.set(id, { presence: unknownField(reason), capacityBlocked: unknownField(reason) }));
  }
  return result;
}
