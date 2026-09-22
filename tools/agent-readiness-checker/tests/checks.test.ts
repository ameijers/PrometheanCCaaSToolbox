import { checkAccount, checkCapacityProfile, checkChannelEnablement, checkPresence, checkQueueMembership, checkSecurityRoles, checkSkills, checkUnifiedRoutingState, checkWorkstreamReachability } from "../src/checks";
import { AgentRecord, known, unknownField } from "../src/model";

// A fully healthy baseline agent — each test overrides only the field(s) relevant to what it's
// checking, so every test's intent (and exactly what varies) stays obvious at a glance.
function baseAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    name: "Ada Lovelace",
    domainName: "ada@contoso.com",
    disabled: known(false),
    accessMode: known("readWrite"),
    securityRoles: known(["Customer Service Agent"]),
    channels: known(["Voice", "Chat"]),
    queueMemberships: known([{ queueId: "q1", queueName: "Support Queue", queueActive: true, reachableByActiveVoiceWorkstream: true, reachingWorkstreamNames: ["Inbound Voice"] }]),
    agentCapacity: known([{ profileName: "Default voice inbound", effectiveUnits: 100 }]),
    workItemUnitCost: known(100),
    hasProfileBasedReachableWorkstream: known(false),
    skills: known([{ characteristicId: "c1", name: "Dutch", proficiencyLabel: "Expert", proficiencyRank: 4 }]),
    queueSkillRequirements: known([{ queueId: "q1", queueName: "Support Queue", required: [{ name: "Dutch", minProficiencyLabel: "Intermediate", minProficiencyRank: 2 }] }]),
    presence: known({ name: "Available", isLoggedIn: true, allowsAssignment: true }),
    capacityBlocked: known(false),
    ...overrides
  };
}

describe("checkAccount", () => {
  test("pass: enabled, read-write", () => {
    expect(checkAccount(baseAgent()).status).toBe("pass");
  });
  test("fail: disabled account", () => {
    const result = checkAccount(baseAgent({ disabled: known(true) }));
    expect(result.status).toBe("fail");
    expect(result.suggestedFix).toBeDefined();
  });
  test("fail: non-interactive access mode", () => {
    const result = checkAccount(baseAgent({ accessMode: known("nonInteractive") }));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatch(/Non-interactive/);
  });
  test("unknown: disabled flag not readable", () => {
    const result = checkAccount(baseAgent({ disabled: unknownField("no privilege") }));
    expect(result.status).toBe("unknown");
  });
  test("unknown: access mode not readable, even though enabled is known", () => {
    const result = checkAccount(baseAgent({ accessMode: unknownField("column missing") }));
    expect(result.status).toBe("unknown");
  });
});

describe("checkSecurityRoles", () => {
  test("pass: has a configured agent role", () => {
    expect(checkSecurityRoles(baseAgent()).status).toBe("pass");
  });
  test("evidenceItems lists each role individually, for list-style UI rendering", () => {
    const result = checkSecurityRoles(baseAgent({ securityRoles: known(["Customer Service Agent", "Basic User"]) }));
    expect(result.evidenceItems).toEqual(["Customer Service Agent", "Basic User"]);
  });
  test("fail: has roles but none match", () => {
    const result = checkSecurityRoles(baseAgent({ securityRoles: known(["Sales Manager"]) }));
    expect(result.status).toBe("fail");
  });
  test("fail: no roles at all", () => {
    const result = checkSecurityRoles(baseAgent({ securityRoles: known([]) }));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatch(/no security roles/i);
  });
  test("unknown: roles not readable", () => {
    expect(checkSecurityRoles(baseAgent({ securityRoles: unknownField("no privilege") })).status).toBe("unknown");
  });
});

