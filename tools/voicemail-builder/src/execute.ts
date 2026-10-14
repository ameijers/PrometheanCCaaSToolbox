// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { VoicemailSource } from "./dataSource";
import { readIntakeRules, setIntakeRule } from "./intake";
import { QueueOutcome, QueuePlan, QueueResult, ResolvedPlan, StepResult } from "./model";
import { CONDITIONS, applyChanges, describe, readRules } from "./overflow";
import { hasWork, memberLabel } from "./plan";
import {
  ASSIGNMENT_METHODS, CONTRACT_TABLE, DECISION_LIST, DECLARATIVE_RULESET, ENTITY_SETS, HUB_TABLE, INQUEUE_NAV, PREQUEUE_NAV, QUEUE_TABLE, RECORD_QUEUE, RULESET_TABLE,
  VOICEMAIL_WORKSTREAM_DEFAULTS, WORKSTREAM_TABLE
} from "./schema";

// Works through the plan one queue at a time, in an order where nothing points at a record that
// doesn't exist yet, and the voice queue only starts sending calls to voicemail at the very end:
//   1. the voicemail queue (Record) and its members;
//   2. the voicemail record workstream, with that queue as its fallback queue;
//   3. the intake rule that sends this queue's voicemails to that workstream;
//   4. the overflow rules on the voice queue, in a new ruleset (linked to the queue) or added to /
//      updated in its existing one;
//   5. a read-back of every ruleset changed.
// A queue that fails doesn't stop the others. Nothing is ever deleted.

