import { evaluateAgents } from "../src/aggregate";
import { CHECK_ORDER } from "../src/model";
import { DEMO_AGENTS } from "../src/demoData";

describe("DEMO_AGENTS", () => {
  test("has a realistic roster size (15-25 agents)", () => {
    expect(DEMO_AGENTS.length).toBeGreaterThanOrEqual(15);
    expect(DEMO_AGENTS.length).toBeLessThanOrEqual(25);
  });

  test("every agent has a unique id", () => {
    const ids = DEMO_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("includes at least one fully Ready agent", () => {
    const results = evaluateAgents(DEMO_AGENTS);
    expect(results.some((r) => r.overallStatus === "ready")).toBe(true);
    expect(results.filter((r) => r.overallStatus === "ready").length).toBeGreaterThanOrEqual(3);
  });

  test("every overall status appears at least once (Ready / Warning / Not ready / Not verifiable)", () => {
    const statuses = new Set(evaluateAgents(DEMO_AGENTS).map((r) => r.overallStatus));
    expect(statuses).toEqual(new Set(["ready", "warning", "notReady", "notVerifiable"]));
  });

  test("every check category reaches pass at least once across the roster", () => {
    const results = evaluateAgents(DEMO_AGENTS);
    CHECK_ORDER.forEach((category) => {
      const passed = results.some((r) => r.checks.find((c) => c.category === category)?.status === "pass");
      expect(passed).toBe(true);
    });
  });

  test("every check category reaches fail at least once, except presence/unifiedRoutingState which never fail by design", () => {
    const results = evaluateAgents(DEMO_AGENTS);
    // presence and unifiedRoutingState are both live, point-in-time, self-clearing conditions
    // (informational-only) rather than structural misconfigurations, so neither ever fails.
    const categoriesThatShouldFail = CHECK_ORDER.filter((c) => c !== "presence" && c !== "unifiedRoutingState");
    categoriesThatShouldFail.forEach((category) => {
      const failed = results.some((r) => r.checks.find((c) => c.category === category)?.status === "fail");
      expect(failed).toBe(true);
    });
  });

  test("unifiedRoutingState reaches warn but never fail (informational-only, live capacity-block state)", () => {
    const results = evaluateAgents(DEMO_AGENTS);
    const statuses = new Set(results.map((r) => r.checks.find((c) => c.category === "unifiedRoutingState")?.status));
    expect(statuses.has("warn")).toBe(true);
    expect(statuses.has("fail")).toBe(false);
  });

  test("every check category reaches unknown at least once", () => {
    const results = evaluateAgents(DEMO_AGENTS);
    CHECK_ORDER.forEach((category) => {
      const unk = results.some((r) => r.checks.find((c) => c.category === category)?.status === "unknown");
      expect(unk).toBe(true);
    });
  });

  test("presence check reaches warn but never fail (informational-only, per spec)", () => {
    const results = evaluateAgents(DEMO_AGENTS);
    const presenceStatuses = new Set(results.map((r) => r.checks.find((c) => c.category === "presence")?.status));
    expect(presenceStatuses.has("warn")).toBe(true);
    expect(presenceStatuses.has("fail")).toBe(false);
  });

  describe("the seven explicitly required failure scenarios are each present", () => {
    const results = evaluateAgents(DEMO_AGENTS);
    const byId = new Map(results.map((r) => [r.agentId, r]));

    test("disabled account", () => expect(byId.get("a-katherine")?.checks.find((c) => c.category === "account")?.status).toBe("fail"));
    test("missing security role", () => expect(byId.get("a-margaret")?.checks.find((c) => c.category === "securityRoles")?.status).toBe("fail"));
    test("voice channel disabled", () => expect(byId.get("a-hedy")?.checks.find((c) => c.category === "channelEnablement")?.status).toBe("fail"));
    test("queue membership only in an unused queue", () => {
      expect(byId.get("a-radia")?.checks.find((c) => c.category === "queueMembership")?.status).toBe("fail");
      expect(byId.get("a-radia")?.checks.find((c) => c.category === "workstreamReachability")?.status).toBe("fail");
    });
    test("no capacity profile", () => expect(byId.get("a-annie")?.checks.find((c) => c.category === "capacityProfile")?.status).toBe("fail"));
    test("capacity too low for the work item", () => expect(byId.get("a-mary")?.checks.find((c) => c.category === "capacityProfile")?.status).toBe("fail"));
    test("missing required skill", () => expect(byId.get("a-dorothy")?.checks.find((c) => c.category === "skills")?.status).toBe("fail"));
  });
});
