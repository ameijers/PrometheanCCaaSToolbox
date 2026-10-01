import { RecordingField, RecordingSettings, recordingColumns } from "../../voice-workstream-builder/src/recordingSettings";
import { ProvisionerSource } from "./dataSource";
import { ApplyResult, ChannelChange, ChannelRow } from "./model";

// Applies planned changes one channel at a time, writing only the columns that change on that channel,
// then reads every channel back to confirm the platform kept the new values (a plug-in could refuse or
// rewrite them). One channel failing doesn't stop the others.

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

// The option and its start mode are stored across the same four columns, so if either changes both
// are written.
export function columnsFor(change: ChannelChange): Record<string, unknown> {
  const fields = new Set<RecordingField>(change.changedFields);
  if (fields.has("capture") || fields.has("start")) { fields.add("capture"); fields.add("start"); }
  const partial: Partial<RecordingSettings> = {};
  fields.forEach((f) => { (partial as Record<RecordingField, unknown>)[f] = change.after[f]; });
  return recordingColumns(partial);
}

export async function applyChanges(changes: ChannelChange[], source: ProvisionerSource, onProgress?: (p: ApplyProgress) => void): Promise<ApplyResult[]> {
  const toApply = changes.filter((c) => c.status === "change");
  const results: ApplyResult[] = [];
  for (let i = 0; i < toApply.length; i++) {
    const change = toApply[i];
    onProgress?.({ done: i, total: toApply.length, message: `Updating "${change.channel.name}"` });
    try {
      await source.updateChannel(change.channel.id, columnsFor(change));
      results.push({ change, status: "updated", at: new Date().toISOString() });
    } catch (error) {
      results.push({ change, status: "failed", error: errorMessage(error), at: new Date().toISOString() });
    }
  }
  onProgress?.({ done: toApply.length, total: toApply.length, message: "Checking the new values" });

  let current: ChannelRow[] | undefined;
  try { current = await source.loadChannels(); } catch { current = undefined; }
  results.forEach((result) => {
    if (result.status !== "updated") return;
    const row = current?.find((c) => c.id === result.change.channel.id);
    if (!row) { result.status = "notVerified"; result.error = "Updated, but couldn't be read back to confirm."; return; }
    result.readBack = row.settings;
    const mismatched = result.change.changedFields.filter((f) => row.settings[f] !== result.change.after[f]);
    if (mismatched.length) {
      result.status = "notVerified";
      result.error = `Saved, but reads back differently for: ${mismatched.join(", ")}. The platform may have adjusted the value; check the channel in the admin center.`;
    }
  });
  return results;
}

// Undo: put back the previous values of the changed fields on every channel that was updated (verified
// or not) — including a state that isn't one of the options, since it's restored exactly.
export function revertPlan(results: ApplyResult[]): ChannelChange[] {
  return results.filter((r) => r.status !== "failed").map((r) => {
    const current = r.readBack ?? r.change.after;
    const changedFields = r.change.changedFields;
    const after: RecordingSettings = { ...current };
    changedFields.forEach((f) => { (after as Record<RecordingField, unknown>)[f] = r.change.before[f]; });
    return { channel: { ...r.change.channel, settings: current }, before: current, after, changedFields, status: "change" };
  });
}
