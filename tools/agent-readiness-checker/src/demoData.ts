import { AgentRecord, QueueMembershipInfo, QueueSkillRequirement, known, unknownField } from "./model";

// A realistic-looking sample environment: two active-voice-reachable queues with skill
// requirements, one queue that exists but nothing active routes to (the "unused queue" scenario),
// and one disabled queue — enough topology to make every check's evidence read naturally rather
// than as obviously-synthetic placeholder text.
const SUPPORT_QUEUE = { queueId: "queue-support", queueName: "Support Queue (Voice)" };
const VIP_QUEUE = { queueId: "queue-vip", queueName: "VIP Support Queue (Voice)" };
const OVERFLOW_QUEUE = { queueId: "queue-overflow", queueName: "Overflow Voice Queue" };
const LEGACY_QUEUE = { queueId: "queue-legacy", queueName: "Legacy Chat Queue" };
const RETIRED_QUEUE = { queueId: "queue-retired", queueName: "Retired Overflow Queue" };

const WORKSTREAM = "Inbound Voice — Customer Care";
const OVERFLOW_WORKSTREAM = "Inbound Voice — Customer Care (Overflow)";

function membership(queue: { queueId: string; queueName: string }, opts: Partial<QueueMembershipInfo> = {}): QueueMembershipInfo {
  return { queueId: queue.queueId, queueName: queue.queueName, queueActive: true, reachableByActiveVoiceWorkstream: true, reachingWorkstreamNames: [WORKSTREAM], ...opts };
}

const DUTCH_INTERMEDIATE = { name: "Dutch", minProficiencyLabel: "Intermediate", minProficiencyRank: 2 };
const DUTCH_ADVANCED = { name: "Dutch", minProficiencyLabel: "Advanced", minProficiencyRank: 3 };
const BILLING_INTERMEDIATE = { name: "Billing", minProficiencyLabel: "Intermediate", minProficiencyRank: 2 };

function requirement(queue: { queueId: string; queueName: string }, required: QueueSkillRequirement["required"]): QueueSkillRequirement {
  return { queueId: queue.queueId, queueName: queue.queueName, required };
}

// A fully healthy baseline — every field known, every check passes. Individual demo agents override
// just the field(s) needed to tell their specific story.
function healthy(overrides: Partial<AgentRecord>): AgentRecord {
  return {
    id: overrides.id ?? "demo-agent",
    name: overrides.name ?? "Demo Agent",
    domainName: overrides.domainName,
    disabled: known(false),
    accessMode: known("readWrite"),
    securityRoles: known(["Customer Service Agent"]),
    channels: known(["Voice", "Chat"]),
    queueMemberships: known([membership(SUPPORT_QUEUE)]),
    agentCapacity: known(100),
    workItemUnitCost: known(100),
    skills: known([{ characteristicId: "skill-nl", name: "Dutch", proficiencyLabel: "Expert", proficiencyRank: 4 }]),
    queueSkillRequirements: known([requirement(SUPPORT_QUEUE, [DUTCH_INTERMEDIATE])]),
    presence: known({ name: "Available", allowsAssignment: true, capturedOn: "2026-09-21T09:02:00Z" }),
    routingExclusion: known(false),
    ...overrides
  };
}

