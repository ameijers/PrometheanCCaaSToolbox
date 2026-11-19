// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ExistingMethod, MatchOptions, Method, MethodStep, QueueCopy, QueueRow, RuleChanges, Ruleset, RulesetUpdate, StepCopy } from "./model";
import { CONTRACT_SET, CUSTOM_STRATEGY, DECLARATIVE_RULESET, QUEUE_SET, QUEUE_TYPE_LABELS, STEP_TYPE_LABELS } from "./schema";

// Works out, for every selected queue, exactly what a copy of the source method would write. Pure: it
// reads nothing and writes nothing.
//
// With matching on, a method already on the target queue can count as "the same method": one with the
// same name, or one with the same rules. That method is then brought in line with the source instead
// of a second copy being added: each of its rulesets is rewritten to the source's rules, rulesets it
// lacks are added, and nothing is removed from it except rules the source doesn't have.

export interface CopySource {
  queue: QueueRow;
  method: Method;
}

export interface CopyOptions {
  // Make the copy the queue's assignment method. Off: the copy is added to the queue but not used.
  activate: boolean;
  // Recognise a method already on the queue. Off (the default): every queue gets a new copy.
  match?: MatchOptions;
  // Remove all assignment rules on the queue first: every ruleset of every custom method on it is
  // emptied (the records stay). The rulesets a matched method has in common with the source are
  // rewritten to the source's rules anyway, so they keep their rule ids.
  clearFirst?: boolean;
}

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const RULE_TAG = /<rule\s+id="([^"]+)"(?:\s+name="([^"]*)")?/g;
const RULE_ELEMENT = /<rule\b([^>]*?)(?:\/>|>([\s\S]*?)<\/rule>)/g;

function unescapeXml(value: string): string {
  return value.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Whitespace between tags doesn't change a definition.
const tidy = (xml: string) => xml.replace(/>\s+</g, "><").trim();

// The rules of a ruleset definition, in order.
export function rulesOf(definition: string): { id: string; name: string }[] {
  return [...definition.matchAll(RULE_TAG)].map((m) => ({ id: m[1], name: unescapeXml(m[2] ?? "") }));
}

interface ParsedRule { id: string; name: string; content: string; }

function attribute(attributes: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes)?.[1];
}

// Each rule with what it does: its conditions and actions, and any attribute other than its id and name.
function parseRules(definition: string): ParsedRule[] {
  return [...definition.matchAll(RULE_ELEMENT)].map((m) => {
    const others = m[1].replace(/(?:^|\s)(?:id|name)="[^"]*"/g, "").trim();
    return { id: attribute(m[1], "id") ?? "", name: unescapeXml(attribute(m[1], "name") ?? ""), content: `${others}|${tidy(m[2] ?? "")}` };
  });
}

// A context variable is referred to as liveworkitemcontext.<workstream id>.<name>, so a rule using
// one only ever matches work that came in through that workstream.
export function usesContextVariables(definition: string): boolean {
  return /liveworkitemcontext\.[0-9a-f]{8}-[0-9a-f-]{27}\./i.test(definition);
}

// Replaces each rule's id, as given by `idFor`.
function withRuleIds(definition: string, idFor: (id: string) => string): { definition: string; ruleIds: Record<string, string> } {
  const ruleIds: Record<string, string> = {};
  const copied = definition.replace(/(<rule\b[^>]*?\sid=")([^"]+)(")/g, (_all, open: string, id: string, close: string) => {
    ruleIds[id] = idFor(id);
    return `${open}${ruleIds[id]}${close}`;
  });
  return { definition: copied, ruleIds };
}

function replaceIds(text: string, ids: Record<string, string>): string {
  return Object.keys(ids).reduce((result, id) => result.split(id).join(ids[id]), text);
}

// Why this method can't be copied to any queue. Empty when it can.
export function sourceProblems(source: CopySource): string[] {
  const problems: string[] = [];
  const { queue, method } = source;
  if (!queue.inputContractId) problems.push(`"${queue.name}" has no assignment contract, so its rules can't be read reliably.`);
  if (!method.steps.length) problems.push(`"${method.name}" has no rulesets yet. Add its rules in the admin center first.`);
  method.steps.forEach((step) => {
    const ruleset = step.ruleset;
    if (!ruleset) { problems.push(`The ruleset "${step.name}" couldn't be read.`); return; }
    if (ruleset.rulesetType !== DECLARATIVE_RULESET) problems.push(`The ruleset "${ruleset.name}" isn't rule-based (it uses a model or a component), which this tool doesn't copy.`);
    if (!same(ruleset.inputContractId, queue.inputContractId)) problems.push(`The ruleset "${ruleset.name}" doesn't use its queue's own assignment contract, which this tool doesn't expect.`);
    const definition = ruleset.definition.toLowerCase();
    if (definition.includes(queue.id.toLowerCase()) || (queue.inputContractId && definition.includes(queue.inputContractId.toLowerCase()))) {
      problems.push(`The ruleset "${ruleset.name}" refers to the queue "${queue.name}" itself, so it can't be used on another queue as it is.`);
    }
  });
  return problems;
}

