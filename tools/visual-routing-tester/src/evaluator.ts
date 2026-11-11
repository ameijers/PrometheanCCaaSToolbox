// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

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

// Real classification/overflow/queue-routing rulesets carry their own hit-policy, which differs per
// ruleset in real data, so it's read from the rule, never assumed.
//
// Work classification (Learn, "Configure work classification rulesets"): the rulesets run in order,
// and "when one of the rule item conditions matches, the output section of the rule item is run. The
// system evaluates the rules in the next ruleset". So a "first" match ends its own ruleset only; the
// next ruleset still runs, and can use the values set before it. With "all", every matching rule
// sets its values in order.
function evaluateEnrichment(rules: EnrichmentRule[], values: Record<string, unknown>, variableNames: Record<string, string>, steps: TraceStep[]): Record<string, unknown> {
  const enriched = { ...values };
  const done = new Set<string>();
  for (const rule of [...rules].sort((a, b) => a.order - b.order)) {
    const ruleset = rule.rulesetId ?? "";
    if (done.has(ruleset)) continue;
    const matched = rule.enabled && evaluateConditions(rule.conditions, rule.conditionLogic, enriched);
    const setsSummary = rule.sets.length ? rule.sets.map((s) => `${variableNames[s.attribute] ?? s.attribute} = ${JSON.stringify(s.value)}`).join(", ") : "no attributes";
    push(steps, { id: rule.id, kind: "enrichment", label: rule.name, detail: `${ruleSummary(rule.conditions, variableNames, rule.conditionLogic)}${matched ? ` — matched, sets ${setsSummary}` : " — not matched"}`, status: matched ? "matched" : "skipped" });
    if (matched) {
      rule.sets.forEach((set) => { enriched[set.attribute] = set.value; });
      if (rule.hitPolicy === "first") done.add(ruleset);
    }
  }
  return enriched;
}

// Route to queues: every matching rule, in order. "first" (Hit-first) stops at the first match;
// "all" (Hit-all) evaluates every rule, and simulate() then takes the first match whose queue isn't
// overflowing (Learn, "Configure route-to-queue rules" and "Manage overflow").
function evaluateQueueRouting(rules: QueueRoutingRule[], values: Record<string, unknown>, variableNames: Record<string, string>, steps: TraceStep[]): QueueRoutingRule[] {
  const matches: QueueRoutingRule[] = [];
  for (const rule of [...rules].sort((a, b) => a.order - b.order)) {
    const matched = rule.enabled && evaluateConditions(rule.conditions, rule.conditionLogic, values);
    push(steps, { id: rule.id, kind: "queueRouting", label: rule.name, detail: `${ruleSummary(rule.conditions, variableNames, rule.conditionLogic)}${matched ? " — matched" : " — not matched"}`, status: matched ? "matched" : "skipped" });
    if (matched) {
      matches.push(rule);
      if (rule.hitPolicy === "first") break;
    }
  }
  return matches;
}

// Whether a queue overflows before the call enters it: one of its pre-queue overflow rules fires.
function overflowsBeforeQueueing(queue: Queue, values: Record<string, unknown>): boolean {
  return queue.preQueueOverflowRules.some((rule) => evaluateConditions(rule.conditions, rule.conditionLogic, values));
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

  // Stage 2: Route to Queue. Each matching rule, in order, gives a candidate queue (a percentage-based
  // rule picks its queue first; Learn: "the overflow conditions are evaluated after percentage-based
  // routing matches a queue").
  const valuesOf = (q: Queue) => ({ ...enriched, ...(queueValues[q.id] ?? {}) });
  const candidates: { rule: QueueRoutingRule; queue: Queue }[] = [];
  for (const rule of evaluateQueueRouting(workstream.queueRoutingRules, enriched, variableNames, steps)) {
    const target = pickTarget(rule.targets, steps, rule.name, rule.id);
    if (!target) { warnings.push(`Queue-routing rule “${rule.name}” matched but has no valid target.`); continue; }
    if (target.agentId) {
      if (candidates.length) continue;
      push(steps, { id: `${rule.id}-outcome`, kind: "outcome", label: "Agent", detail: `Assigned directly to an agent by “${rule.name}”, bypassing queue routing.`, status: "matched" });
      return { steps, outcome: "Agent", warnings };
    }
    const found = model.queues.find((candidate) => candidate.id === target.queueId);
    if (!found) { warnings.push(`Queue-routing rule “${rule.name}” points to a queue that was not found.`); continue; }
    candidates.push({ rule, queue: found });
  }

  // Learn, "Manage overflow": "If multiple queues match the route-to-queue rules, the system routes the
  // work item to the first one that's not overflowing." If all of them overflow, the first one that's
  // within its operating hours gets the call and its overflow action runs. (Simplified: when none is
  // within its hours, Learn sends the call to the one that opens earliest; here, the first match.)
  let chosen = candidates[0];
  if (candidates.length > 1) {
    const free = candidates.find((c) => !overflowsBeforeQueueing(c.queue, valuesOf(c.queue)));
    const open = candidates.find((c) => valuesOf(c.queue)["queue_prequeue.iswithinoperatinghour"] !== false);
    chosen = free ?? open ?? candidates[0];
    candidates.forEach((c) => {
      if (c === chosen) return;
      const overflowing = overflowsBeforeQueueing(c.queue, valuesOf(c.queue));
      push(steps, { id: `${c.rule.id}-passed`, kind: "queueRouting", label: `${c.rule.name} — not used`, detail: overflowing ? `${c.queue.name} is overflowing, so the call goes to ${chosen.queue.name}.` : `${chosen.queue.name}, from an earlier rule, takes the call.`, status: "skipped" });
    });
  }

  // Learn: "If a work item is routed to a fallback queue because of errors or no route-to-queue rule
  // matches the requirement, the system ignores the overflow settings for the fallback queue".
  let queue: Queue | undefined = chosen?.queue;
  const toFallback = !queue;
  if (!queue && workstream.fallbackQueueId) queue = model.queues.find((candidate) => candidate.id === workstream.fallbackQueueId);
  if (!queue) {
    warnings.push("No queue-routing rule matched and no fallback queue is configured.");
    push(steps, { id: `${workstream.id}-warning`, kind: "warning", label: "No route", detail: "The call has no matching queue or fallback.", status: "warning" });
    return { steps, warnings };
  }

  push(steps, { id: queue.id, kind: "queue", label: queue.name, detail: `${toFallback ? "Fallback queue: its overflow settings are ignored. " : ""}Assignment: ${queue.assignmentMethod}`, status: "matched" });
  if (toFallback) {
    push(steps, { id: `${queue.id}-outcome`, kind: "outcome", label: "Agent", detail: `${queue.assignmentMethod} assignment from ${queue.name}`, status: "matched" });
    return { steps, outcome: "Agent", queue, warnings };
  }

  // Stage 3: queue overflow (pre-queue, then in-queue), chaining through Queue Transfer outcomes.
  // Learn: the pre-queue check happens "once only for each work item before it enters a queue"; a call
  // an overflow action transfers to another queue gets no further pre-queue overflow checks.
  let currentQueue: Queue = queue;
  let outcome: Outcome | undefined;
  let transfers = 0;
  while (!outcome) {
    // Each queue's simulated wait-time/queue-size/operating-hours values are its own — a call that
    // overflows from one queue into another must not inherit the previous queue's simulated state.
    const overflowValues = valuesOf(currentQueue);
    const fired = (transfers === 0 ? evaluateOverflowStage(currentQueue.preQueueOverflowRules, "Pre-queue overflow", overflowValues, variableNames, steps) : undefined)
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