export const DEMO_AGENTS: AgentRecord[] = [
  // --- Fully healthy agents -----------------------------------------------------------------
  healthy({ id: "a-ada", name: "Ada Lovelace", domainName: "ada.lovelace@contoso.com" }),
  healthy({
    id: "a-grace", name: "Grace Hopper", domainName: "grace.hopper@contoso.com",
    queueMemberships: known([membership(VIP_QUEUE)]),
    skills: known([{ characteristicId: "skill-nl", name: "Dutch", proficiencyLabel: "Advanced", proficiencyRank: 3 }, { characteristicId: "skill-bill", name: "Billing", proficiencyLabel: "Intermediate", proficiencyRank: 2 }]),
    queueSkillRequirements: known([requirement(VIP_QUEUE, [DUTCH_ADVANCED, BILLING_INTERMEDIATE])])
  }),
  healthy({ id: "a-alan", name: "Alan Turing", domainName: "alan.turing@contoso.com" }),

  // --- The seven explicitly required failure scenarios --------------------------------------
  healthy({ id: "a-katherine", name: "Katherine Johnson", domainName: "katherine.johnson@contoso.com", disabled: known(true) }), // disabled account
  healthy({ id: "a-margaret", name: "Margaret Hamilton", domainName: "margaret.hamilton@contoso.com", securityRoles: known(["Sales Manager"]) }), // missing security role
  healthy({ id: "a-hedy", name: "Hedy Lamarr", domainName: "hedy.lamarr@contoso.com", channels: known(["Chat"]) }), // voice channel disabled
  healthy({
    id: "a-radia", name: "Radia Perlman", domainName: "radia.perlman@contoso.com",
    queueMemberships: known([membership(LEGACY_QUEUE, { reachableByActiveVoiceWorkstream: false, reachingWorkstreamNames: [] })]),
    workItemUnitCost: known(null),
    queueSkillRequirements: known([requirement(LEGACY_QUEUE, null)])
  }), // queue membership only in an unused queue
  healthy({ id: "a-annie", name: "Annie Easley", domainName: "annie.easley@contoso.com", agentCapacity: known(null) }), // no capacity configured
  healthy({ id: "a-mary", name: "Mary Jackson", domainName: "mary.jackson@contoso.com", agentCapacity: known(50), workItemUnitCost: known(100) }), // capacity too low
  healthy({ id: "a-dorothy", name: "Dorothy Vaughan", domainName: "dorothy.vaughan@contoso.com", skills: known([]) }), // missing required skill

  // --- Additional realistic variety ----------------------------------------------------------
  healthy({
    id: "a-joan", name: "Joan Clarke", domainName: "joan.clarke@contoso.com",
    queueMemberships: known([membership(VIP_QUEUE)]),
    skills: known([{ characteristicId: "skill-nl", name: "Dutch", proficiencyLabel: "Beginner", proficiencyRank: 1 }]),
    queueSkillRequirements: known([requirement(VIP_QUEUE, [DUTCH_ADVANCED, BILLING_INTERMEDIATE])])
  }), // skill present but below required proficiency, and a second missing skill
  healthy({ id: "a-elizabeth", name: "Elizabeth Feinler", domainName: "elizabeth.feinler@contoso.com", presence: known({ name: "Away", allowsAssignment: false, capturedOn: "2026-09-21T09:40:00Z" }) }), // presence warn: away
  healthy({ id: "a-sophie", name: "Sophie Wilson", domainName: "sophie.wilson@contoso.com", presence: known(null) }), // presence warn: no record found
  healthy({
    id: "a-frances", name: "Frances Allen", domainName: "frances.allen@contoso.com",
    queueMemberships: known([membership(SUPPORT_QUEUE), membership(OVERFLOW_QUEUE, { reachingWorkstreamNames: [OVERFLOW_WORKSTREAM] })]),
    queueSkillRequirements: known([requirement(SUPPORT_QUEUE, [DUTCH_INTERMEDIATE]), requirement(OVERFLOW_QUEUE, null)])
  }), // skills warn: determinable requirements met, one queue's requirements undetermined
  healthy({ id: "a-barbara", name: "Barbara Liskov", domainName: "barbara.liskov@contoso.com", disabled: unknownField("No permission to read \"systemuser.isdisabled\" for this record (demo).") }), // account unknown
  healthy({ id: "a-adele", name: "Adele Goldberg", domainName: "adele.goldberg@contoso.com", securityRoles: unknownField("No permission to read \"systemuserroles\" (demo).") }), // security roles unknown
  healthy({
    id: "a-karen", name: "Karen Spärck Jones", domainName: "karen.sparckjones@contoso.com",
    queueMemberships: unknownField("Could not read the routing configuration needed to determine which queues are reachable (demo)."),
    queueSkillRequirements: unknownField("Could not read routing configuration to determine required skills (demo).")
  }), // queue membership + workstream reachability + skills all unknown together (realistic: one root cause)
  healthy({ id: "a-feifei", name: "Fei-Fei Li", domainName: "feifei.li@contoso.com", agentCapacity: unknownField("Could not read systemuser.msdyn_Capacity (demo).") }), // capacity unknown
  healthy({ id: "a-shafi", name: "Shafi Goldwasser", domainName: "shafi.goldwasser@contoso.com", routingExclusion: known(true) }), // explicitly excluded from assignment
  healthy({
    id: "a-cynthia", name: "Cynthia Breazeal", domainName: "cynthia.breazeal@contoso.com",
    accessMode: known("nonInteractive"),
    securityRoles: known([]),
    channels: known(["Chat"]),
    presence: known({ name: "Offline", allowsAssignment: false, capturedOn: "2026-09-21T07:15:00Z" })
  }), // messy multi-failure agent
  healthy({
    id: "a-timnit", name: "Timnit Gebru", domainName: "timnit.gebru@contoso.com",
    channels: unknownField("This environment's per-agent channel configuration could not be confirmed from a documented Dataverse schema; verify manually in the Customer Service admin center under Users → Channels."),
    workItemUnitCost: unknownField("Could not read the routing configuration needed to determine work-item unit cost: no permission to read \"msdyn_routingconfigurationstep\" (demo)."),
    presence: unknownField("Could not read this agent's current presence (demo)."),
    routingExclusion: unknownField("Not verifiable via read-only client-side access in this environment.")
  }), // the realistic "everything else is fine, but the low-confidence fields are unknown" common case
  healthy({
    id: "a-retired", name: "Retired Queue Example", domainName: "retired.example@contoso.com",
    queueMemberships: known([membership(RETIRED_QUEUE, { queueActive: false, reachableByActiveVoiceWorkstream: false, reachingWorkstreamNames: [] })]),
    workItemUnitCost: known(null),
    queueSkillRequirements: known([requirement(RETIRED_QUEUE, null)])
  }) // queue membership only in a disabled queue
];