function freeName(wanted: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(wanted.trim().toLowerCase())) return wanted;
  let n = 2;
  while (used.has(`${wanted} (${n})`.toLowerCase())) n++;
  return `${wanted} (${n})`;
}

function contractBind(id: string): string {
  return `/${CONTRACT_SET}(${id})`;
}

const stepLabel = (type: number) => STEP_TYPE_LABELS[type] ?? "Ruleset";

// The contract a ruleset's output should point at on the target queue: a prioritization ruleset's
// output is its queue's own contract; an assignment ruleset's is the platform's shared one.
function outputContract(ruleset: Ruleset, from: QueueRow, queue: QueueRow): string | undefined {
  if (!ruleset.outputContractId) return undefined;
  return same(ruleset.outputContractId, from.inputContractId) ? queue.inputContractId : ruleset.outputContractId;
}

// A new ruleset and its step for the target queue: every rule gets a new id.
function stepCopy(step: MethodStep, from: QueueRow, queue: QueueRow, newId: () => string): StepCopy {
  const ruleset = step.ruleset!;
  const copied = withRuleIds(ruleset.definition, () => newId());
  const payload: Record<string, unknown> = {
    msdyn_name: ruleset.name,
    msdyn_rulesetdefinition: copied.definition,
    msdyn_rulesettype: ruleset.rulesetType,
    msdyn_isinputcollection: ruleset.isInputCollection,
    msdyn_persistoutputdata: ruleset.persistOutputData,
    msdyn_refreshinputdata: ruleset.refreshInputData,
    "msdyn_inputcontractid@odata.bind": contractBind(queue.inputContractId!)
  };
  if (ruleset.description) payload.msdyn_description = ruleset.description;
  if (ruleset.authoringMode !== undefined) payload.msdyn_authoringmode = ruleset.authoringMode;
  if (ruleset.disabledRules) payload.msdyn_disabledrules = replaceIds(ruleset.disabledRules, copied.ruleIds);
  const output = outputContract(ruleset, from, queue);
  if (output) payload["msdyn_outputcontractid@odata.bind"] = contractBind(output);
  return {
    ruleset: payload,
    step: { msdyn_name: step.name, msdyn_type: step.type, msdyn_steporder: step.order, msdyn_isdefaultruleset: step.isDefault },
    sourceDefinition: ruleset.definition,
    ruleIds: copied.ruleIds
  };
}

// msdyn_uniquename is required on rulesets and steps, and nothing fills it in; this is the shape the
// admin center gives it.
function withUniqueNames(copies: StepCopy[], newId: () => string): StepCopy[] {
  const uniqueName = () => `msdyn_${newId().replace(/-/g, "")}`;
  copies.forEach((copy) => { copy.ruleset.msdyn_uniquename = uniqueName(); copy.step.msdyn_uniquename = uniqueName(); });
  return copies;
}

// The source's rules, with the ids of the target's matching rules: a rule that does the same keeps its
// id, then a rule with the same name; any other rule is new. Keeping ids keeps what the platform has
// linked to a rule (its dependency mappings).
export function syncRules(source: Ruleset, target: Ruleset, newId: () => string): { definition: string; disabledRules: string | null; changes: RuleChanges; unchanged: boolean } {
  const wanted = parseRules(source.definition);
  const free = parseRules(target.definition);
  const matched = new Map<ParsedRule, { rule: ParsedRule; changed: boolean }>();
  const passes: [(a: ParsedRule, b: ParsedRule) => boolean, boolean][] = [
    [(a, b) => a.content === b.content && sameName(a.name, b.name), false],
    [(a, b) => a.content === b.content, true],
    [(a, b) => !!a.name.trim() && sameName(a.name, b.name), true]
  ];
  for (const [fits, changed] of passes) {
    for (const rule of wanted) {
      if (matched.has(rule)) continue;
      const i = free.findIndex((candidate) => fits(rule, candidate));
      if (i >= 0) matched.set(rule, { rule: free.splice(i, 1)[0], changed });
    }
  }
  const byId = new Map(wanted.map((r) => [r.id, r]));
  const synced = withRuleIds(source.definition, (id) => {
    const match = byId.get(id) && matched.get(byId.get(id)!);
    return match ? match.rule.id : newId();
  });
  const name = (r: ParsedRule) => r.name || "(unnamed rule)";
  const changes: RuleChanges = {
    added: wanted.filter((r) => !matched.has(r)).map(name),
    changed: wanted.filter((r) => matched.get(r)?.changed).map(name),
    removed: free.map(name)
  };
  const disabledRules = source.disabledRules ? replaceIds(source.disabledRules, synced.ruleIds) : null;
  const unchanged = tidy(synced.definition) === tidy(target.definition) && (disabledRules ?? "") === (target.disabledRules ?? "");
  return { definition: synced.definition, disabledRules, changes, unchanged };
}