export interface ExecuteProgress {
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

const bind = (table: string, id: string) => `/${ENTITY_SETS[table]}(${id})`;

async function runQueue(plan: QueuePlan, resolved: ResolvedPlan, source: VoicemailSource, newId: () => string): Promise<QueueResult> {
  const { row, queue } = plan;
  const catalog = resolved.catalog;
  const steps: StepResult[] = [];
  const notes: string[] = [];
  const now = () => new Date().toISOString();
  const done = (outcome: QueueOutcome): QueueResult => ({ name: row.queueName, queueId: queue?.id, outcome, steps, notes });
  const failed = () => {
    notes.push("Stopped part-way. What was created is listed above; upload the file again to finish (existing parts are reused), or check the queue in the admin center.");
    return done(steps.some((s) => s.status !== "failed" && s.status !== "skipped") ? "partial" : "failed");
  };
  const step = async <T>(label: string, name: string, status: StepResult["status"], run: () => Promise<T>): Promise<T | undefined> => {
    try {
      const value = await run();
      steps.push({ label, name, status, id: typeof value === "string" ? value : undefined, at: now() });
      return value;
    } catch (error) {
      steps.push({ label, name, status: "failed", error: errorMessage(error), at: now() });
      throw error;
    }
  };
  const checks: { rulesetId: string; ruleIds: string[]; label: string }[] = [];

  try {
    // 1. The voicemail queue and its members.
    let voicemailQueueId = plan.voicemailQueue?.id;
    if (!voicemailQueueId) {
      voicemailQueueId = await step("Voicemail queue", row.voicemailQueueName, "created", () => source.create(QUEUE_TABLE, {
        name: row.voicemailQueueName, msdyn_isomnichannelqueue: true, msdyn_queuetype: RECORD_QUEUE,
        msdyn_assignmentstrategy: ASSIGNMENT_METHODS[resolved.settings.assignmentMethod], msdyn_priority: 1, queueviewtype: 1
      }));
    }
    for (const member of plan.members) {
      await step("Member", memberLabel(member), "added", () => source.addMember(voicemailQueueId!, member.id));
    }

    // 2. The voicemail workstream.
    let workstreamId = plan.voicemailWorkstream?.id;
    if (!workstreamId) {
      workstreamId = await step("Voicemail workstream", row.voicemailWorkstreamName, "created", () => source.create(WORKSTREAM_TABLE, {
        msdyn_name: row.voicemailWorkstreamName, ...VOICEMAIL_WORKSTREAM_DEFAULTS,
        "msdyn_masterentityroutingconfigurationId@odata.bind": bind(HUB_TABLE, catalog.hub!.id), "msdyn_defaultqueue@odata.bind": bind(QUEUE_TABLE, voicemailQueueId!)
      }));
    }

    // 3. The intake rule, written into the hub's rules as they are right now.
    if (plan.intake !== "keep") {
      const hubRulesetId = catalog.hub!.rulesetId!;
      await step("Intake rule", `${row.queueName} → ${row.voicemailWorkstreamName}`, plan.intake === "add" ? "added" : "updated", async () => {
        const current = await source.loadDefinition(hubRulesetId);
        const replace = plan.intake === "update" ? readIntakeRules(current).find((r) => r.queueId === queue!.id) : undefined;
        const rule = { id: replace?.id ?? newId(), name: replace?.name ?? `Voicemail – ${row.queueName}`, queueId: queue!.id, workstreamId: workstreamId! };
        await source.update(RULESET_TABLE, hubRulesetId, { msdyn_rulesetdefinition: setIntakeRule(current, rule, replace) });
        checks.push({ rulesetId: hubRulesetId, ruleIds: [rule.id], label: "intake rule" });
      });
    }

    // 4. The overflow rules.
    for (const stage of plan.stages.filter((s) => s.changes.length)) {
      const label = stage.stage === "prequeue" ? "Overflow (before queueing)" : "Overflow (while waiting)";
      const what = stage.changes.map((c) => `${c.kind === "add" ? "add" : "update"} ${describe(c.wanted)}`).join("; ");
      if (stage.ruleset) {
        const rulesetId = stage.ruleset.id;
        await step(label, what, "updated", async () => {
          const current = await source.loadDefinition(rulesetId);
          // Rules matched at review time are found again in the current rules, by condition.
          const fresh = readRules(current);
          const changes = stage.changes.map((c) => {
            if (c.kind === "add") return c;
            const rule = fresh.find((r) => r.id === c.rule.id) ?? fresh.find((r) => r.condition === c.wanted.condition);
            if (!rule) throw new Error(`The ${CONDITIONS[c.wanted.condition].label.toLowerCase()} rule was removed since the upload. Upload the file again.`);
            return { ...c, rule };
          });
          const result = applyChanges(current, changes, catalog.voicemailActionId!, newId);
          await source.update(RULESET_TABLE, rulesetId, { msdyn_rulesetdefinition: result.definition });
          checks.push({ rulesetId, ruleIds: result.ruleIds, label: "overflow rules" });
          return rulesetId;
        });
      } else {
        const result = applyChanges(undefined, stage.changes, catalog.voicemailActionId!, newId);
        const contracts = stage.stage === "prequeue" ? [catalog.contracts.prequeueInput!, catalog.contracts.prequeueOutput!] : [catalog.contracts.inqueueInput!, catalog.contracts.inqueueOutput!];
        const rulesetId = await step(label, what, "created", () => source.create(RULESET_TABLE, {
          msdyn_name: `queue_${stage.stage}_${row.queueName}`, msdyn_uniquename: `msdyn_${newId()}`, msdyn_rulesetdefinition: result.definition,
          msdyn_rulesettype: DECLARATIVE_RULESET, msdyn_authoringmode: DECISION_LIST, msdyn_isinputcollection: false, msdyn_persistoutputdata: false, msdyn_refreshinputdata: false,
          "msdyn_inputcontractid@odata.bind": bind(CONTRACT_TABLE, contracts[0]), "msdyn_outputcontractid@odata.bind": bind(CONTRACT_TABLE, contracts[1])
        }));
        await step("Queue", `${row.queueName} linked to its ${stage.stage === "prequeue" ? "pre-queue" : "in-queue"} overflow rules`, "updated", () =>
          source.update(QUEUE_TABLE, queue!.id, { [`${stage.stage === "prequeue" ? PREQUEUE_NAV : INQUEUE_NAV}@odata.bind`]: bind(RULESET_TABLE, rulesetId!) }));
        checks.push({ rulesetId: rulesetId!, ruleIds: result.ruleIds, label: "overflow rules" });
      }
    }
  } catch {
    return failed();
  }

  plan.stages.filter((s) => s.skipped.length).forEach((s) => notes.push(`Left as it is (Skip): ${s.skipped.join(", ")}, because the existing rule has another action.`));

  // 5. Read back.
  for (const check of checks) {
    const after = await source.loadDefinition(check.rulesetId).catch(() => undefined);
    const ids = [...(after ?? "").matchAll(/<rule\s+id="([^"]*)"/g)].map((m) => m[1]);
    const missing = check.ruleIds.filter((id) => !ids.includes(id));
    if (after === undefined) notes.push(`Couldn't read the ${check.label} back to confirm them. Check the queue in the admin center.`);
    else if (missing.length) { notes.push(`Saved, but ${missing.length} of the ${check.label} don't read back. Check the queue in the admin center.`); return done("partial"); }
  }
  return done("done");
}

export async function executePlan(plan: ResolvedPlan, source: VoicemailSource, newId: () => string, onProgress?: (p: ExecuteProgress) => void): Promise<QueueResult[]> {
  const todo = plan.queues.filter((q) => !q.blocked && q.queue && hasWork(q));
  const results: QueueResult[] = [];
  for (let i = 0; i < todo.length; i++) {
    onProgress?.({ done: i, total: todo.length, message: `Setting up voicemail for "${todo[i].row.queueName}"` });
    results.push(await runQueue(todo[i], plan, source, newId));
  }
  onProgress?.({ done: todo.length, total: todo.length, message: "Done" });
  return results;
}
