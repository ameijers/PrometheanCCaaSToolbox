// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ApplyResult, ChannelRow, Edit, Issue, isOutbound, KIND_LABELS, Numbers, PhoneNumber, Plan, PlannedChange, Step } from "./model";

// Planning a change of numbers, without touching Dataverse: what changes on which channel, what's
// wrong with it, and in which order to send the updates. Pure, so it's fully tested.
//
// The rules, from the live environment (see IMPLEMENTATION_STATUS.md):
// - a channel takes an active number that is enabled for its direction (inbound for an inbound
//   workstream, outbound for an outbound profile or proactive outbound workstream);
// - one number can be on an inbound workstream and on outbound profiles at the same time, and on
//   several outbound profiles, but this tool never puts one number on two inbound channels (that
//   couldn't be confirmed as allowed, and a call can only arrive in one place);
// - an outbound profile's caller ID normally is its number, and follows it unless asked otherwise.

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

// The numbers a channel can be given, for the picker: usable ones first.
export function choicesFor(channel: ChannelRow, numbers: PhoneNumber[]): { number: PhoneNumber; reason?: string }[] {
  return numbers
    .map((n) => ({ number: n, reason: unusableReason(n, channel) }))
    .sort((a, b) => Number(!!a.reason) - Number(!!b.reason) || a.number.number.localeCompare(b.number.number));
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
    if (number || callerId) changes.push({ channel, before, after, number, callerId });
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

  // Who has which number once everything is changed.
  const finalOf = new Map(channels.map((c) => [c.id, c.numberId]));
  changes.forEach((c) => finalOf.set(c.channel.id, c.after.numberId));
  const changed = new Set(changes.filter((c) => c.number).map((c) => c.channel.id));
  const usersOf = new Map<string, ChannelRow[]>();
  channels.forEach((c) => { const n = finalOf.get(c.id); if (n) usersOf.set(n, [...(usersOf.get(n) ?? []), c]); });
  changes.filter((c) => c.number && c.after.numberId).forEach((c) => {
    const others = (usersOf.get(c.after.numberId!) ?? []).filter((o) => o.id !== c.channel.id);
    const inboundClash = c.channel.kind === "inbound" ? others.filter((o) => o.kind === "inbound") : [];
    if (inboundClash.length) {
      add("error", c.channel.id, `${numberLabel(numberById, c.after.numberId)} would also answer on ${inboundClash.map(where).join(", ")}${inboundClash.some((o) => !changed.has(o.id)) ? "" : " after this change"}. A number can be on one inbound channel only: give that channel another number in the same change.`);
    }
    const shared = others.filter((o) => !inboundClash.includes(o));
    if (shared.length) add("warning", c.channel.id, `${numberLabel(numberById, c.after.numberId)} is also used by ${shared.map(where).join(", ")}.`);
  });
  return { changes, issues };
}

// The updates to send, in a safe order: an inbound channel gets a number only once no other inbound
// channel has it any more, so a move (A gives its number to B) updates A first. In a swap between
// inbound channels (A and B trade numbers) one of them has to let go first: its number is cleared, the
// other takes it, then it gets its new number.
export function orderSteps(plan: Plan, channels: ChannelRow[]): Step[] {
  const state = new Map(channels.map((c) => [c.id, c.numberId]));
  const inbound = new Set(channels.filter((c) => c.kind === "inbound").map((c) => c.id));
  const heldByOther = (numberId: string, self: string) => [...inbound].some((id) => id !== self && state.get(id) === numberId);
  const final = (c: PlannedChange): Step => ({
    change: c,
    set: { ...(c.number ? { numberId: c.after.numberId ?? null } : {}), ...(c.callerId ? { callerIdId: c.after.callerIdId ?? null } : {}) }
  });
  const ready = (c: PlannedChange) => !c.number || c.channel.kind !== "inbound" || !c.after.numberId || !heldByOther(c.after.numberId, c.channel.id);

  const steps: Step[] = [];
  const pending = [...plan.changes];
  const cleared = new Set<string>();
  while (pending.length) {
    let i = pending.findIndex(ready);
    if (i < 0) {
      // A swap: free one inbound channel's number first (once; if that doesn't help, the clash isn't
      // part of this change and the update will be skipped when it's sent).
      const c = pending.find((p) => p.channel.kind === "inbound" && p.number && !cleared.has(p.channel.id) && state.get(p.channel.id));
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
  const parts: string[] = [];
  if (c.number) parts.push(`number ${numberLabel(numbers, c.before.numberId)} → ${numberLabel(numbers, c.after.numberId)}`);
  if (c.callerId) parts.push(`caller ID ${numberLabel(numbers, c.before.callerIdId)} → ${numberLabel(numbers, c.after.callerIdId)}`);
  return parts.join("; ");
}
