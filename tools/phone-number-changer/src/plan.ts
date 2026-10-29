// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ApplyResult, ChannelRow, Edit, Issue, isOutbound, Kind, KIND_LABELS, Numbers, PhoneNumber, Plan, PlannedChange, Step } from "./model";

// Planning a change of numbers, without touching Dataverse: what changes on which channel, what's
// wrong with it, and in which order to send the updates. Pure, so it's fully tested.
//
// The rules (from the user, and matching the live environment; see IMPLEMENTATION_STATUS.md):
// - a channel takes an active number that is enabled for its direction (inbound for an inbound
//   workstream, outbound for an outbound profile or proactive outbound workstream);
// - a number is on at most one inbound channel, and on at most one outbound profile (outbound and
//   proactive outbound count as outbound); one inbound channel and one outbound profile may share it;
// - an outbound profile's caller ID normally is its number, and follows it unless asked otherwise.

export type Side = "inbound" | "outbound";

// Which side of a number a channel uses; other channels (direct, no workstream) aren't limited.
export function sideOf(kind: Kind): Side | undefined {
  return kind === "inbound" ? "inbound" : isOutbound(kind) ? "outbound" : undefined;
}

const SIDE_RULE: Record<Side, string> = {
  inbound: "A number can be on one inbound channel only",
  outbound: "A number can be used by one outbound profile only"
};

export function numberLabel(numbers: Map<string, PhoneNumber>, id: string | undefined): string {
  return id ? numbers.get(id)?.number ?? "(unknown number)" : "no number";
}

// The numbers a channel ends up with after an edit.
export function afterOf(channel: ChannelRow, edit: Edit): Numbers {
  const numberId = edit.numberId ?? undefined;
  let callerIdId = channel.callerIdId;
  if (edit.callerIdId !== undefined) callerIdId = edit.callerIdId ?? undefined;
  else if (isOutbound(channel.kind) && edit.callerIdFollows !== false) callerIdId = numberId;
  return { numberId, callerIdId };
}

// Whether a number can be used by a channel of this kind; the reason if not.
export function unusableReason(number: PhoneNumber | undefined, channel: ChannelRow, what = "The number"): string | undefined {
  if (!number) return `${what} isn't in this environment any more.`;
  if (!number.active) return `${what} ${number.number} is deactivated.`;
  if (channel.kind === "inbound" && !number.inbound) return `${what} ${number.number} isn't enabled for inbound calls.`;
  if (isOutbound(channel.kind) && !number.outbound) return `${what} ${number.number} isn't enabled for outbound calls.`;
  return undefined;
}

// Short reason for the picker.
function unusableShort(number: PhoneNumber, channel: ChannelRow): string | undefined {
  if (!number.active) return "deactivated";
  if (channel.kind === "inbound" && !number.inbound) return "not enabled for inbound";
  if (isOutbound(channel.kind) && !number.outbound) return "not enabled for outbound";
  return undefined;
}

// The numbers a channel can be given, for the picker: free ones first, then numbers on another
// channel of the same side now (picking one means changing that channel too), then unusable ones.
// heldBy: the other channels on the same side that have the number now.
export function choicesFor(channel: ChannelRow, numbers: PhoneNumber[], channels: ChannelRow[] = []): { number: PhoneNumber; reason?: string; heldBy: ChannelRow[] }[] {
  const side = sideOf(channel.kind);
  const rank = (x: { reason?: string; heldBy: ChannelRow[] }) => (x.reason ? 2 : x.heldBy.length ? 1 : 0);
  return numbers
    .filter((n) => n.id !== channel.numberId)
    .map((n) => ({
      number: n,
      reason: unusableShort(n, channel),
      heldBy: side ? channels.filter((c) => c.id !== channel.id && c.numberId === n.id && sideOf(c.kind) === side) : []
    }))
    .sort((a, b) => rank(a) - rank(b) || a.number.number.localeCompare(b.number.number));
}

const where = (c: ChannelRow) => `"${c.name}" (${KIND_LABELS[c.kind].toLowerCase()}${c.workstreamName && c.workstreamName !== c.name ? ` ${c.workstreamName}` : ""})`;

