import { getActiveAgentRoleNames, hasRequiredRole } from "./config";
import { ACCESS_MODE_LABELS, AgentRecord, CapacityProfileAssignment, CheckResult, RequiredSkillInfo, AgentSkillInfo } from "./model";

// Every check function is pure (no I/O) and takes only the normalized AgentRecord, so each is
// unit-testable with a hand-built record and no React/Dataverse involved. Each returns exactly one
// CheckResult; `unknown` is used whenever the AgentRecord field(s) it needs weren't readable, never
// as a stand-in for "confirmed false".

export function checkAccount(agent: AgentRecord): CheckResult {
  const title = "Account is enabled and interactive";
  if (!agent.disabled.known) {
    return { id: "account", category: "account", status: "unknown", title, evidence: agent.disabled.reason, explanation: "A disabled account can never receive work, and a non-interactive (application) user account is never assigned interactive work like calls.", suggestedFix: "Grant this tool read access to the systemuser table, or verify manually in the Power Platform admin center." };
  }
  if (agent.disabled.value) {
    return { id: "account", category: "account", status: "fail", title, evidence: "This user account is disabled.", explanation: "A disabled account can never receive work.", suggestedFix: "Re-enable the user in the Power Platform admin center (Users → select user → Enable)." };
  }
  const accessMode = agent.accessMode.known ? agent.accessMode.value : undefined;
  const accessModeLabel = agent.accessMode.known ? ACCESS_MODE_LABELS[agent.accessMode.value] : agent.accessMode.reason;
  if (accessMode === "nonInteractive") {
    return { id: "account", category: "account", status: "fail", title, evidence: `Account is enabled, but its access mode is "${accessModeLabel}".`, explanation: "Non-interactive (application) users represent service-to-service integrations, not people — unified routing never assigns interactive work like calls to them.", suggestedFix: "If this is meant to be a real agent, change the user's access mode to Read-Write in the admin center. If it's genuinely a service account, it's not expected to receive calls." };
  }
  if (!agent.accessMode.known) {
    return { id: "account", category: "account", status: "unknown", title, evidence: `Account is enabled. Access mode: ${accessModeLabel}`, explanation: "A non-interactive (application) user account is never assigned interactive work like calls.", suggestedFix: "Verify the user's access mode manually in the Power Platform admin center." };
  }
  return { id: "account", category: "account", status: "pass", title, evidence: `Account is enabled. Access mode: ${accessModeLabel}`, explanation: "A disabled or non-interactive account can never receive work." };
}

export function checkSecurityRoles(agent: AgentRecord): CheckResult {
  const title = "Holds a Contact Center agent security role";
  const explanation = "Without one of the configured agent security roles, this user has no access to the Omnichannel/Contact Center agent experience and cannot be assigned or work conversations, regardless of routing configuration.";
  const requiredList = getActiveAgentRoleNames().join(", ") || "(none configured — connect to load your environment's roles)";
  if (!agent.securityRoles.known) {
    return { id: "securityRoles", category: "securityRoles", status: "unknown", title, evidence: agent.securityRoles.reason, explanation, suggestedFix: "Grant this tool read access to systemuserroles/role, or check the user's security roles manually." };
  }
  const roles = agent.securityRoles.value;
  if (hasRequiredRole(roles)) {
    return { id: "securityRoles", category: "securityRoles", status: "pass", title, evidence: `Roles: ${roles.length ? roles.join(", ") : "(none)"}`, evidenceItems: roles.length ? roles : undefined, explanation };
  }
  return {
    id: "securityRoles", category: "securityRoles", status: "fail", title,
    evidence: roles.length ? `Roles: ${roles.join(", ")} — none match a configured agent role.` : "This user has no security roles assigned.",
    evidenceItems: roles.length ? roles : undefined,
    explanation,
    suggestedFix: `Assign one of the roles currently selected as "Agent" (${requiredList}) — or, if this user's real agent role isn't one of them, adjust it in the tool's role picker ("Configure roles").`
  };
}

