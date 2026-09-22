import { evaluateAgent, evaluateAgents, overallStatus, summarize } from "../src/aggregate";
import { AgentRecord, CheckResult, known, unknownField } from "../src/model";

function baseAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    name: "Ada Lovelace",
    disabled: known(false),
    accessMode: known("readWrite"),
    securityRoles: known(["Customer Service Agent"]),
    channels: known(["Voice"]),
    queueMemberships: known([{ queueId: "q1", queueName: "Support Queue", queueActive: true, reachableByActiveVoiceWorkstream: true, reachingWorkstreamNames: ["Inbound Voice"] }]),
    agentCapacity: known([{ profileName: "Default voice inbound", effectiveUnits: 100 }]),
    workItemUnitCost: known(100),
    hasProfileBasedReachableWorkstream: known(false),
    skills: known([]),
    queueSkillRequirements: known([{ queueId: "q1", queueName: "Support Queue", required: [] }]),
    presence: known({ name: "Available", isLoggedIn: true, allowsAssignment: true }),
    capacityBlocked: known(false),
    ...overrides
  };
}

function resultsOf(statuses: CheckResult["status"][]): CheckResult[] {
  return statuses.map((status, i) => ({ id: "account", category: "account", status, title: `Check ${i}`, evidence: "", explanation: "" }));
}

describe("overallStatus", () => {
  test("any fail => notReady, regardless of other statuses", () => {
    expect(overallStatus(resultsOf(["pass", "warn", "unknown", "fail"]))).toBe("notReady");
  });
  test("any warn (no fail) => warning", () => {
    expect(overallStatus(resultsOf(["pass", "warn", "unknown"]))).toBe("warning");
  });
  test("any unknown (no fail/warn) => notVerifiable", () => {
    expect(overallStatus(resultsOf(["pass", "unknown"]))).toBe("notVerifiable");
  });
  test("all pass => ready", () => {
    expect(overallStatus(resultsOf(["pass", "pass"]))).toBe("ready");
  });
  test("empty checks => ready (vacuously, no problems found)", () => {
    expect(overallStatus([])).toBe("ready");
  });
});

describe("evaluateAgent", () => {
  test("fully healthy agent is Ready with zero failed/warn/unknown", () => {
    const result = evaluateAgent(baseAgent());
    expect(result.overallStatus).toBe("ready");
    expect(result.failedCount).toBe(0);
    expect(result.warnCount).toBe(0);
    expect(result.unknownCount).toBe(0);
    expect(result.topIssue).toBeUndefined();
  });
  test("disabled account is Not ready, with the account check as the top issue", () => {
    const result = evaluateAgent(baseAgent({ disabled: known(true) }));
    expect(result.overallStatus).toBe("notReady");
    expect(result.failedCount).toBeGreaterThanOrEqual(1);
    expect(result.topIssue).toMatch(/Account/i);
  });
  test("only unreadable fields yields Not verifiable, not Not ready", () => {
    const result = evaluateAgent(baseAgent({
      disabled: unknownField("no privilege"), accessMode: unknownField("no privilege"), channels: unknownField("unconfirmed schema"), capacityBlocked: unknownField("not verifiable")
    }));
    expect(result.overallStatus).toBe("notVerifiable");
  });
  test("failedCount/warnCount/unknownCount match the underlying checks", () => {
    const result = evaluateAgent(baseAgent({ presence: known({ name: "Away", isLoggedIn: true, allowsAssignment: false }), capacityBlocked: unknownField("not verifiable") }));
    expect(result.warnCount).toBe(result.checks.filter((c) => c.status === "warn").length);
    expect(result.unknownCount).toBe(result.checks.filter((c) => c.status === "unknown").length);
  });
});

describe("evaluateAgents / summarize", () => {
  test("counts agents into the right overall-status buckets", () => {
    const healthy = baseAgent({ id: "a1", name: "Healthy" });
    const notReady = baseAgent({ id: "a2", name: "Broken", disabled: known(true) });
    const warning = baseAgent({ id: "a3", name: "Warned", presence: known({ name: "Away", isLoggedIn: true, allowsAssignment: false }) });
    const notVerifiable = baseAgent({ id: "a4", name: "Unverified", capacityBlocked: unknownField("not verifiable"), presence: unknownField("not verifiable") });

    const results = evaluateAgents([healthy, notReady, warning, notVerifiable]);
    const summary = summarize(results);
    expect(summary.total).toBe(4);
    expect(summary.ready).toBe(1);
    expect(summary.notReady).toBe(1);
    expect(summary.warning).toBe(1);
    expect(summary.notVerifiable).toBe(1);
  });

  test("mostCommonFailingCheck reflects the most frequent fail category", () => {
    const a = baseAgent({ id: "a1", disabled: known(true) });
    const b = baseAgent({ id: "a2", disabled: known(true) });
    const c = baseAgent({ id: "a3", securityRoles: known(["Sales Manager"]) });
    const summary = summarize(evaluateAgents([a, b, c]));
    expect(summary.mostCommonFailingCheck?.category).toBe("account");
    expect(summary.mostCommonFailingCheck?.count).toBe(2);
  });

  test("mostCommonFailingCheck is undefined when nothing fails", () => {
    const summary = summarize(evaluateAgents([baseAgent()]));
    expect(summary.mostCommonFailingCheck).toBeUndefined();
  });
});
