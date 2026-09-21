import { hasRequiredRole, REQUIRED_SECURITY_ROLE_NAMES } from "./config";
import { ACCESS_MODE_LABELS, AgentRecord, CheckResult, RequiredSkillInfo, AgentSkillInfo } from "./model";

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
  const requiredList = REQUIRED_SECURITY_ROLE_NAMES.join(", ");
  if (!agent.securityRoles.known) {
    return { id: "securityRoles", category: "securityRoles", status: "unknown", title, evidence: agent.securityRoles.reason, explanation, suggestedFix: "Grant this tool read access to systemuserroles/role, or check the user's security roles manually." };
  }
  const roles = agent.securityRoles.value;
  if (hasRequiredRole(roles)) {
    return { id: "securityRoles", category: "securityRoles", status: "pass", title, evidence: `Roles: ${roles.length ? roles.join(", ") : "(none)"}`, explanation };
  }
  return {
    id: "securityRoles", category: "securityRoles", status: "fail", title,
    evidence: roles.length ? `Roles: ${roles.join(", ")} — none match a configured agent role.` : "This user has no security roles assigned.",
    explanation,
    suggestedFix: `Assign one of the configured agent roles (${requiredList}) — or add this environment's actual agent role name to REQUIRED_SECURITY_ROLE_NAMES in config.ts if it's not in that list.`
  };
}