// Step types the method has more than one ruleset of; this tool can't tell those apart.
function repeatedTypes(steps: MethodStep[]): number[] {
  const types = steps.map((s) => s.type);
  return [...new Set(types.filter((t, i) => types.indexOf(t) !== i))];
}

// The same rules as the source: the same kinds of ruleset, each with rules that do the same, in order.
function sameRules(source: Method, candidate: Method): boolean {
  if (candidate.steps.length !== source.steps.length || candidate.steps.some((s) => !s.ruleset)) return false;
  return source.steps.every((step) => {
    const other = candidate.steps.find((s) => s.type === step.type);
    if (!other?.ruleset || !step.ruleset) return false;
    const a = parseRules(step.ruleset.definition).map((r) => r.content);
    const b = parseRules(other.ruleset.definition).map((r) => r.content);
    return a.length === b.length && a.every((c, i) => c === b[i]);
  });
}

// The method already on the queue that counts as the source method, if any. A method with the same
// rules wins over one with the same name: it's the one that is already there.
function findExisting(source: Method, queue: QueueRow, match: MatchOptions, methods: Record<string, Method>): { method?: Method; matchedBy?: "name" | "rules"; reason?: string } {
  const onQueue = queue.methods.map((m) => methods[m.id]);
  const unread = queue.methods.filter((m) => !methods[m.id]);
  if (unread.length) return { reason: `Its method "${unread[0].name}" couldn't be read, so it can't be checked whether the method is already there.` };
  if (match.byRules) {
    const found = onQueue.find((m) => sameRules(source, m));
    if (found) return { method: found, matchedBy: "rules" };
  }
  if (match.byName) {
    const named = onQueue.filter((m) => sameName(m.name, source.name));
    if (named.length > 1) return { reason: `It has ${named.length} methods named "${source.name}", so it isn't clear which one to update. Rename or remove one in the admin center.` };
    if (named.length === 1) return { method: named[0], matchedBy: "name" };
  }
  return {};
}

// What it takes to bring an existing method in line with the source, or why it can't be.
function planUpdate(source: CopySource, queue: QueueRow, target: Method, matchedBy: "name" | "rules", newId: () => string): { existing: ExistingMethod; steps: StepCopy[]; reasons: string[] } {
  const reasons: string[] = [];
  const existing: ExistingMethod = { id: target.id, name: target.name, matchedBy, updates: [], unchanged: [], extra: [] };
  const steps: StepCopy[] = [];
  const repeated = repeatedTypes(target.steps);
  if (repeated.length) reasons.push(`Its method "${target.name}" has more than one ${repeated.map(stepLabel).join(" and ")} ruleset, so it isn't clear which one to update. Update it in the admin center.`);

  for (const step of source.method.steps) {
    const ruleset = step.ruleset!;
    const other = target.steps.find((s) => s.type === step.type);
    if (!other) { steps.push(stepCopy(step, source.queue, queue, newId)); continue; }
    const current = other.ruleset;
    if (!current) { reasons.push(`The ruleset "${other.name}" of its method couldn't be read.`); continue; }
    if (current.rulesetType !== DECLARATIVE_RULESET) { reasons.push(`The ruleset "${current.name}" of its method isn't rule-based, which this tool doesn't update.`); continue; }
    if (!same(current.inputContractId, queue.inputContractId)) { reasons.push(`The ruleset "${current.name}" of its method doesn't use this queue's assignment contract, which this tool doesn't expect.`); continue; }
    const output = outputContract(ruleset, source.queue, queue);
    if (output && !same(current.outputContractId, output)) { reasons.push(`The ruleset "${current.name}" of its method has a different output than the source's, which this tool doesn't change.`); continue; }
    const synced = syncRules(ruleset, current, newId);
    if (synced.unchanged) { existing.unchanged.push(current.name); continue; }
    existing.updates.push({
      rulesetId: current.id, name: current.name, stepType: step.type,
      columns: { msdyn_rulesetdefinition: synced.definition, msdyn_disabledrules: synced.disabledRules },
      before: { msdyn_rulesetdefinition: current.definition, msdyn_disabledrules: current.disabledRules ?? null },
      changes: synced.changes
    });
  }
  existing.extra = target.steps.filter((s) => !source.method.steps.some((t) => t.type === s.type)).map((s) => s.ruleset?.name ?? s.name);
  return { existing, steps: withUniqueNames(steps, newId), reasons };
}