export function checkChannelEnablement(agent: AgentRecord): CheckResult {
  const title = "Voice channel is enabled for this agent";
  // Confirmed directly by a real environment's own administrator (see IMPLEMENTATION_STATUS.md
  // "Round 6"): there is no separate per-agent "enable this channel" setting in this product —
  // voice access is entirely a function of queue membership and workstream routing. So this check
  // is deliberately derived from the same data as Queue membership / Workstream reachability below,
  // not an independent source — the three checks describe the same underlying fact from different
  // angles (which is expected, not duplication for its own sake), and this one states the practical
  // conclusion plainly rather than making an admin infer it from the other two.
  const explanation = "This product has no separate per-agent voice-channel toggle — whether an agent can receive voice work is entirely determined by whether they belong to a queue that an active inbound voice workstream actually routes to.";
  if (!agent.channels.known) {
    return { id: "channelEnablement", category: "channelEnablement", status: "unknown", title, evidence: agent.channels.reason, explanation, suggestedFix: "Grant this tool read access to queuemembership and the routing configuration tables, or check Queue membership / Workstream reachability manually." };
  }
  const channels = agent.channels.value;
  const hasVoice = channels.some((c) => c.toLowerCase() === "voice");
  if (hasVoice) return { id: "channelEnablement", category: "channelEnablement", status: "pass", title, evidence: `Enabled channels: ${channels.join(", ")}`, evidenceItems: channels.length ? channels : undefined, explanation };
  return {
    id: "channelEnablement", category: "channelEnablement", status: "fail", title,
    evidence: "No channels are enabled for this agent — see Queue membership and Workstream reachability for why.",
    explanation,
    suggestedFix: "Add this agent to a queue that an active inbound voice workstream routes to — see the suggested fixes on Queue membership / Workstream reachability."
  };
}

export function checkQueueMembership(agent: AgentRecord): CheckResult {
  const title = "Belongs to at least one active, routable queue";
  const explanation = "An agent only receives work through queues they're a member of. Membership in a queue that's disabled or that no active workstream actually routes to gives them no practical path to receiving calls.";
  if (!agent.queueMemberships.known) {
    return { id: "queueMembership", category: "queueMembership", status: "unknown", title, evidence: agent.queueMemberships.reason, explanation, suggestedFix: "Grant this tool read access to queuemembership, or check the agent's queues manually." };
  }
  const memberships = agent.queueMemberships.value;
  if (!memberships.length) {
    return { id: "queueMembership", category: "queueMembership", status: "fail", title, evidence: "This agent is not a member of any queue.", explanation, suggestedFix: "Add this agent as a member of at least one queue that an active inbound voice workstream routes to." };
  }
  const usable = memberships.filter((m) => m.queueActive && m.reachableByActiveVoiceWorkstream);
  const items = memberships.map((m) => `${m.queueName} — ${m.queueActive ? "active" : "disabled"}, ${m.reachableByActiveVoiceWorkstream ? "routed to" : "not routed to"}`);
  const summary = memberships.map((m) => `${m.queueName} (${m.queueActive ? "active" : "disabled"}, ${m.reachableByActiveVoiceWorkstream ? "routed to" : "not routed to"})`).join("; ");
  if (usable.length) return { id: "queueMembership", category: "queueMembership", status: "pass", title, evidence: `Queues: ${summary}`, evidenceItems: items, explanation };
  return { id: "queueMembership", category: "queueMembership", status: "fail", title, evidence: `Queues: ${summary} — none are both active and reachable by an active voice workstream.`, evidenceItems: items, explanation, suggestedFix: "Either add this agent to a queue that's actually routed to by an active inbound voice workstream, or activate the workstream/queue-routing rule that should reach their current queue(s)." };
}

export function checkWorkstreamReachability(agent: AgentRecord): CheckResult {
  const title = "An active voice workstream can route to this agent";
  const explanation = "Even with correct queue membership, this agent only receives calls if at least one active inbound voice workstream's routing configuration actually targets one of their queues (directly, or as its fallback).";
  if (!agent.queueMemberships.known) {
    return { id: "workstreamReachability", category: "workstreamReachability", status: "unknown", title, evidence: agent.queueMemberships.reason, explanation, suggestedFix: "Grant this tool read access to queuemembership and the routing configuration tables, or verify manually with Visual Routing Tester." };
  }
  const reaching = new Map<string, string[]>();
  agent.queueMemberships.value.forEach((m) => { if (m.reachableByActiveVoiceWorkstream) reaching.set(m.queueName, m.reachingWorkstreamNames); });
  if (!reaching.size) {
    return { id: "workstreamReachability", category: "workstreamReachability", status: "fail", title, evidence: "No active inbound voice workstream routes to any queue this agent belongs to.", explanation, suggestedFix: "Use Visual Routing Tester to confirm which workstream(s) should reach this agent's queue, and check the queue-routing rule and fallback queue configuration." };
  }
  const items = [...reaching.entries()].map(([queue, workstreams]) => `${queue} ← ${workstreams.length ? workstreams.join(", ") : "an active workstream"}`);
  return { id: "workstreamReachability", category: "workstreamReachability", status: "pass", title, evidence: `Reachable via: ${items.join("; ")}`, evidenceItems: items, explanation };
}

