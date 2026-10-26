// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { NumberSource } from "./dataSource";
import { ApplyResult, ChannelRow, PlannedChange, Step } from "./model";
import { sideOf } from "./plan";

// Sends the updates in the planned order, one at a time. Before a channel takes a number, it checks
// that no other channel on the same side (inbound, or outbound) still has it (one that should have let
// go may have failed); if one does, that update is skipped rather than doubling the number up. Then
// it reads every channel back to confirm the platform kept the new numbers.

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

export async function applySteps(steps: Step[], channels: ChannelRow[], source: NumberSource, onProgress?: (p: ApplyProgress) => void): Promise<ApplyResult[]> {
  const state = new Map(channels.map((c) => [c.id, c.numberId]));
  const results = new Map<string, ApplyResult>();
  const failed = new Set<string>();
  const changes: PlannedChange[] = [];
  steps.forEach((s) => { if (!changes.includes(s.change)) changes.push(s.change); });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const id = step.change.channel.id;
    onProgress?.({ done: i, total: steps.length, message: `${step.temporary ? "Freeing the number of" : "Updating"} "${step.change.channel.name}"` });
    if (failed.has(id)) continue;
    const takes = step.set.numberId;
    const side = sideOf(step.change.channel.kind);
    if (!step.temporary && takes && side) {
      const holder = channels.find((c) => c.id !== id && sideOf(c.kind) === side && state.get(c.id) === takes);
      if (holder) {
        failed.add(id);
        results.set(id, { change: step.change, status: "skipped", error: `Not changed: "${holder.name}" still has this number, so it can't go on a second ${side} channel.`, at: new Date().toISOString() });
        continue;
      }
    }
    try {
      await source.setNumbers(id, step.set);
      if (step.set.numberId !== undefined) state.set(id, step.set.numberId ?? undefined);
      if (!step.temporary) results.set(id, { change: step.change, status: "updated", at: new Date().toISOString() });
    } catch (error) {
      failed.add(id);
      const message = errorMessage(error);
      results.set(id, { change: step.change, status: "failed", error: step.temporary ? `Couldn't free its number for the swap: ${message}` : message, at: new Date().toISOString() });
    }
  }
  onProgress?.({ done: steps.length, total: steps.length, message: "Checking the new numbers" });

  let current: ChannelRow[] | undefined;
  try { current = (await source.load()).channels; } catch { current = undefined; }
  const ordered = changes.map((c) => results.get(c.channel.id)).filter((r): r is ApplyResult => !!r);
  ordered.forEach((r) => {
    const row = current?.find((c) => c.id === r.change.channel.id);
    if (row) r.readBack = { numberId: row.numberId, callerIdId: row.callerIdId };
    if (r.status !== "updated") return;
    if (!row) { r.status = "notVerified"; r.error = "Updated, but couldn't be read back to confirm."; return; }
    const wrong = [r.change.number && row.numberId !== r.change.after.numberId ? "number" : "", r.change.callerId && row.callerIdId !== r.change.after.callerIdId ? "caller ID" : ""].filter(Boolean);
    if (wrong.length) { r.status = "notVerified"; r.error = `Saved, but the ${wrong.join(" and ")} reads back differently. Check the channel in the admin center.`; }
  });
  // A channel freed for a swap whose new number then failed is left without a number: say so.
  ordered.filter((r) => r.status === "failed" && steps.some((s) => s.temporary && s.change === r.change) && r.readBack && !r.readBack.numberId)
    .forEach((r) => { r.error = `${r.error} It has no number now; give it one (or revert).`; });
  return ordered;
}
