import { Condition, ContextVariable, EnrichmentRule, Outcome, OverflowRule, Queue, QueueRoutingRule, QueueRoutingTarget, RoutingModel, SimulationResult, TraceStep, Workstream } from "./model";

const MAX_QUEUE_TRANSFERS = 5;

export function validateValues(workstream: Workstream, values: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const isEmpty = (raw: unknown) => raw === undefined || raw === null || raw === "";
  for (const variable of workstream.variables) {
    const raw = values[variable.id];
    if (isEmpty(raw)) {
      if (variable.required) errors.push(`${variable.name} is required.`);
      continue;
    }
    errors.push(...validateType(variable, raw));
  }
  return errors;
}

function validateType(variable: ContextVariable, raw: unknown): string[] {
  if (variable.type === "number" && Number.isNaN(Number(raw))) return [`${variable.name} must be a number.`];
  return [];
}

export function conditionSummary(condition: Condition, variableNames: Record<string, string>): string {
  const name = variableNames[condition.variableId] ?? condition.variableId;
  const operators: Record<Condition["operator"], string> = {
    equals: "equals",
    notEquals: "does not equal",
    contains: "contains",
    greaterThan: ">",
    lessThan: "<",
    greaterOrEqual: ">=",
    lessOrEqual: "<=",
    notNull: "is provided"
  };
  if (condition.operator === "notNull") return `${name} ${operators.notNull}`;
  return `${name} ${operators[condition.operator]} ${JSON.stringify(condition.value)}`;
}

export function ruleSummary(conditions: Condition[], variableNames: Record<string, string>, logic: "AND" | "OR" = "AND"): string {
  return conditions.length ? conditions.map((condition) => conditionSummary(condition, variableNames)).join(` ${logic} `) : "Always";
}

function matches(condition: Condition, values: Record<string, unknown>): boolean {
  const actual = values[condition.variableId];
  const expected = condition.value;
  switch (condition.operator) {
    case "equals": return actual === expected || String(actual).toLowerCase() === String(expected).toLowerCase();
    case "notEquals": return actual !== expected;
    case "contains": return String(actual ?? "").toLowerCase().includes(String(expected).toLowerCase());
    case "greaterThan": return Number(actual) > Number(expected);
    case "lessThan": return Number(actual) < Number(expected);
    case "greaterOrEqual": return Number(actual) >= Number(expected);
    case "lessOrEqual": return Number(actual) <= Number(expected);
    case "notNull": return actual !== undefined && actual !== null && actual !== "";
  }
}

function evaluateConditions(conditions: Condition[], logic: "AND" | "OR", values: Record<string, unknown>): boolean {
  if (!conditions.length) return true;
  return logic === "OR" ? conditions.some((condition) => matches(condition, values)) : conditions.every((condition) => matches(condition, values));
}

function push(steps: TraceStep[], step: TraceStep): void { steps.push(step); }

// Real classification/overflow/queue-routing rulesets carry their own hit-policy ("first" stops at
// the first match; "all" evaluates every rule, with a later match overriding an earlier one for
// picking a single winner) — confirmed to genuinely differ per ruleset against real data, so this
// must be read from the rule, not assumed.
function evaluateEnrichment(rules: EnrichmentRule[], values: Record<string, unknown>, variableNames: Record<string, string>, steps: TraceStep[]): Record<string, unknown> {
  const enriched = { ...values };
  for (const rule of [...rules].sort((a, b) => a.order - b.order)) {
    const matched = rule.enabled && evaluateConditions(rule.conditions, rule.conditionLogic, enriched);
    const setsSummary = rule.sets.length ? rule.sets.map((s) => `${variableNames[s.attribute] ?? s.attribute} = ${JSON.stringify(s.value)}`).join(", ") : "no attributes";
    push(steps, { id: rule.id, kind: "enrichment", label: rule.name, detail: `${ruleSummary(rule.conditions, variableNames, rule.conditionLogic)}${matched ? ` — matched, sets ${setsSummary}` : " — not matched"}`, status: matched ? "matched" : "skipped" });
    if (matched) {
      rule.sets.forEach((set) => { enriched[set.attribute] = set.value; });
      if (rule.hitPolicy === "first") break;
    }
  }
  return enriched;
}

function evaluateQueueRouting(rules: QueueRoutingRule[], values: Record<string, unknown>, variableNames: Record<string, string>, steps: TraceStep[]): QueueRoutingRule | undefined {
  let lastMatch: QueueRoutingRule | undefined;
  for (const rule of [...rules].sort((a, b) => a.order - b.order)) {
    const matched = rule.enabled && evaluateConditions(rule.conditions, rule.conditionLogic, values);
    push(steps, { id: rule.id, kind: "queueRouting", label: rule.name, detail: `${ruleSummary(rule.conditions, variableNames, rule.conditionLogic)}${matched ? " — matched" : " — not matched"}`, status: matched ? "matched" : "skipped" });
    if (matched) {
      lastMatch = rule;
      if (rule.hitPolicy === "first") break;
    }
  }
  return lastMatch;
}

// A matched queue-routing rule may have several targets (a percentage-based weighted distribution
// across queues, confirmed against real data) — pick one at random, weighted by weightPercent.
function pickTarget(targets: QueueRoutingTarget[], steps: TraceStep[], ruleName: string, ruleId: string): QueueRoutingTarget | undefined {
  if (targets.length <= 1) return targets[0];
  const totalWeight = targets.reduce((sum, t) => sum + (t.weightPercent ?? 0), 0) || targets.length;
  let roll = Math.random() * totalWeight;
  const chosen = targets.find((t) => (roll -= t.weightPercent ?? (totalWeight / targets.length)) < 0) ?? targets[targets.length - 1];
  const summary = targets.map((t) => `${t.queueId ?? t.agentId} (${t.weightPercent ?? "?"}%)`).join(", ");
  push(steps, { id: `${ruleId}-distribution`, kind: "queueRouting", label: `${ruleName} — weighted distribution`, detail: `Picked ${chosen.queueId ?? chosen.agentId} at random from [${summary}].`, status: "matched" });
  return chosen;
}