// Capacity is assigned per channel/profile (e.g. an agent can have separate "Default voice inbound"
// and "Default voice outbound" assignments), not one flat number — this picks the single value most
// relevant to inbound voice (what this tool evaluates) out of however many profiles an agent has.
// Prefers a profile whose name mentions "inbound"; falls back to the smallest usable value across
// all of them (the conservative choice when no profile is clearly the voice-inbound one), since
// there's no confirmed link from a workstream to a specific capacity profile to match on instead.
function relevantCapacity(assignments: CapacityProfileAssignment[]): number | null {
  const usable = assignments.filter((a): a is CapacityProfileAssignment & { effectiveUnits: number } => a.effectiveUnits !== null);
  if (!usable.length) return null;
  const inbound = usable.find((a) => /inbound/i.test(a.profileName));
  return inbound ? inbound.effectiveUnits : Math.min(...usable.map((a) => a.effectiveUnits));
}

export function checkCapacityProfile(agent: AgentRecord): CheckResult {
  const title = "Capacity is sufficient for this agent to be assigned work";
  const explanation = "An agent needs a capacity-profile assignment with enough effective capacity to cover at least one work item's unit cost. If their capacity is lower than a workstream's unit cost — including a capacity of exactly 0 or an assignment with no value set — unified routing can never assign that work to them, regardless of everything else being configured correctly.";
  if (!agent.agentCapacity.known) {
    return { id: "capacityProfile", category: "capacityProfile", status: "unknown", title, evidence: agent.agentCapacity.reason, explanation, suggestedFix: "Grant this tool read access to bookableresource/msdyn_bookableresourcecapacityprofile, or check the agent's capacity profile manually in the Customer Service admin center." };
  }
  const assignments = agent.agentCapacity.value;
  if (!assignments.length) {
    return { id: "capacityProfile", category: "capacityProfile", status: "fail", title, evidence: "No capacity profile is assigned to this agent.", explanation, suggestedFix: "Assign a capacity profile to this agent in the Customer Service admin center under Users." };
  }
  const items = assignments.map((a) => `${a.profileName}: ${a.effectiveUnits === null ? "no value set" : `${a.effectiveUnits} unit${a.effectiveUnits === 1 ? "" : "s"}`}`);
  const profileNames = assignments.map((a) => a.profileName).join(", ");
  const capacity = relevantCapacity(assignments);
  if (capacity === null) {
    return { id: "capacityProfile", category: "capacityProfile", status: "fail", title, evidence: `Capacity profile(s): ${profileNames}. None have a usable capacity value set.`, evidenceItems: items, explanation, suggestedFix: "Set a capacity value (directly on the assignment, or via the profile's default) for at least one of this agent's capacity profiles." };
  }
  if (capacity === 0) {
    return { id: "capacityProfile", category: "capacityProfile", status: "fail", title, evidence: `Capacity profile(s): ${profileNames}. Effective capacity is 0.`, evidenceItems: items, explanation, suggestedFix: "Increase this agent's capacity above 0 in the Customer Service admin center under Users." };
  }
  const capacityEvidence = `Capacity profile(s): ${profileNames}. Effective capacity: ${capacity}.`;
  if (!agent.workItemUnitCost.known) {
    return { id: "capacityProfile", category: "capacityProfile", status: "unknown", title, evidence: `${capacityEvidence} ${agent.workItemUnitCost.reason}`, evidenceItems: items, explanation, suggestedFix: "Verify manually that this agent's capacity is at least as large as the relevant workstream's msdyn_capacityrequired value." };
  }
  if (agent.workItemUnitCost.value === null) {
    // Two different reasons land here, and they mean opposite things: either nothing reachable
    // uses a "Unit based" capacity format to compare against (fine — under "Profile based" capacity
    // a non-zero profile assignment is sufficient on its own, no comparison needed), or nothing is
    // reachable at all (genuinely nothing to compare against, worth flagging).
    if (agent.hasProfileBasedReachableWorkstream.known && agent.hasProfileBasedReachableWorkstream.value) {
      return { id: "capacityProfile", category: "capacityProfile", status: "pass", title, evidence: `${capacityEvidence} This agent's reachable voice workstream(s) use "Profile based" capacity — a non-zero capacity-profile assignment is sufficient; no unit-based comparison applies.`, evidenceItems: items, explanation };
    }
    return { id: "capacityProfile", category: "capacityProfile", status: "warn", title, evidence: `${capacityEvidence} No reachable voice workstream was found to compare against — see Workstream reachability.`, evidenceItems: items, explanation };
  }
  const unitCost = agent.workItemUnitCost.value;
  if (capacity < unitCost) {
    return { id: "capacityProfile", category: "capacityProfile", status: "fail", title, evidence: `${capacityEvidence} The smallest reachable work item costs ${unitCost} capacity units — more than this agent's capacity.`, evidenceItems: items, explanation, suggestedFix: `Increase this agent's capacity to at least ${unitCost}.` };
  }
  return { id: "capacityProfile", category: "capacityProfile", status: "pass", title, evidence: `${capacityEvidence} Sufficient for the smallest reachable work item (${unitCost} capacity units).`, evidenceItems: items, explanation };
}

