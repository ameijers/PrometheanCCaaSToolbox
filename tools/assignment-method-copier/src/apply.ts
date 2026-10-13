// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { CopierSource } from "./dataSource";
import { CopyResult, Method, QueueCopy, QueueRow } from "./model";
import { CUSTOM_STRATEGY, METHOD_SET, METHOD_TABLE, QUEUE_TABLE, RULESET_SET, RULESET_TABLE, STEP_TABLE } from "./schema";

// Copies the method to one queue at a time: the method first (switched off), then each ruleset and its
// step, and only when all of that exists is the queue switched over. A queue therefore never runs on a
// half-copied method, and a failed copy leaves a switched-off method that can be deleted in the admin
// center. Every copy is read back. One queue failing doesn't stop the others.

export interface ApplyProgress {
  done: number;
  total: number;
  message: string;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

const squash = (xml: string) => xml.replace(/\s+/g, "");

async function copyOne(copy: QueueCopy, source: CopierSource): Promise<CopyResult> {
  const result: CopyResult = { copy, status: "copied", created: [], activated: false, at: new Date().toISOString() };
  try {
    const methodId = await source.create(METHOD_TABLE, copy.method);
    result.methodId = methodId;
    result.created.push({ table: METHOD_TABLE, id: methodId, name: copy.methodName });
    for (const step of copy.steps) {
      const rulesetId = await source.create(RULESET_TABLE, step.ruleset);
      result.created.push({ table: RULESET_TABLE, id: rulesetId, name: String(step.ruleset.msdyn_name) });
      const stepId = await source.create(STEP_TABLE, { ...step.step, "msdyn_assignmentconfigurationid@odata.bind": `/${METHOD_SET}(${methodId})`, "msdyn_rulesetid@odata.bind": `/${RULESET_SET}(${rulesetId})` });
      result.created.push({ table: STEP_TABLE, id: stepId, name: String(step.step.msdyn_name) });
    }
    if (copy.activate) {
      for (const id of copy.before.activeMethodIds) await source.update(METHOD_TABLE, id, { msdyn_isactiveconfiguration: false });
      await source.update(METHOD_TABLE, methodId, { msdyn_isactiveconfiguration: true });
      await source.update(QUEUE_TABLE, copy.queue.id, { msdyn_assignmentstrategy: CUSTOM_STRATEGY });
      result.activated = true;
    }
  } catch (error) {
    result.status = result.created.length ? "partial" : "failed";
    result.error = result.created.length
      ? `${errorMessage(error)} The unfinished copy "${copy.methodName}" is on the queue; check the queue's assignment method in the admin center and delete the copy there.`
      : errorMessage(error);
  }
  return result;
}

// What differs between the copy as planned and as read back. Empty when they match.
export function verifyCopy(result: CopyResult, method: Method | undefined, queue: QueueRow | undefined): string[] {
  const copy = result.copy;
  if (!method || !queue) return ["it couldn't be read back"];
  const problems: string[] = [];
  const steps = [...method.steps].sort((a, b) => a.order - b.order);
  if (steps.length !== copy.steps.length) problems.push(`${steps.length} of ${copy.steps.length} rulesets are there`);
  copy.steps.forEach((planned, i) => {
    const read = steps[i];
    if (!read) return;
    const name = String(planned.ruleset.msdyn_name);
    if (read.type !== planned.step.msdyn_type) problems.push(`the ruleset "${name}" has a different kind`);
    if (!read.ruleset) problems.push(`the ruleset "${name}" is missing`);
    else if (squash(read.ruleset.definition) !== squash(String(planned.ruleset.msdyn_rulesetdefinition))) problems.push(`the rules of "${name}" read back differently`);
  });
  if (copy.activate) {
    if (queue.strategy !== CUSTOM_STRATEGY) problems.push("the queue isn't set to a custom method");
    const active = queue.methods.filter((m) => m.active).map((m) => m.id);
    if (active.length !== 1 || active[0] !== result.methodId) problems.push("the copy isn't the queue's only active method");
  }
  return problems;
}

export async function applyCopies(copies: QueueCopy[], source: CopierSource, onProgress?: (p: ApplyProgress) => void): Promise<CopyResult[]> {
  const toApply = copies.filter((c) => c.status === "copy");
  const results: CopyResult[] = [];
  for (let i = 0; i < toApply.length; i++) {
    onProgress?.({ done: i, total: toApply.length, message: `Copying to "${toApply[i].queue.name}"` });
    results.push(await copyOne(toApply[i], source));
  }
  onProgress?.({ done: toApply.length, total: toApply.length, message: "Checking the copies" });

  let queues: QueueRow[] | undefined;
  try { queues = await source.loadQueues(); } catch { queues = undefined; }
  for (const result of results) {
    if (result.status !== "copied" || !result.methodId) continue;
    let method: Method | undefined;
    try { method = await source.loadMethod(result.methodId); } catch { method = undefined; }
    const problems = verifyCopy(result, method, queues?.find((q) => q.id === result.copy.queue.id));
    if (problems.length) {
      result.status = "notVerified";
      result.error = `Copied, but ${problems.join("; ")}. Check the queue in the admin center.`;
    }
  }
  return results;
}

// Undo of the switch only: each queue goes back to the method it used before. The copied methods stay
// on their queues, switched off (this tool never deletes).
export async function switchBack(results: CopyResult[], source: CopierSource, onProgress?: (p: ApplyProgress) => void): Promise<CopyResult[]> {
  const toRevert = results.filter((r) => r.activated && r.methodId);
  const reverted: CopyResult[] = [];
  for (let i = 0; i < toRevert.length; i++) {
    const r = toRevert[i];
    onProgress?.({ done: i, total: toRevert.length, message: `Switching "${r.copy.queue.name}" back` });
    const result: CopyResult = { ...r, status: "copied", error: undefined, at: new Date().toISOString() };
    try {
      await source.update(QUEUE_TABLE, r.copy.queue.id, { msdyn_assignmentstrategy: r.copy.before.strategy });
      await source.update(METHOD_TABLE, r.methodId!, { msdyn_isactiveconfiguration: false });
      for (const id of r.copy.before.activeMethodIds) await source.update(METHOD_TABLE, id, { msdyn_isactiveconfiguration: true });
      result.activated = false;
    } catch (error) {
      result.status = "failed";
      result.error = `Couldn't switch back completely: ${errorMessage(error)} Check the queue's assignment method in the admin center.`;
    }
    reverted.push(result);
  }
  onProgress?.({ done: toRevert.length, total: toRevert.length, message: "Done" });
  return reverted;
}
