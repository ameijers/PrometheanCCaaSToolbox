// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { QueueSource } from "./dataSource";
import { QueueOutcome, QueueResult, ResolvedPlan, StepResult } from "./model";
import { queuePayload } from "./payload";

// Creates the queues one at a time: the queue, then each member. If the queue itself fails, its members
// are skipped. A member that fails doesn't stop the other members or queues — memberships are
// independent — and the queue is reported as partly created. Nothing is ever deleted.

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

export async function executePlan(plan: ResolvedPlan, source: QueueSource, onProgress?: (p: ExecuteProgress) => void): Promise<QueueResult[]> {
  const total = plan.queues.reduce((n, q) => n + 1 + q.refs.members.length, 0);
  let done = 0;
  const results: QueueResult[] = [];
  const now = () => new Date().toISOString();

  for (const q of plan.queues) {
    const steps: StepResult[] = [];
    const notes: string[] = [];
    let queueId: string | undefined;

    onProgress?.({ done, total, message: `Creating queue "${q.name}"` });
    try {
      queueId = await source.createQueue(queuePayload(q));
      steps.push({ kind: "queue", label: "Queue", name: q.name, status: "created", id: queueId, at: now() });
    } catch (error) {
      steps.push({ kind: "queue", label: "Queue", name: q.name, status: "failed", error: errorMessage(error), at: now() });
    }
    done++;

    for (const member of q.refs.members) {
      const name = `${member.fullName} (${member.signIn})`;
      if (!queueId) { steps.push({ kind: "member", label: "Member", name, status: "skipped" }); done++; continue; }
      onProgress?.({ done, total, message: `${q.name}: adding ${member.fullName}` });
      try {
        await source.addMember(queueId, member.id);
        steps.push({ kind: "member", label: "Member", name, status: "created", id: member.id, at: now() });
      } catch (error) {
        steps.push({ kind: "member", label: "Member", name, status: "failed", error: errorMessage(error), at: now() });
      }
      done++;
    }

    if (queueId) {
      // The platform's queue plug-ins give every advanced queue an assignment input decision contract.
      // Check it happened: routing can't assign from a queue without one.
      const contract = await source.hasAssignmentContract(queueId).catch(() => undefined);
      if (contract === false) notes.push("The platform didn't set up this queue's assignment (no assignment input contract). Open the queue in the admin center and check its assignment method before using it.");
      if (contract === undefined) notes.push("Couldn't check whether the queue's assignment was set up. Open it in the admin center to confirm.");
      if (steps.some((s) => s.kind === "member" && s.status === "failed")) notes.push("Some members weren't added. Add them in the admin center, or fix the cause and add them there.");
      if (!q.refs.members.length) notes.push("No members yet. Add agents in the admin center before routing work to this queue.");
    }

    const failed = steps.some((s) => s.status === "failed");
    const outcome: QueueOutcome = !queueId ? "failed" : failed ? "partial" : "created";
    results.push({ name: q.name, queueId, outcome, steps, notes });
  }
  onProgress?.({ done: total, total, message: "Done" });
  return results;
}