function proficiencyMet(required: RequiredSkillInfo, actual: AgentSkillInfo | undefined): boolean {
  if (!actual) return false;
  if (required.minProficiencyRank === undefined) return true;
  return actual.proficiencyRank !== undefined && actual.proficiencyRank >= required.minProficiencyRank;
}

export function checkSkills(agent: AgentRecord): CheckResult {
  const title = "Has the skills required by their reachable queues";
  const explanation = "When a queue's routing rules require specific skills (with a minimum proficiency), only agents holding those skills at that proficiency can be matched to that work — missing or under-proficient skills silently exclude an otherwise-eligible agent.";
  if (!agent.skills.known) {
    return { id: "skills", category: "skills", status: "unknown", title, evidence: agent.skills.reason, explanation, suggestedFix: "Grant this tool read access to bookableresourcecharacteristic, or check the agent's skills manually." };
  }
  if (!agent.queueSkillRequirements.known) {
    return { id: "skills", category: "skills", status: "unknown", title, evidence: agent.queueSkillRequirements.reason, explanation, suggestedFix: "Verify required skills manually on the relevant queue's routing rule." };
  }
  const byName = new Map(agent.skills.value.map((s) => [s.name.toLowerCase(), s]));
  const determinable = agent.queueSkillRequirements.value.filter((q) => q.required !== null);
  const undeterminable = agent.queueSkillRequirements.value.filter((q) => q.required === null);
  const skillItems = agent.skills.value.map((s) => s.proficiencyLabel ? `${s.name} (${s.proficiencyLabel})` : s.name);
  const skillsEvidence = skillItems.length ? skillItems.join(", ") : "(no skills recorded)";

  if (!determinable.length) {
    return { id: "skills", category: "skills", status: "unknown", title, evidence: `Agent skills: ${skillsEvidence}. Required skills for this agent's queue(s) could not be determined from the routing configuration.`, evidenceItems: skillItems.length ? skillItems : undefined, explanation, suggestedFix: "Verify required skills manually on the relevant queue's routing rule (Skills step)." };
  }

  const missingByQueue = determinable
    .map((q) => ({ queueName: q.queueName, missing: (q.required ?? []).filter((req) => !proficiencyMet(req, byName.get(req.name.toLowerCase()))) }))
    .filter((entry) => entry.missing.length > 0);

  if (missingByQueue.length) {
    const missingEvidence = missingByQueue.map((entry) => `${entry.queueName} needs ${entry.missing.map((m) => m.minProficiencyLabel ? `${m.name} (${m.minProficiencyLabel}+)` : m.name).join(", ")}`).join("; ");
    return { id: "skills", category: "skills", status: "fail", title, evidence: `Agent skills: ${skillsEvidence}. Missing: ${missingEvidence}.`, evidenceItems: skillItems.length ? skillItems : undefined, explanation, suggestedFix: "Add the missing skill(s) at the required proficiency to this agent's profile, or adjust the queue's skill requirements if they're no longer accurate." };
  }
  if (undeterminable.length) {
    return { id: "skills", category: "skills", status: "warn", title, evidence: `Agent skills: ${skillsEvidence}. All determinable skill requirements are met, but requirements for ${undeterminable.length} queue(s) could not be verified.`, evidenceItems: skillItems.length ? skillItems : undefined, explanation };
  }
  return { id: "skills", category: "skills", status: "pass", title, evidence: `Agent skills: ${skillsEvidence}. All required skills for this agent's reachable queues are met.`, evidenceItems: skillItems.length ? skillItems : undefined, explanation };
}