describe("checkChannelEnablement", () => {
  test("pass: voice is among enabled channels", () => {
    expect(checkChannelEnablement(baseAgent()).status).toBe("pass");
  });
  test("fail: voice not enabled", () => {
    expect(checkChannelEnablement(baseAgent({ channels: known(["Chat"]) })).status).toBe("fail");
  });
  test("fail: no channels enabled", () => {
    expect(checkChannelEnablement(baseAgent({ channels: known([]) })).status).toBe("fail");
  });
  // Now derived from the same queue/workstream reachability data as Queue membership and
  // Workstream reachability — this is unknown only when that underlying data itself couldn't be
  // read, not routinely (see IMPLEMENTATION_STATUS.md "Round 6" for why there's no independent
  // per-agent channel setting to read in the first place).
  test("unknown: underlying queue/workstream reachability data not readable", () => {
    const result = checkChannelEnablement(baseAgent({ channels: unknownField("Could not read the routing configuration needed to determine channel access.") }));
    expect(result.status).toBe("unknown");
    expect(result.suggestedFix).toMatch(/Queue membership/);
  });
});

describe("checkQueueMembership", () => {
  test("pass: member of an active, reachable queue", () => {
    expect(checkQueueMembership(baseAgent()).status).toBe("pass");
  });
  test("evidenceItems has one readable line per queue", () => {
    const result = checkQueueMembership(baseAgent({
      queueMemberships: known([
        { queueId: "q1", queueName: "Support Queue", queueActive: true, reachableByActiveVoiceWorkstream: true, reachingWorkstreamNames: ["Inbound Voice"] },
        { queueId: "q2", queueName: "Legacy Queue", queueActive: false, reachableByActiveVoiceWorkstream: false, reachingWorkstreamNames: [] }
      ])
    }));
    expect(result.evidenceItems).toEqual(["Support Queue — active, routed to", "Legacy Queue — disabled, not routed to"]);
  });
  test("fail: no queue memberships at all", () => {
    const result = checkQueueMembership(baseAgent({ queueMemberships: known([]) }));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatch(/not a member of any queue/i);
  });
  test("fail: only unused/disabled/unreachable queues", () => {
    const result = checkQueueMembership(baseAgent({
      queueMemberships: known([
        { queueId: "q2", queueName: "Legacy Queue", queueActive: false, reachableByActiveVoiceWorkstream: false, reachingWorkstreamNames: [] },
        { queueId: "q3", queueName: "Orphan Queue", queueActive: true, reachableByActiveVoiceWorkstream: false, reachingWorkstreamNames: [] }
      ])
    }));
    expect(result.status).toBe("fail");
  });
  test("pass: at least one good queue among several bad ones", () => {
    const result = checkQueueMembership(baseAgent({
      queueMemberships: known([
        { queueId: "q2", queueName: "Legacy Queue", queueActive: false, reachableByActiveVoiceWorkstream: false, reachingWorkstreamNames: [] },
        { queueId: "q1", queueName: "Support Queue", queueActive: true, reachableByActiveVoiceWorkstream: true, reachingWorkstreamNames: ["Inbound Voice"] }
      ])
    }));
    expect(result.status).toBe("pass");
  });
  test("unknown: queue memberships not readable", () => {
    expect(checkQueueMembership(baseAgent({ queueMemberships: unknownField("no privilege") })).status).toBe("unknown");
  });
});

describe("checkWorkstreamReachability", () => {
  test("pass: a workstream reaches one of the agent's queues", () => {
    expect(checkWorkstreamReachability(baseAgent()).status).toBe("pass");
  });
  test("fail: no workstream reaches any of the agent's queues", () => {
    const result = checkWorkstreamReachability(baseAgent({
      queueMemberships: known([{ queueId: "q1", queueName: "Support Queue", queueActive: true, reachableByActiveVoiceWorkstream: false, reachingWorkstreamNames: [] }])
    }));
    expect(result.status).toBe("fail");
  });
  test("unknown: underlying data not readable", () => {
    expect(checkWorkstreamReachability(baseAgent({ queueMemberships: unknownField("no privilege") })).status).toBe("unknown");
  });
});

