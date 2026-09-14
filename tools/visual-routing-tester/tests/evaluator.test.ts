import { simulate, validateValues } from "../src/evaluator";
import { Queue, RoutingModel, Workstream } from "../src/model";

const queue = (id: string): Queue => ({
  id,
  name: `${id} queue`,
  assignmentMethod: "Round Robin",
  preQueueOverflowRules: [],
  inQueueOverflowRules: []
});

const workstream: Workstream = {
  id: "stream",
  name: "Voice",
  active: true,
  variables: [{ id: "language", name: "Language", type: "text", origin: "ivr", usedByRuleIds: ["first", "second"] }],
  classificationRules: [],
  queueRoutingRules: [
    { id: "first", name: "First rule", order: 0, hitPolicy: "first", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "language", operator: "equals", value: "Dutch" }], targets: [{ queueId: "first-queue" }] },
    { id: "second", name: "Second rule", order: 1, hitPolicy: "first", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "language", operator: "equals", value: "English" }], targets: [{ queueId: "second-queue" }] }
  ],
  fallbackQueueId: "fallback-queue"
};

const model = (queues: Queue[] = [queue("first-queue"), queue("second-queue"), queue("fallback-queue")]): RoutingModel => ({ workstreams: [workstream], queues, warnings: [] });

describe("simulate", () => {
  test("evaluates queue-routing rules in order and selects the first match", () => {
    const result = simulate(workstream, model(), { language: "english" });
    expect(result.queue?.id).toBe("second-queue");
    expect(result.steps.map((step) => step.status)).toContain("matched");
    expect(result.steps.find((step) => step.id === "first")?.status).toBe("skipped");
  });

  test("uses the fallback queue when no queue-routing rule matches", () => {
    const result = simulate(workstream, model(), { language: "French" });
    expect(result.queue?.id).toBe("fallback-queue");
    expect(result.outcome).toBe("Agent");
  });

  test("reports a missing target queue instead of silently routing", () => {
    const result = simulate(workstream, model([queue("fallback-queue")]), { language: "Dutch" });
    expect(result.queue?.id).toBe("fallback-queue");
    expect(result.warnings.some((warning) => warning.includes("First rule"))).toBe(true);
  });

  test("assigns directly to an agent and skips queue/overflow evaluation", () => {
    const agentWorkstream: Workstream = {
      ...workstream,
      queueRoutingRules: [{ id: "direct", name: "VIP direct", order: 0, hitPolicy: "first", enabled: true, conditionLogic: "AND", conditions: [], targets: [{ agentId: "agent-1" }] }]
    };
    const result = simulate(agentWorkstream, model(), {});
    expect(result.outcome).toBe("Agent");
    expect(result.queue).toBeUndefined();
    expect(result.steps.some((step) => step.kind === "queue")).toBe(false);
  });

  test("evaluates OR condition logic", () => {
    const orWorkstream: Workstream = {
      ...workstream,
      queueRoutingRules: [{ id: "or-rule", name: "Dutch or French", order: 0, hitPolicy: "first", enabled: true, conditionLogic: "OR", conditions: [{ variableId: "language", operator: "equals", value: "Dutch" }, { variableId: "language", operator: "equals", value: "French" }], targets: [{ queueId: "first-queue" }] }]
    };
    const result = simulate(orWorkstream, model(), { language: "French" });
    expect(result.queue?.id).toBe("first-queue");
  });

  test("classification (enrichment) sets an attribute that a queue-routing rule conditions on", () => {
    const enrichWorkstream: Workstream = {
      ...workstream,
      classificationRules: [{ id: "flag-vip", name: "Flag VIP", order: 0, hitPolicy: "first", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "language", operator: "equals", value: "Dutch" }], sets: [{ attribute: "PriorityScore", value: 10 }] }],
      queueRoutingRules: [
        { id: "priority", name: "Priority callers", order: 0, hitPolicy: "first", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "PriorityScore", operator: "greaterOrEqual", value: 10 }], targets: [{ queueId: "first-queue" }] },
        { id: "second", name: "Second rule", order: 1, hitPolicy: "first", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "language", operator: "equals", value: "English" }], targets: [{ queueId: "second-queue" }] }
      ]
    };
    const result = simulate(enrichWorkstream, model(), { language: "Dutch" });
    expect(result.steps.find((step) => step.id === "flag-vip")).toMatchObject({ kind: "enrichment", status: "matched" });
    expect(result.queue?.id).toBe("first-queue");
  });

  test("hit-policy \"all\" evaluates every rule and the last match wins", () => {
    const allWorkstream: Workstream = {
      ...workstream,
      queueRoutingRules: [
        { id: "a", name: "A", order: 0, hitPolicy: "all", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "language", operator: "equals", value: "Dutch" }], targets: [{ queueId: "first-queue" }] },
        { id: "b", name: "B", order: 1, hitPolicy: "all", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "language", operator: "equals", value: "Dutch" }], targets: [{ queueId: "second-queue" }] }
      ]
    };
    const result = simulate(allWorkstream, model(), { language: "Dutch" });
    expect(result.steps.find((step) => step.id === "a")?.status).toBe("matched");
    expect(result.steps.find((step) => step.id === "b")?.status).toBe("matched");
    expect(result.queue?.id).toBe("second-queue");
  });

  test("hit-policy \"first\" stops evaluating after the first match", () => {
    const firstWorkstream: Workstream = {
      ...workstream,
      queueRoutingRules: [
        { id: "a", name: "A", order: 0, hitPolicy: "first", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "language", operator: "equals", value: "Dutch" }], targets: [{ queueId: "first-queue" }] },
        { id: "b", name: "B", order: 1, hitPolicy: "first", enabled: true, conditionLogic: "AND", conditions: [{ variableId: "language", operator: "equals", value: "Dutch" }], targets: [{ queueId: "second-queue" }] }
      ]
    };
    const result = simulate(firstWorkstream, model(), { language: "Dutch" });
    expect(result.steps.find((step) => step.id === "b")).toBeUndefined();
    expect(result.queue?.id).toBe("first-queue");
  });

  test("in-queue overflow fires when a pre-queue rule does not match", () => {
    const overflowQueue: Queue = {
      ...queue("first-queue"),
      preQueueOverflowRules: [{ id: "pre", name: "Capacity", order: 0, hitPolicy: "first", conditionLogic: "AND", trigger: "Queue size", conditions: [{ variableId: "queue_prequeue.currentqueuesize", operator: "greaterOrEqual", value: 10 }], outcome: "End Call" }],
      inQueueOverflowRules: [{ id: "in", name: "Voicemail rule", order: 0, hitPolicy: "first", conditionLogic: "AND", trigger: "Wait time", conditions: [{ variableId: "queue_inqueue.lapsedwaittime", operator: "greaterOrEqual", value: 30 }], outcome: "Voicemail" }]
    };
    const result = simulate(workstream, model([overflowQueue, queue("fallback-queue")]), { language: "Dutch", "queue_prequeue.currentqueuesize": 2, "queue_inqueue.lapsedwaittime": 45 });
    expect(result.outcome).toBe("Voicemail");
    expect(result.steps.find((step) => step.id === "pre")?.status).toBe("skipped");
    expect(result.steps.find((step) => step.id === "in")?.status).toBe("matched");
  });

  test("a not-null condition requires a real value to be present", () => {
    const overflowQueue: Queue = {
      ...queue("first-queue"),
      inQueueOverflowRules: [{ id: "in", name: "Wait time overflow", order: 0, hitPolicy: "first", conditionLogic: "AND", trigger: "Wait time", conditions: [{ variableId: "queue_inqueue.lapsedwaittime", operator: "notNull", value: "" }, { variableId: "queue_inqueue.lapsedwaittime", operator: "greaterOrEqual", value: 30 }], outcome: "Voicemail" }]
    };
    const withoutValue = simulate(workstream, model([overflowQueue, queue("fallback-queue")]), { language: "Dutch" });
    expect(withoutValue.outcome).toBe("Agent");
    const withValue = simulate(workstream, model([overflowQueue, queue("fallback-queue")]), { language: "Dutch", "queue_inqueue.lapsedwaittime": 40 });
    expect(withValue.outcome).toBe("Voicemail");
  });

  test("chains through a Queue Transfer overflow outcome to the target queue", () => {
    const firstQueue: Queue = {
      ...queue("first-queue"),
      preQueueOverflowRules: [{ id: "transfer", name: "Overflow to general", order: 0, hitPolicy: "first", conditionLogic: "AND", trigger: "Queue size", conditions: [], outcome: "Queue Transfer", targetQueueId: "fallback-queue" }]
    };
    const fallback: Queue = { ...queue("fallback-queue"), inQueueOverflowRules: [{ id: "fallback-cb", name: "Always callback", order: 0, hitPolicy: "first", conditionLogic: "AND", trigger: "Always", conditions: [], outcome: "Callback" }] };
    const result = simulate(workstream, model([firstQueue, fallback]), { language: "Dutch" });
    expect(result.outcome).toBe("Callback");
    expect(result.queue?.id).toBe("fallback-queue");
    expect(result.steps.filter((step) => step.kind === "queue")).toHaveLength(2);
  });

  test("each queue's simulated overflow values are its own, even after a Queue Transfer", () => {
    const firstQueue: Queue = {
      ...queue("first-queue"),
      preQueueOverflowRules: [{ id: "transfer", name: "Overflow to fallback", order: 0, hitPolicy: "first", conditionLogic: "AND", trigger: "Queue size", conditions: [{ variableId: "queue_prequeue.currentqueuesize", operator: "greaterOrEqual", value: 10 }], outcome: "Queue Transfer", targetQueueId: "fallback-queue" }]
    };
    const fallbackQueue: Queue = {
      ...queue("fallback-queue"),
      preQueueOverflowRules: [{ id: "fallback-overflow", name: "Fallback also overflows", order: 0, hitPolicy: "first", conditionLogic: "AND", trigger: "Queue size", conditions: [{ variableId: "queue_prequeue.currentqueuesize", operator: "greaterOrEqual", value: 10 }], outcome: "End Call" }]
    };
    const queueValues = { "first-queue": { "queue_prequeue.currentqueuesize": 20 }, "fallback-queue": { "queue_prequeue.currentqueuesize": 1 } };
    const result = simulate(workstream, model([firstQueue, fallbackQueue]), { language: "Dutch" }, queueValues);
    // first-queue's high queue size transfers to fallback-queue, whose OWN (low) queue size means
    // its overflow rule does not fire there — proving the value didn't leak across queues.
    expect(result.steps.find((step) => step.id === "transfer")?.status).toBe("matched");
    expect(result.steps.find((step) => step.id === "fallback-overflow")?.status).toBe("skipped");
    expect(result.outcome).toBe("Agent");
    expect(result.queue?.id).toBe("fallback-queue");
  });

  test("picks a weighted-distribution target using its weightPercent, and records the pick in the trace", () => {
    const weightedWorkstream: Workstream = {
      ...workstream,
      queueRoutingRules: [{
        id: "weighted", name: "Weighted", order: 0, hitPolicy: "first", enabled: true, conditionLogic: "AND", conditions: [],
        targets: [{ queueId: "first-queue", weightPercent: 80 }, { queueId: "second-queue", weightPercent: 20 }]
      }]
    };
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.9); // rolls past the first (80%) target
    const result = simulate(weightedWorkstream, model(), {});
    randomSpy.mockRestore();
    expect(result.queue?.id).toBe("second-queue");
    expect(result.steps.some((step) => step.detail.includes("Picked"))).toBe(true);
  });

  test("stops after too many queue transfers instead of looping forever", () => {
    const a: Queue = { ...queue("first-queue"), preQueueOverflowRules: [{ id: "a-transfer", name: "To B", order: 0, hitPolicy: "first", conditionLogic: "AND", trigger: "x", conditions: [], outcome: "Queue Transfer", targetQueueId: "second-queue" }] };
    const b: Queue = { ...queue("second-queue"), preQueueOverflowRules: [{ id: "b-transfer", name: "To A", order: 0, hitPolicy: "first", conditionLogic: "AND", trigger: "x", conditions: [], outcome: "Queue Transfer", targetQueueId: "first-queue" }] };
    const result = simulate(workstream, model([a, b, queue("fallback-queue")]), { language: "Dutch" });
    expect(result.outcome).toBe("Agent");
    expect(result.warnings.some((warning) => warning.includes("too many queue transfers"))).toBe(true);
  });
});

describe("validateValues", () => {
  const typedWorkstream = (variable: Workstream["variables"][number]): Workstream => ({ ...workstream, variables: [variable] });

  test("requires a value for required variables", () => {
    const errors = validateValues(typedWorkstream({ id: "language", name: "Language", type: "text", origin: "ivr", required: true, usedByRuleIds: [] }), {});
    expect(errors).toEqual(["Language is required."]);
  });

  test("allows missing optional variables", () => {
    const errors = validateValues(typedWorkstream({ id: "language", name: "Language", type: "text", origin: "ivr", usedByRuleIds: [] }), {});
    expect(errors).toEqual([]);
  });

  test("rejects a non-numeric value for a number variable", () => {
    const errors = validateValues(typedWorkstream({ id: "priority", name: "Priority", type: "number", origin: "ivr", usedByRuleIds: [] }), { priority: "high" });
    expect(errors).toEqual(["Priority must be a number."]);
  });

  test("accepts a numeric value for a number variable", () => {
    const errors = validateValues(typedWorkstream({ id: "priority", name: "Priority", type: "number", origin: "ivr", usedByRuleIds: [] }), { priority: "3.5" });
    expect(errors).toEqual([]);
  });
});