export function checkPresence(agent: AgentRecord): CheckResult {
  const title = "Current presence allows assignment";
  const explanation = "Presence is a point-in-time snapshot, not a structural blocker — an agent correctly set up in every other way still won't be assigned work while their presence is Offline/Away or similar, or while their workspace client isn't logged in at all. Re-check this if the agent says they're currently at their desk and available.";
  if (!agent.presence.known) {
    return { id: "presence", category: "presence", status: "unknown", title, evidence: agent.presence.reason, explanation, suggestedFix: "Check the agent's current presence in the Omnichannel/Customer Service Workspace app directly." };
  }
  if (agent.presence.value === null) {
    return { id: "presence", category: "presence", status: "warn", title, evidence: "No current status record was found for this agent (they may never have signed in to the agent workspace).", explanation, suggestedFix: "Confirm the agent has signed in to Customer Service workspace / Omnichannel at least once." };
  }
  const presence = agent.presence.value;
  const capturedNote = presence.capturedOn ? ` (as of ${presence.capturedOn})` : "";
  if (presence.isLoggedIn === false) {
    return { id: "presence", category: "presence", status: "warn", title, evidence: `Not currently logged in to the workspace client. Last known presence: ${presence.name}${capturedNote}.`, explanation, suggestedFix: "Have the agent sign in to Customer Service workspace / Omnichannel — being logged out overrides whatever their last presence status says." };
  }
  const loginNote = presence.isLoggedIn === undefined ? " (login status could not be confirmed)" : "";
  if (presence.allowsAssignment === true) return { id: "presence", category: "presence", status: "pass", title, evidence: `Currently logged in. Presence: ${presence.name}${capturedNote}${loginNote}.`, explanation };
  if (presence.allowsAssignment === false) return { id: "presence", category: "presence", status: "warn", title, evidence: `Currently logged in. Presence: ${presence.name}${capturedNote}${loginNote} — this status does not allow new assignments.`, explanation, suggestedFix: "If the agent believes they should be receiving work now, have them set their presence to an available status." };
  return { id: "presence", category: "presence", status: "warn", title, evidence: `Currently logged in. Presence: ${presence.name}${capturedNote}${loginNote} — whether this status allows assignment could not be determined.`, explanation };
}

export function checkUnifiedRoutingState(agent: AgentRecord): CheckResult {
  const title = "Not currently blocked from new work by capacity";
  // No separate "explicitly excluded/opted out" admin toggle was found to exist in this product after
  // a broad search (see model.ts / IMPLEMENTATION_STATUS.md "Round 7") — this check instead reports
  // the real, live signal unified routing itself tracks: whether the agent has hit the ceiling of
  // every capacity profile assigned to them, so no new work of any kind is being assigned right now.
  const explanation = "Unlike the capacity check above (which verifies a big-enough profile is assigned at all), this reflects the agent's current, real-time utilization against that profile. While blocked, unified routing assigns them no new work even though everything else about their setup is correct — and unlike a structural misconfiguration, it clears on its own as their active work drops back under the limit.";
  if (!agent.capacityBlocked.known) {
    return { id: "unifiedRoutingState", category: "unifiedRoutingState", status: "unknown", title, evidence: agent.capacityBlocked.reason, explanation, suggestedFix: "Check the agent's current capacity utilization in the Customer Service admin center, or re-check once they've signed in to the agent workspace." };
  }
  if (agent.capacityBlocked.value) {
    return { id: "unifiedRoutingState", category: "unifiedRoutingState", status: "warn", title, evidence: "This agent is currently blocked from new work — they're at capacity across their assigned capacity profile(s).", explanation, suggestedFix: "Usually no action needed — this clears automatically once the agent's active work drops below their capacity limit. If it persists longer than expected, check their capacity profile assignment and current work item load." };
  }
  return { id: "unifiedRoutingState", category: "unifiedRoutingState", status: "pass", title, evidence: "Not currently blocked from new work by capacity.", explanation };
}

export function runAllChecks(agent: AgentRecord): CheckResult[] {
  return [
    checkAccount(agent),
    checkSecurityRoles(agent),
    checkChannelEnablement(agent),
    checkQueueMembership(agent),
    checkWorkstreamReachability(agent),
    checkCapacityProfile(agent),
    checkSkills(agent),
    checkPresence(agent),
    checkUnifiedRoutingState(agent)
  ];
}