export function planChanges(channels: ChannelRow[], numbers: PhoneNumber[], edits: Map<string, Edit>): Plan {
  const numberById = new Map(numbers.map((n) => [n.id, n]));
  const changes: PlannedChange[] = [];
  edits.forEach((edit, id) => {
    const channel = channels.find((c) => c.id === id);
    if (!channel) return;
    const before: Numbers = { numberId: channel.numberId, callerIdId: channel.callerIdId };
    const after = afterOf(channel, edit);
    const number = before.numberId !== after.numberId;
    const callerId = before.callerIdId !== after.callerIdId;
    if (number || callerId) changes.push({ channel, before, after, number, callerId, ...(edit.auto ? { auto: true } : {}) });
  });

  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], channelId: string, message: string) => issues.push({ severity, channelId, message });
  changes.forEach((c) => {
    if (c.number && c.after.numberId) { const r = unusableReason(numberById.get(c.after.numberId), c.channel); if (r) add("error", c.channel.id, r); }
    if (c.callerId && c.after.callerIdId && c.after.callerIdId !== c.after.numberId) {
      const n = numberById.get(c.after.callerIdId);
      const r = !n ? "The caller ID number isn't in this environment any more." : !n.active ? `The caller ID ${n.number} is deactivated.` : !n.outbound ? `The caller ID ${n.number} isn't enabled for outbound calls.` : undefined;
      if (r) add("error", c.channel.id, r);
    }
    if (c.number && !c.after.numberId && c.channel.kind === "inbound") add("warning", c.channel.id, "Will have no number: nobody can call this channel until it gets one.");
    if (c.number && !c.after.numberId && isOutbound(c.channel.kind)) add("warning", c.channel.id, "Will have no number: agents can't call out with this profile until it gets one.");
    if (!c.channel.active) add("warning", c.channel.id, "This channel is deactivated.");
  });

  // Who has which number once everything is changed: one per side.
  const finalOf = new Map(channels.map((c) => [c.id, c.numberId]));
  changes.forEach((c) => finalOf.set(c.channel.id, c.after.numberId));
  changes.filter((c) => c.number && c.after.numberId).forEach((c) => {
    const side = sideOf(c.channel.kind);
    if (!side) return;
    const clash = channels.filter((o) => o.id !== c.channel.id && sideOf(o.kind) === side && finalOf.get(o.id) === c.after.numberId);
    if (clash.length) {
      add("error", c.channel.id, `${numberLabel(numberById, c.after.numberId)} is on ${clash.map(where).join(", ")}. ${SIDE_RULE[side]}: give ${clash.length === 1 ? "that channel" : "those channels"} another number (or no number) in the same change.`);
    }
  });
  return { changes, issues };
}

// With "take a number off its other channel automatically" on: every channel on the same side that
// has a number someone else picked (and isn't being changed itself) gets no number, in the same change.
// The added edits are marked auto.
export function withDetaches(channels: ChannelRow[], edits: Map<string, Edit>): Map<string, Edit> {
  const all = new Map(edits);
  edits.forEach((edit, id) => {
    const channel = channels.find((c) => c.id === id);
    const side = channel && sideOf(channel.kind);
    if (!channel || !side || !edit.numberId || edit.numberId === channel.numberId) return;
    channels
      .filter((o) => o.id !== id && sideOf(o.kind) === side && o.numberId === edit.numberId && !edits.has(o.id))
      .forEach((o) => all.set(o.id, { numberId: null, callerIdFollows: !o.callerIdId || o.callerIdId === o.numberId, auto: true }));
  });
  return all;
}

// The updates to send, in a safe order: a channel gets a number only once no other channel on the
// same side has it any more, so a move (A gives its number to B) updates A first. In a swap (A and B
// trade numbers) one of them has to let go first: its number is cleared, the other takes it, then it
// gets its new number.
export function orderSteps(plan: Plan, channels: ChannelRow[]): Step[] {
  const state = new Map(channels.map((c) => [c.id, c.numberId]));
  const heldByOther = (numberId: string, self: ChannelRow) => {
    const side = sideOf(self.kind);
    return !!side && channels.some((o) => o.id !== self.id && sideOf(o.kind) === side && state.get(o.id) === numberId);
  };
  const final = (c: PlannedChange): Step => ({
    change: c,
    set: { ...(c.number ? { numberId: c.after.numberId ?? null } : {}), ...(c.callerId ? { callerIdId: c.after.callerIdId ?? null } : {}) }
  });
  const ready = (c: PlannedChange) => !c.number || !c.after.numberId || !heldByOther(c.after.numberId, c.channel);

  const steps: Step[] = [];
  const pending = [...plan.changes];
  const cleared = new Set<string>();
  while (pending.length) {
    let i = pending.findIndex(ready);
    if (i < 0) {
      // A swap: free one channel's number first (once; if that doesn't help, the clash isn't part
      // of this change and the update will be skipped when it's sent).
      const c = pending.find((p) => p.number && sideOf(p.channel.kind) && !cleared.has(p.channel.id) && state.get(p.channel.id));
      if (c) {
        steps.push({ change: c, set: { numberId: null }, temporary: true });
        state.set(c.channel.id, undefined);
        cleared.add(c.channel.id);
        continue;
      }
      i = 0;
    }
    const [c] = pending.splice(i, 1);
    steps.push(final(c));
    if (c.number) state.set(c.channel.id, c.after.numberId);
  }
  return steps;
}

// Putting the numbers back: every channel that was changed (or may have been) gets its previous
// numbers again, through the same planning and ordering.
export function revertEdits(results: ApplyResult[]): Map<string, Edit> {
  const edits = new Map<string, Edit>();
  results.filter((r) => r.status === "updated" || r.status === "notVerified").forEach((r) => {
    edits.set(r.change.channel.id, {
      numberId: r.change.before.numberId ?? null,
      callerIdId: r.change.callerId ? r.change.before.callerIdId ?? null : undefined,
      callerIdFollows: false
    });
  });
  return edits;
}

export function describeChange(c: PlannedChange, numbers: Map<string, PhoneNumber>): string {
  const parts: string[] = c.auto ? ["taken off automatically"] : [];
  if (c.number) parts.push(`number ${numberLabel(numbers, c.before.numberId)} → ${numberLabel(numbers, c.after.numberId)}`);
  if (c.callerId) parts.push(`caller ID ${numberLabel(numbers, c.before.callerIdId)} → ${numberLabel(numbers, c.after.callerIdId)}`);
  return parts.join("; ");
}