// Every ruleset on the queue's methods that still has rules, except those `keep` names (rewritten
// anyway), emptied: its rule elements removed, nothing else changed.
function planClearing(queue: QueueRow, methods: Record<string, Method>, keep: Set<string>): { cleared: RulesetUpdate[]; reasons: string[] } {
  const cleared: RulesetUpdate[] = [];
  const reasons: string[] = [];
  for (const summary of queue.methods) {
    const method = methods[summary.id];
    if (!method) { reasons.push(`Its method "${summary.name}" couldn't be read, so its rules can't be removed.`); continue; }
    for (const step of method.steps) {
      const ruleset = step.ruleset;
      if (!ruleset) { reasons.push(`The ruleset "${step.name}" of its method "${method.name}" couldn't be read, so its rules can't be removed.`); continue; }
      if (keep.has(ruleset.id)) continue;
      const rules = parseRules(ruleset.definition);
      if (!rules.length && !ruleset.disabledRules) continue;
      if (ruleset.rulesetType !== DECLARATIVE_RULESET) { reasons.push(`The ruleset "${ruleset.name}" of its method "${method.name}" isn't rule-based, so its rules can't be removed.`); continue; }
      cleared.push({
        rulesetId: ruleset.id, name: ruleset.name, stepType: step.type, methodId: method.id, methodName: method.name,
        columns: { msdyn_rulesetdefinition: ruleset.definition.replace(RULE_ELEMENT, ""), msdyn_disabledrules: null },
        before: { msdyn_rulesetdefinition: ruleset.definition, msdyn_disabledrules: ruleset.disabledRules ?? null },
        changes: { added: [], changed: [], removed: rules.map((r) => r.name || "(unnamed rule)") }
      });
    }
  }
  return { cleared, reasons };
}

// A short description of what emptying rulesets removes.
export function describeClearing(cleared: RulesetUpdate[]): string[] {
  return cleared.map((c) => `Empties ${stepLabel(c.stepType).toLowerCase()} ruleset "${c.name}" of "${c.methodName}" (${c.changes.removed.length} rule${c.changes.removed.length === 1 ? "" : "s"}).`);
}

// A short description of what an update changes, for the preview and the log.
export function describeUpdate(existing: ExistingMethod, newRulesets: StepCopy[]): string[] {
  const parts: string[] = [];
  existing.updates.forEach((u) => {
    const c = u.changes;
    const said = [
      c.added.length ? `adds ${c.added.map((n) => `"${n}"`).join(", ")}` : "",
      c.changed.length ? `changes ${c.changed.map((n) => `"${n}"`).join(", ")}` : "",
      c.removed.length ? `removes ${c.removed.map((n) => `"${n}"`).join(", ")}` : ""
    ].filter(Boolean);
    parts.push(`${stepLabel(u.stepType)} ruleset "${u.name}": ${said.length ? said.join("; ") : "rule order or settings"}.`);
  });
  newRulesets.forEach((s) => parts.push(`Adds the ${stepLabel(Number(s.step.msdyn_type)).toLowerCase()} ruleset "${String(s.ruleset.msdyn_name)}".`));
  return parts;
}

