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
    capacityProfile: known({ id: "cp1", name: "Standard", totalCapacity: 100 }),
    workItemUnitCost: known(100),
    skills: known([{ characteristicId: "c1", name: "Dutch", proficiencyLabel: "Expert", proficiencyRank: 4 }]),
    queueSkillRequirements: known([{ queueId: "q1", queueName: "Support Queue", required: [{ name: "Dutch", minProficiencyLabel: "Intermediate", minProficiencyRank: 2 }] }]),
    presence: known({ name: "Available", allowsAssignment: true }),
    routingExclusion: known(false),
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
  test("unknown: channel configuration not readable (the common real-world case)", () => {
    const result = checkChannelEnablement(baseAgent({ channels: unknownField("schema not confirmed in this environment") }));
    expect(result.status).toBe("unknown");
    expect(result.suggestedFix).toMatch(/Queue membership/);
  });
});

describe("checkQueueMembership", () => {
  test("pass: member of an active, reachable queue", () => {
    expect(checkQueueMembership(baseAgent()).status).toBe("pass");
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
  test("fail: no capacity profile assigned", () => {
    const result = checkCapacityProfile(baseAgent({ capacityProfile: known(null) }));
    expect(result.status).toBe("fail");
  });
  test("fail: capacity lower than one work item's unit cost", () => {
    const result = checkCapacityProfile(baseAgent({ capacityProfile: known({ id: "cp1", name: "Light", totalCapacity: 50 }), workItemUnitCost: known(100) }));
    expect(result.status).toBe("fail");
    expect(result.evidence).toMatch(/more than this agent's total capacity/);
  });
  test("warn: profile assigned but no reachable workstream to compare against", () => {
    const result = checkCapacityProfile(baseAgent({ workItemUnitCost: known(null) }));
    expect(result.status).toBe("warn");
  });
  test("unknown: capacity profile not readable", () => {
    expect(checkCapacityProfile(baseAgent({ capacityProfile: unknownField("table not found") })).status).toBe("unknown");
  });
  test("unknown: profile known but unit cost not readable", () => {
    expect(checkCapacityProfile(baseAgent({ workItemUnitCost: unknownField("could not parse routing config") })).status).toBe("unknown");
  });
});

describe("checkSkills", () => {
  test("pass: agent meets all determinable requirements", () => {
    expect(checkSkills(baseAgent()).status).toBe("pass");
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
    const result = checkPresence(baseAgent({ presence: known({ name: "Away", allowsAssignment: false }) }));
    expect(result.status).toBe("warn");
  });
  test("warn: no presence record found", () => {
    const result = checkPresence(baseAgent({ presence: known(null) }));
    expect(result.status).toBe("warn");
  });
  test("unknown: presence not readable", () => {
    expect(checkPresence(baseAgent({ presence: unknownField("no privilege") })).status).toBe("unknown");
  });
});

describe("checkUnifiedRoutingState", () => {
  test("unknown by design when not verifiable", () => {
    const result = checkUnifiedRoutingState(baseAgent({ routingExclusion: unknownField("Not verifiable via read-only client-side access in this environment") }));
    expect(result.status).toBe("unknown");
  });
  test("pass: confirmed not excluded", () => {
    expect(checkUnifiedRoutingState(baseAgent()).status).toBe("pass");
  });
  test("fail: confirmed excluded", () => {
    expect(checkUnifiedRoutingState(baseAgent({ routingExclusion: known(true) })).status).toBe("fail");
  });
});