function evaluateOverflowStage(rules: OverflowRule[], stageLabel: string, values: Record<string, unknown>, variableNames: Record<string, string>, steps: TraceStep[]): OverflowRule | undefined {
  let lastMatch: OverflowRule | undefined;
  for (const rule of [...rules].sort((a, b) => a.order - b.order)) {
    const matched = evaluateConditions(rule.conditions, rule.conditionLogic, values);
    push(steps, {
      id: rule.id,
      kind: "overflow",
      label: rule.name,
      detail: `${stageLabel} · ${rule.trigger}: ${ruleSummary(rule.conditions, variableNames, rule.conditionLogic)}${matched ? " — fired" : " — not fired"}`,
      status: matched ? "matched" : "skipped"
    });
    if (matched) {
      lastMatch = rule;
      if (rule.hitPolicy === "first") break;
    }
  }
  return lastMatch;
}

export function simulate(workstream: Workstream, model: RoutingModel, values: Record<string, unknown>, queueValues: Record<string, Record<string, unknown>> = {}): SimulationResult {
  const steps: TraceStep[] = [{ id: workstream.id, kind: "workstream", label: workstream.name, detail: "Inbound voice workstream", status: "evaluated" }];
  const warnings = [...model.warnings];
  const variableNames = Object.fromEntries(workstream.variables.map((variable) => [variable.id, variable.name]));

  // Stage 1: Work classification (enrichment) — sets attributes that queue-routing rules below may condition on.
  const enriched = evaluateEnrichment(workstream.classificationRules, values, variableNames, steps);

  // Stage 2: Route to Queue.
  let queue: Queue | undefined;
  const routingMatch = evaluateQueueRouting(workstream.queueRoutingRules, enriched, variableNames, steps);
  if (routingMatch) {
    const target = pickTarget(routingMatch.targets, steps, routingMatch.name, routingMatch.id);
    if (!target) {
      warnings.push(`Queue-routing rule “${routingMatch.name}” matched but has no valid target.`);
    } else if (target.agentId) {
      push(steps, { id: `${routingMatch.id}-outcome`, kind: "outcome", label: "Agent", detail: `Assigned directly to an agent by “${routingMatch.name}”, bypassing queue routing.`, status: "matched" });
      return { steps, outcome: "Agent", warnings };
    } else {
      queue = model.queues.find((candidate) => candidate.id === target.queueId);
      if (!queue) warnings.push(`Queue-routing rule “${routingMatch.name}” points to a queue that was not found.`);
    }
  }
  if (!queue && workstream.fallbackQueueId) queue = model.queues.find((candidate) => candidate.id === workstream.fallbackQueueId);
  if (!queue) {
    warnings.push("No queue-routing rule matched and no fallback queue is configured.");
    push(steps, { id: `${workstream.id}-warning`, kind: "warning", label: "No route", detail: "The call has no matching queue or fallback.", status: "warning" });
    return { steps, warnings };
  }

  push(steps, { id: queue.id, kind: "queue", label: queue.name, detail: `Assignment: ${queue.assignmentMethod}`, status: "matched" });

  // Stage 3: queue overflow (pre-queue, then in-queue), chaining through Queue Transfer outcomes.
  let currentQueue: Queue = queue;
  let outcome: Outcome | undefined;
  let transfers = 0;
  while (!outcome) {
    // Each queue's simulated wait-time/queue-size/operating-hours values are its own — a call that
    // overflows from one queue into another must not inherit the previous queue's simulated state.
    const overflowValues = { ...enriched, ...(queueValues[currentQueue.id] ?? {}) };
    const fired = evaluateOverflowStage(currentQueue.preQueueOverflowRules, "Pre-queue overflow", overflowValues, variableNames, steps)
      ?? evaluateOverflowStage(currentQueue.inQueueOverflowRules, "In-queue overflow", overflowValues, variableNames, steps);

    if (!fired) { outcome = "Agent"; break; }

    if (fired.outcome === "Queue Transfer") {
      const next = fired.targetQueueId ? model.queues.find((candidate) => candidate.id === fired.targetQueueId) : undefined;
      if (!next) { warnings.push(`Overflow rule “${fired.name}” transfers to a queue that was not found.`); outcome = "Queue Transfer"; break; }
      transfers += 1;
      if (transfers > MAX_QUEUE_TRANSFERS) { warnings.push("Overflow evaluation stopped after too many queue transfers."); outcome = "Agent"; break; }
      push(steps, { id: `${next.id}-transfer-${transfers}`, kind: "queue", label: next.name, detail: `Transferred from ${currentQueue.name} by “${fired.name}”. Assignment: ${next.assignmentMethod}`, status: "matched" });
      currentQueue = next;
      continue;
    }

    outcome = fired.outcome ?? "Agent";
  }

  push(steps, { id: `${currentQueue.id}-outcome`, kind: "outcome", label: outcome, detail: outcome === "Agent" ? `${currentQueue.assignmentMethod} assignment from ${currentQueue.name}` : `Terminal outcome from ${currentQueue.name}`, status: "matched" });
  return { steps, outcome, queue: currentQueue, warnings };
}