export function checkChannelEnablement(agent: AgentRecord): CheckResult {
  const title = "Voice channel is enabled for this agent";
  const explanation = "An agent must be enabled for the voice channel to receive voice work specifically, even if everything else about their setup is correct.";
  if (!agent.channels.known) {
    return { id: "channelEnablement", category: "channelEnablement", status: "unknown", title, evidence: agent.channels.reason, explanation, suggestedFix: "This environment's per-agent channel configuration could not be confirmed from this tool; verify manually in the Customer Service admin center under Users → Channels. Queue membership and workstream reachability below are a reliable proxy for practical voice access." };
  }
  const channels = agent.channels.value;
  const hasVoice = channels.some((c) => c.toLowerCase() === "voice");
  if (hasVoice) return { id: "channelEnablement", category: "channelEnablement", status: "pass", title, evidence: `Enabled channels: ${channels.join(", ")}`, explanation };
  return {
    id: "channelEnablement", category: "channelEnablement", status: "fail", title,
    evidence: channels.length ? `Enabled channels: ${channels.join(", ")} — voice is not among them.` : "No channels are enabled for this agent.",
    explanation,
    suggestedFix: "Enable the Voice channel for this agent in the Customer Service admin center under Users → Channels."
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
  const summary = memberships.map((m) => `${m.queueName} (${m.queueActive ? "active" : "disabled"}, ${m.reachableByActiveVoiceWorkstream ? "routed to" : "not routed to"})`).join("; ");
  if (usable.length) return { id: "queueMembership", category: "queueMembership", status: "pass", title, evidence: `Queues: ${summary}`, explanation };
  return { id: "queueMembership", category: "queueMembership", status: "fail", title, evidence: `Queues: ${summary} — none are both active and reachable by an active voice workstream.`, explanation, suggestedFix: "Either add this agent to a queue that's actually routed to by an active inbound voice workstream, or activate the workstream/queue-routing rule that should reach their current queue(s)." };
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
  const evidence = [...reaching.entries()].map(([queue, workstreams]) => `${queue} ← ${workstreams.length ? workstreams.join(", ") : "an active workstream"}`).join("; ");
  return { id: "workstreamReachability", category: "workstreamReachability", status: "pass", title, evidence, explanation };
}

export function checkCapacityProfile(agent: AgentRecord): CheckResult {
  const title = "Capacity profile allows this agent to be assigned work";
  const explanation = "An agent needs a capacity profile with enough total capacity to cover at least one work item's unit cost. If their capacity is lower than a workstream's unit cost, unified routing can never assign that work to them — not a matter of luck or timing, it's structurally impossible.";
  if (!agent.capacityProfile.known) {
    return { id: "capacityProfile", category: "capacityProfile", status: "unknown", title, evidence: agent.capacityProfile.reason, explanation, suggestedFix: "Grant this tool read access to the capacity profile table, or check the agent's capacity profile manually in the Customer Service admin center." };
  }
  if (agent.capacityProfile.value === null) {
    return { id: "capacityProfile", category: "capacityProfile", status: "fail", title, evidence: "No capacity profile is assigned to this agent.", explanation, suggestedFix: "Assign a capacity profile to this agent in the Customer Service admin center under Users." };
  }
  const profile = agent.capacityProfile.value;
  const profileEvidence = `Capacity profile "${profile.name}" — total capacity ${profile.totalCapacity}.`;
  if (!agent.workItemUnitCost.known) {
    return { id: "capacityProfile", category: "capacityProfile", status: "unknown", title, evidence: `${profileEvidence} ${agent.workItemUnitCost.reason}`, explanation, suggestedFix: "Verify manually that this agent's total capacity is at least as large as the relevant workstream's work-item unit cost." };
  }
  if (agent.workItemUnitCost.value === null) {
    return { id: "capacityProfile", category: "capacityProfile", status: "warn", title, evidence: `${profileEvidence} No reachable voice workstream was found to compare against — see Workstream reachability.`, explanation };
  }
  const unitCost = agent.workItemUnitCost.value;
  if (profile.totalCapacity < unitCost) {
    return { id: "capacityProfile", category: "capacityProfile", status: "fail", title, evidence: `${profileEvidence} The smallest reachable work item costs ${unitCost} capacity units — more than this agent's total capacity.`, explanation, suggestedFix: `Increase this agent's capacity profile total capacity to at least ${unitCost}, or assign a different capacity profile.` };
  }
  return { id: "capacityProfile", category: "capacityProfile", status: "pass", title, evidence: `${profileEvidence} Sufficient for the smallest reachable work item (${unitCost} capacity units).`, explanation };
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
  const skillsEvidence = agent.skills.value.length ? agent.skills.value.map((s) => s.proficiencyLabel ? `${s.name} (${s.proficiencyLabel})` : s.name).join(", ") : "(no skills recorded)";

  if (!determinable.length) {
    return { id: "skills", category: "skills", status: "unknown", title, evidence: `Agent skills: ${skillsEvidence}. Required skills for this agent's queue(s) could not be determined from the routing configuration.`, explanation, suggestedFix: "Verify required skills manually on the relevant queue's routing rule (Skills step)." };
  }

  const missingByQueue = determinable
    .map((q) => ({ queueName: q.queueName, missing: (q.required ?? []).filter((req) => !proficiencyMet(req, byName.get(req.name.toLowerCase()))) }))
    .filter((entry) => entry.missing.length > 0);

  if (missingByQueue.length) {
    const missingEvidence = missingByQueue.map((entry) => `${entry.queueName} needs ${entry.missing.map((m) => m.minProficiencyLabel ? `${m.name} (${m.minProficiencyLabel}+)` : m.name).join(", ")}`).join("; ");
    return { id: "skills", category: "skills", status: "fail", title, evidence: `Agent skills: ${skillsEvidence}. Missing: ${missingEvidence}.`, explanation, suggestedFix: "Add the missing skill(s) at the required proficiency to this agent's profile, or adjust the queue's skill requirements if they're no longer accurate." };
  }
  if (undeterminable.length) {
    return { id: "skills", category: "skills", status: "warn", title, evidence: `Agent skills: ${skillsEvidence}. All determinable skill requirements are met, but requirements for ${undeterminable.length} queue(s) could not be verified.`, explanation };
  }
  return { id: "skills", category: "skills", status: "pass", title, evidence: `Agent skills: ${skillsEvidence}. All required skills for this agent's reachable queues are met.`, explanation };
}

export function checkPresence(agent: AgentRecord): CheckResult {
  const title = "Current presence allows assignment";
  const explanation = "Presence is a point-in-time snapshot, not a structural blocker — an agent correctly set up in every other way still won't be assigned work while their presence is Offline/Away or similar. Re-check this if the agent says they're currently at their desk and available.";
  if (!agent.presence.known) {
    return { id: "presence", category: "presence", status: "unknown", title, evidence: agent.presence.reason, explanation, suggestedFix: "Check the agent's current presence in the Omnichannel/Customer Service Workspace app directly." };
  }
  if (agent.presence.value === null) {
    return { id: "presence", category: "presence", status: "warn", title, evidence: "No current presence record was found for this agent (they may never have signed in to the agent workspace).", explanation, suggestedFix: "Confirm the agent has signed in to Customer Service workspace / Omnichannel at least once." };
  }
  const presence = agent.presence.value;
  const capturedNote = presence.capturedOn ? ` (as of ${presence.capturedOn})` : "";
  if (presence.allowsAssignment === true) return { id: "presence", category: "presence", status: "pass", title, evidence: `Current presence: ${presence.name}${capturedNote}.`, explanation };
  if (presence.allowsAssignment === false) return { id: "presence", category: "presence", status: "warn", title, evidence: `Current presence: ${presence.name}${capturedNote} — this status does not allow new assignments.`, explanation, suggestedFix: "If the agent believes they should be receiving work now, have them set their presence to an available status." };
  return { id: "presence", category: "presence", status: "warn", title, evidence: `Current presence: ${presence.name}${capturedNote} — whether this status allows assignment could not be determined.`, explanation };
}

export function checkUnifiedRoutingState(agent: AgentRecord): CheckResult {
  const title = "Not excluded from unified routing assignment";
  const explanation = "Some environments support explicitly excluding or opting an agent out of automatic assignment, independent of everything else being correctly configured.";
  if (!agent.routingExclusion.known) {
    return { id: "unifiedRoutingState", category: "unifiedRoutingState", status: "unknown", title, evidence: agent.routingExclusion.reason, explanation, suggestedFix: "Not verifiable via read-only client-side access in this environment — if this agent's assignment seems otherwise correctly configured but they still aren't receiving work, ask a Contact Center administrator to check for an explicit assignment exclusion or opt-out." };
  }
  if (agent.routingExclusion.value) {
    return { id: "unifiedRoutingState", category: "unifiedRoutingState", status: "fail", title, evidence: "This agent is explicitly excluded from unified routing assignment.", explanation, suggestedFix: "Remove the assignment exclusion/opt-out for this agent if it's no longer intended." };
  }
  return { id: "unifiedRoutingState", category: "unifiedRoutingState", status: "pass", title, evidence: "No assignment exclusion found for this agent.", explanation };
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