describe("checkCapacityProfile", () => {
  test("pass: capacity covers the smallest reachable work item", () => {
    expect(checkCapacityProfile(baseAgent()).status).toBe("pass");
  });
  test("fail: no capacity profile assigned at all", () => {
    const result = checkCapacityProfile(baseAgent({ agentCapacity: known([]) }));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatch(/no capacity profile is assigned/i);
  });
  test("fail: assigned, but no profile has a usable value (join row and profile default both unset)", () => {
    const result = checkCapacityProfile(baseAgent({ agentCapacity: known([{ profileName: "Default voice inbound", effectiveUnits: null }]) }));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatch(/none have a usable capacity value/i);
  });
  test("fail: effective capacity is exactly 0", () => {
    const result = checkCapacityProfile(baseAgent({ agentCapacity: known([{ profileName: "Default voice inbound", effectiveUnits: 0 }]) }));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatch(/effective capacity is 0/i);
  });
  test("fail: capacity lower than one work item's unit cost", () => {
    const result = checkCapacityProfile(baseAgent({ agentCapacity: known([{ profileName: "Default voice inbound", effectiveUnits: 50 }]), workItemUnitCost: known(100) }));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatch(/more than this agent's capacity/);
  });
  test("prefers the profile whose name mentions 'inbound' when the agent has multiple profiles", () => {
    const result = checkCapacityProfile(baseAgent({
      agentCapacity: known([
        { profileName: "Default voice outbound", effectiveUnits: 999 },
        { profileName: "Default voice inbound", effectiveUnits: 100 }
      ])
    }));
    expect(result.status).toBe("pass");
    expect(result.evidence).toContain("Effective capacity: 100");
  });
  test("falls back to the smallest usable value when no profile name mentions 'inbound'", () => {
    const result = checkCapacityProfile(baseAgent({
      agentCapacity: known([
        { profileName: "Escalation profile", effectiveUnits: 200 },
        { profileName: "Standard profile", effectiveUnits: 50 }
      ]),
      workItemUnitCost: known(100)
    }));
    expect(result.status).toBe("fail"); // 50 < 100
  });
  test("evidenceItems lists every profile assignment", () => {
    const result = checkCapacityProfile(baseAgent({
      agentCapacity: known([
        { profileName: "Default voice inbound", effectiveUnits: 1 },
        { profileName: "Default voice outbound", effectiveUnits: null }
      ])
    }));
    expect(result.evidenceItems).toEqual(["Default voice inbound: 1 unit", "Default voice outbound: no value set"]);
  });
  test("warn: capacity known but no reachable workstream to compare against", () => {
    const result = checkCapacityProfile(baseAgent({ workItemUnitCost: known(null) }));
    expect(result.status).toBe("warn");
  });
  // Reproduces a real false-failure found live: an agent's reachable voice workstream(s) all use
  // "Profile based" capacity, where a non-zero capacity-profile assignment is sufficient on its
  // own — no numeric comparison against msdyn_capacityrequired is meaningful under that format.
  test("pass: no unit-based workstream to compare against, but a reachable workstream uses \"Profile based\" capacity", () => {
    const result = checkCapacityProfile(baseAgent({ workItemUnitCost: known(null), hasProfileBasedReachableWorkstream: known(true) }));
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatch(/Profile based/);
  });
  test("unknown: capacity not readable", () => {
    expect(checkCapacityProfile(baseAgent({ agentCapacity: unknownField("table not found") })).status).toBe("unknown");
  });
  test("unknown: capacity known but unit cost not readable", () => {
    expect(checkCapacityProfile(baseAgent({ workItemUnitCost: unknownField("could not parse routing config") })).status).toBe("unknown");
  });
});

describe("checkSkills", () => {
  test("pass: agent meets all determinable requirements", () => {
    expect(checkSkills(baseAgent()).status).toBe("pass");
  });
  test("evidenceItems lists each of the agent's own skills with proficiency", () => {
    const result = checkSkills(baseAgent({ skills: known([{ characteristicId: "c1", name: "Dutch", proficiencyLabel: "Expert", proficiencyRank: 4 }, { characteristicId: "c2", name: "Billing" }]) }));
    expect(result.evidenceItems).toEqual(["Dutch (Expert)", "Billing"]);
  });
  test("pass: no requirements configured on any reachable queue", () => {
    const result = checkSkills(baseAgent({ queueSkillRequirements: known([{ queueId: "q1", queueName: "Support Queue", required: [] }]) }));
    expect(result.status).toBe("pass");
  });
  test("fail: missing a required skill", () => {
    const result = checkSkills(baseAgent({ skills: known([]) }));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatch(/Dutch/);
  });
  test("fail: has the skill but below required proficiency", () => {
    const result = checkSkills(baseAgent({ skills: known([{ characteristicId: "c1", name: "Dutch", proficiencyLabel: "Beginner", proficiencyRank: 1 }]) }));
    expect(result.status).toBe("fail");
  });
  test("unknown: skills not readable", () => {
    expect(checkSkills(baseAgent({ skills: unknownField("no privilege") })).status).toBe("unknown");
  });
  test("unknown: no queue's requirements could be determined", () => {
    const result = checkSkills(baseAgent({ queueSkillRequirements: known([{ queueId: "q1", queueName: "Support Queue", required: null }]) }));
    expect(result.status).toBe("unknown");
  });
  test("warn: requirements met where known, but one queue's requirements undetermined", () => {
    const result = checkSkills(baseAgent({
      queueSkillRequirements: known([
        { queueId: "q1", queueName: "Support Queue", required: [{ name: "Dutch", minProficiencyRank: 2 }] },
        { queueId: "q4", queueName: "VIP Queue", required: null }
      ])
    }));
    expect(result.status).toBe("warn");
  });
});

describe("checkPresence", () => {
  test("pass: available", () => {
    expect(checkPresence(baseAgent()).status).toBe("pass");
  });
  test("warn: presence found but does not allow assignment (never fail — informational)", () => {
    const result = checkPresence(baseAgent({ presence: known({ name: "Away", isLoggedIn: true, allowsAssignment: false }) }));
    expect(result.status).toBe("warn");
  });
  test("warn: no presence record found", () => {
    const result = checkPresence(baseAgent({ presence: known(null) }));
    expect(result.status).toBe("warn");
  });
  // Reproduces a real bug: msdyn_agentstatus.msdyn_isagentloggedin (the actual live login state)
  // is independent of the presence label itself — a stale "Available" record from a prior session
  // must not be read as "currently available" once the agent has logged out.
  test("warn: not currently logged in, even though a presence label is present", () => {
    const result = checkPresence(baseAgent({ presence: known({ name: "Available", isLoggedIn: false, allowsAssignment: true }) }));
    expect(result.status).toBe("warn");
    expect(result.evidence).toMatch(/not currently logged in/i);
  });
  test("pass: logged in and available", () => {
    const result = checkPresence(baseAgent({ presence: known({ name: "Available", isLoggedIn: true, allowsAssignment: true }) }));
    expect(result.status).toBe("pass");
    expect(result.evidence).toMatch(/Currently logged in/);
  });
  test("unknown: presence not readable", () => {
    expect(checkPresence(baseAgent({ presence: unknownField("no privilege") })).status).toBe("unknown");
  });
});

describe("checkUnifiedRoutingState", () => {
  // msdyn_agentstatus.msdyn_isblockedbysomeprofile, confirmed live — see IMPLEMENTATION_STATUS.md
  // "Round 7". Blocked-by-capacity is a transient, self-clearing state, not a structural
  // misconfiguration, so it warns rather than fails.
  test("unknown: underlying agent status not readable", () => {
    const result = checkUnifiedRoutingState(baseAgent({ capacityBlocked: unknownField("Could not read this agent's current status.") }));
    expect(result.status).toBe("unknown");
  });
  test("pass: not currently blocked", () => {
    expect(checkUnifiedRoutingState(baseAgent()).status).toBe("pass");
  });
  test("warn: currently blocked by capacity across their profile(s)", () => {
    const result = checkUnifiedRoutingState(baseAgent({ capacityBlocked: known(true) }));
    expect(result.status).toBe("warn");
    expect(result.evidence).toMatch(/at capacity/i);
  });
});
