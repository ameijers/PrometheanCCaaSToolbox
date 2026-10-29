// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { NumberSource } from "./dataSource";
import { ChannelRow, PhoneNumber } from "./model";

// An in-memory sample environment: inbound workstreams, outbound profiles (each with its hidden
// outbound workstream) and a proactive outbound workstream, numbers shared by one inbound channel and
// one outbound profile as in a real environment, a free number, an inbound-only and an outbound-only number, a
// deactivated number, and a channel that refuses updates, so the sample shows the checks, a move, a
// swap, a failure and the revert.

const id = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const NUMBERS: PhoneNumber[] = [
  { id: id("aa", 1), number: "+31201234567", active: true, inbound: true, outbound: true },
  { id: id("aa", 2), number: "+31201234568", active: true, inbound: true, outbound: true },
  { id: id("aa", 3), number: "+31201234570", active: true, inbound: true, outbound: true },
  { id: id("aa", 4), number: "+31201234580", active: true, inbound: true, outbound: true },
  { id: id("aa", 5), number: "+31201234590", active: true, inbound: true, outbound: true },
  { id: id("aa", 6), number: "+31201234599", active: true, inbound: false, outbound: true },
  { id: id("aa", 7), number: "+31800123456", active: true, inbound: true, outbound: false },
  { id: id("aa", 8), number: "+31201234500", active: false, inbound: true, outbound: true }
];
const num = (n: number) => NUMBERS[n - 1].id;

// The channel whose updates fail, to show how a failure is reported.
const LOCKED = "Claims – after hours";

const WORKSTREAMS = ["Sales – Voice", "Support – Voice", "Billing – Voice", "Claims – Voice", "Sales outbound", "Support outbound", "Collections outbound", "Missed-call callbacks", "Legacy – Voice"];

function channel(n: number, name: string, workstreamName: string, kind: ChannelRow["kind"], numberId?: string, callerIdId?: string, extra: Partial<ChannelRow> = {}): ChannelRow {
  // A workstream id per workstream name, so channels of one workstream group together.
  const ws = [...new Set(WORKSTREAMS)].indexOf(workstreamName) + 1;
  return { id: id("cc", n), name, workstreamId: id("ee", ws), workstreamName, kind, active: true, numberId, callerIdId, ...extra };
}

const CHANNELS: ChannelRow[] = [
  channel(1, "Sales line", "Sales – Voice", "inbound", num(1)),
  channel(2, "Support line", "Support – Voice", "inbound", num(2)),
  channel(3, "Support – premium", "Support – Voice", "inbound", num(7)),
  channel(4, "Billing line", "Billing – Voice", "inbound", num(3)),
  channel(5, "Claims line", "Claims – Voice", "inbound", undefined),
  channel(6, LOCKED, "Claims – Voice", "inbound", num(4)),
  channel(7, "Sales outbound", "Sales outbound", "outbound", num(1), num(1)),
  channel(8, "Support outbound", "Support outbound", "outbound", num(2), num(2)),
  channel(9, "Collections outbound", "Collections outbound", "outbound", num(6), num(6)),
  channel(10, "Missed-call callbacks", "Missed-call callbacks", "proactive", num(3), num(3)),
  channel(11, "Old promo line", "Legacy – Voice", "inbound", num(8), undefined, { active: false })
];

let channels: ChannelRow[] = JSON.parse(JSON.stringify(CHANNELS));

export function resetDemo(): void {
  channels = JSON.parse(JSON.stringify(CHANNELS));
}

export const demoSource: NumberSource = {
  mode: "demo",
  async load() {
    return { channels: JSON.parse(JSON.stringify(channels)), numbers: JSON.parse(JSON.stringify(NUMBERS)) };
  },
  async setNumbers(channelId, set) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    const row = channels.find((c) => c.id === channelId);
    if (!row) throw new Error("Record not found.");
    if (row.name === LOCKED) throw new Error("Simulated failure (sample environment): the update was rejected.");
    if (set.numberId !== undefined) row.numberId = set.numberId ?? undefined;
    if (set.callerIdId !== undefined) row.callerIdId = set.callerIdId ?? undefined;
  },
  recordUrl() {
    return undefined;
  },
  currentUser() {
    return "Sample user";
  }
};