export function planCopies(source: CopySource, targets: QueueRow[], options: CopyOptions, newId: () => string, methods: Record<string, Method> = {}): QueueCopy[] {
  const blockers = sourceProblems(source);
  const { queue: from, method } = source;
  const steps = [...method.steps].sort((a, b) => a.order - b.order);
  const sorted: CopySource = { queue: from, method: { ...method, steps } };
  const matching = !!options.match && (options.match.byName || options.match.byRules);

  return targets.map((queue) => {
    const reasons = [...blockers];
    const notes: string[] = [];
    if (same(queue.id, from.id)) reasons.push("This is the queue the method is copied from.");
    if (queue.type !== from.type) reasons.push(`This is a ${QUEUE_TYPE_LABELS[queue.type] ?? "different type of"} queue; the method belongs to a ${QUEUE_TYPE_LABELS[from.type] ?? "different type of"} queue.`);
    if (!queue.inputContractId) reasons.push("This queue has no assignment contract. Open and save it in the admin center, then reload.");
    const activeNow = queue.methods.filter((m) => m.active);
    const before = { strategy: queue.strategy, activeMethodIds: activeNow.map((m) => m.id) };

    // A method already on the queue that counts as this one.
    const found = matching && !reasons.length ? findExisting(method, queue, options.match!, methods) : {};
    if (found.reason) reasons.push(found.reason);
    const update = found.method && !reasons.length ? planUpdate(sorted, queue, found.method, found.matchedBy!, newId) : undefined;
    if (update) reasons.push(...update.reasons);

    // Remove all assignment rules on the queue first. The matched method's rulesets that get the
    // source's rules are left to that rewrite.
    const rewritten = new Set(found.method && update ? found.method.steps.filter((s) => steps.some((t) => t.type === s.type)).map((s) => s.ruleset?.id ?? "") : []);
    const clearing = options.clearFirst && !reasons.length ? planClearing(queue, methods, rewritten) : { cleared: [], reasons: [] };
    reasons.push(...clearing.reasons);
    const cleared = reasons.length ? [] : clearing.cleared;
    // A method in use that is emptied and not replaced: the queue would assign work without rules.
    const emptiedInUse = (switching: boolean, switchTo?: string) => {
      if (switching || queue.strategy !== CUSTOM_STRATEGY) return;
      const left = activeNow.filter((m) => m.id !== switchTo && cleared.some((c) => c.methodId === m.id));
      if (left.length) notes.push(`Warning: "${left.map((m) => m.name).join("\", \"")}" is in use on this queue and its rules are removed, so the queue assigns work without those rules until you switch it to another method.`);
    };

    if (found.method && update) {
      const inUse = queue.strategy === CUSTOM_STRATEGY && activeNow.length === 1 && activeNow[0].id === found.method.id;
      const activate = options.activate && !inUse;
      if (!reasons.length) {
        notes.push(...describeClearing(cleared), ...describeUpdate(update.existing, update.steps));
        const extra = update.existing.extra.filter((name) => !cleared.some((c) => c.methodId === found.method!.id && c.name === name));
        if (extra.length) notes.push(`${extra.map((n) => `"${n}"`).join(", ")} isn't in the source and stays as it is.`);
        if (activate && activeNow.some((m) => m.id !== found.method!.id)) notes.push(`Its current method "${activeNow.filter((m) => m.id !== found.method!.id).map((m) => m.name).join("\", \"")}" stays on the queue, switched off.`);
        emptiedInUse(activate || inUse, found.method.id);
      }
      const nothingToDo = !update.existing.updates.length && !update.steps.length && !activate && !cleared.length;
      return {
        queue, status: reasons.length ? "blocked" : nothingToDo ? "upToDate" : "update", reasons, notes, methodName: found.method.name, method: {},
        steps: reasons.length ? [] : update.steps, existing: update.existing, cleared, activate, before
      };
    }

    const methodName = freeName(method.name, queue.methods.map((m) => m.name));
    if (methodName !== method.name) notes.push(`Already has a method named "${method.name}"; the copy is named "${methodName}".`);
    notes.push(...describeClearing(cleared));
    if (options.activate && queue.strategy === CUSTOM_STRATEGY && activeNow.length) notes.push(`Its current method "${activeNow.map((m) => m.name).join("\", \"")}" stays on the queue, switched off.`);
    if (!reasons.length) emptiedInUse(options.activate);

    const stepCopies: StepCopy[] = reasons.length ? [] : withUniqueNames(steps.map((step) => stepCopy(step, from, queue, newId)), newId);
    const methodPayload: Record<string, unknown> = { msdyn_name: methodName, msdyn_uniquename: `msdyn_uniquename_${newId()}`, msdyn_isactiveconfiguration: false, "msdyn_queueid@odata.bind": `/${QUEUE_SET}(${queue.id})` };
    if (method.description) methodPayload.msdyn_description = method.description;

    return { queue, status: reasons.length ? "blocked" : "copy", reasons, notes, methodName, method: methodPayload, steps: stepCopies, cleared, activate: options.activate, before };
  });
}
