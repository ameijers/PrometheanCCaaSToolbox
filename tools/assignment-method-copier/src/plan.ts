// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Method, QueueCopy, QueueRow, StepCopy } from "./model";
import { CONTRACT_SET, CUSTOM_STRATEGY, DECLARATIVE_RULESET, QUEUE_SET, QUEUE_TYPE_LABELS } from "./schema";

// Works out, for every selected queue, exactly what a copy of the source method would write. Pure: it
// reads nothing and writes nothing.

export interface CopySource {
  queue: QueueRow;
  method: Method;
}

export interface CopyOptions {
  // Make the copy the queue's assignment method. Off: the copy is added to the queue but not used.
  activate: boolean;
}

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

const RULE_TAG = /<rule\s+id="([^"]+)"(?:\s+name="([^"]*)")?/g;

function unescapeXml(value: string): string {
  return value.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// The rules of a ruleset definition, in order.
export function rulesOf(definition: string): { id: string; name: string }[] {
  return [...definition.matchAll(RULE_TAG)].map((m) => ({ id: m[1], name: unescapeXml(m[2] ?? "") }));
}

// A context variable is referred to as liveworkitemcontext.<workstream id>.<name>, so a rule using
// one only ever matches work that came in through that workstream.
export function usesContextVariables(definition: string): boolean {
  return /liveworkitemcontext\.[0-9a-f]{8}-[0-9a-f-]{27}\./i.test(definition);
}

// Gives every rule of a copy its own id, as the admin center does for a new rule.
function withNewRuleIds(definition: string, newId: () => string): { definition: string; ruleIds: Record<string, string> } {
  const ruleIds: Record<string, string> = {};
  const copied = definition.replace(/(<rule\s+id=")([^"]+)(")/g, (_all, open: string, id: string, close: string) => {
    ruleIds[id] = newId();
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

export function planCopies(source: CopySource, targets: QueueRow[], options: CopyOptions, newId: () => string): QueueCopy[] {
  const blockers = sourceProblems(source);
  const { queue: from, method } = source;
  const steps = [...method.steps].sort((a, b) => a.order - b.order);

  return targets.map((queue) => {
    const reasons = [...blockers];
    const notes: string[] = [];
    if (same(queue.id, from.id)) reasons.push("This is the queue the method is copied from.");
    if (queue.type !== from.type) reasons.push(`This is a ${QUEUE_TYPE_LABELS[queue.type] ?? "different type of"} queue; the method belongs to a ${QUEUE_TYPE_LABELS[from.type] ?? "different type of"} queue.`);
    if (!queue.inputContractId) reasons.push("This queue has no assignment contract. Open and save it in the admin center, then reload.");

    const methodName = freeName(method.name, queue.methods.map((m) => m.name));
    if (methodName !== method.name) notes.push(`Already has a method named "${method.name}"; the copy is named "${methodName}".`);
    const activeNow = queue.methods.filter((m) => m.active);
    if (options.activate && queue.strategy === CUSTOM_STRATEGY && activeNow.length) notes.push(`Its current method "${activeNow.map((m) => m.name).join("\", \"")}" stays on the queue, switched off.`);

    const stepCopies: StepCopy[] = reasons.length ? [] : steps.map((step) => {
      const ruleset = step.ruleset!;
      const copied = withNewRuleIds(ruleset.definition, newId);
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
      // A prioritization ruleset's output is the queue's own contract; an assignment ruleset's is the
      // platform's shared assignment output contract.
      if (ruleset.outputContractId) payload["msdyn_outputcontractid@odata.bind"] = contractBind(same(ruleset.outputContractId, from.inputContractId) ? queue.inputContractId! : ruleset.outputContractId);
      return {
        ruleset: payload,
        step: { msdyn_name: step.name, msdyn_type: step.type, msdyn_steporder: step.order, msdyn_isdefaultruleset: step.isDefault },
        sourceDefinition: ruleset.definition,
        ruleIds: copied.ruleIds
      };
    });

    // msdyn_uniquename is required on all three tables and nothing fills it in; these are the shapes the
    // admin center gives them.
    const uniqueName = () => `msdyn_${newId().replace(/-/g, "")}`;
    stepCopies.forEach((copy) => { copy.ruleset.msdyn_uniquename = uniqueName(); copy.step.msdyn_uniquename = uniqueName(); });

    const methodPayload: Record<string, unknown> = { msdyn_name: methodName, msdyn_uniquename: `msdyn_uniquename_${newId()}`, msdyn_isactiveconfiguration: false, "msdyn_queueid@odata.bind": `/${QUEUE_SET}(${queue.id})` };
    if (method.description) methodPayload.msdyn_description = method.description;

    return {
      queue, status: reasons.length ? "blocked" : "copy", reasons, notes, methodName, method: methodPayload, steps: stepCopies,
      activate: options.activate, before: { strategy: queue.strategy, activeMethodIds: activeNow.map((m) => m.id) }
    };
  });
}
