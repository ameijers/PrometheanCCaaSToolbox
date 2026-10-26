// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// What a voice channel is used for, from its workstream's direction (msdyn_direction):
// - inbound: a voice channel of an inbound workstream (the number customers call);
// - outbound: an outbound profile — under the hood an outbound workstream with one voice channel,
//   which the admin center doesn't show as a workstream;
// - proactive: a proactive outbound workstream (for example missed-call callbacks);
// - other: direct inbound/outbound, or no workstream.
export type Kind = "inbound" | "outbound" | "proactive" | "other";

export const KIND_LABELS: Record<Kind, string> = {
  inbound: "Inbound workstream",
  outbound: "Outbound profile",
  proactive: "Proactive outbound",
  other: "Other"
};

export const KIND_PLURALS: Record<Kind, string> = {
  inbound: "Inbound workstreams",
  outbound: "Outbound profiles",
  proactive: "Proactive outbound workstreams",
  other: "Other voice channels"
};

// Whether a kind places calls out, and so uses an outbound-enabled number and a caller ID.
export const isOutbound = (kind: Kind): boolean => kind === "outbound" || kind === "proactive";

// A phone number synced into the environment (msdyn_ocphonenumber).
export interface PhoneNumber {
  id: string;
  number: string;
  active: boolean;
  inbound: boolean;
  outbound: boolean;
}

// One voice channel (msdyn_ocvoicechannelsetting) with the number it uses and, for an outbound
// channel, its caller ID number.
export interface ChannelRow {
  id: string;
  name: string;
  workstreamId?: string;
  workstreamName: string;
  kind: Kind;
  active: boolean;
  numberId?: string;
  callerIdId?: string;
}

// The numbers on a channel: undefined is "no number".
export interface Numbers {
  numberId?: string;
  callerIdId?: string;
}

// A change the admin asks for on one channel. numberId: the new number (null: no number).
// callerIdId: an explicit new caller ID (used by revert); otherwise, on an outbound channel, the
// caller ID follows the number when callerIdFollows is on, and is left as it is when it's off.
export interface Edit {
  numberId: string | null;
  callerIdFollows?: boolean;
  callerIdId?: string | null;
}

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  channelId: string;
  message: string;
}

export interface PlannedChange {
  channel: ChannelRow;
  before: Numbers;
  after: Numbers;
  // Which of the two lookups change.
  number: boolean;
  callerId: boolean;
}

export interface Plan {
  changes: PlannedChange[];
  issues: Issue[];
}

// One update sent to Dataverse. A value of null clears the lookup; a missing key isn't written.
// temporary: a channel's number is cleared first, to free it for another inbound channel in a swap;
// the channel gets its new number in a later step.
export interface Step {
  change: PlannedChange;
  set: { numberId?: string | null; callerIdId?: string | null };
  temporary?: boolean;
}

export type ApplyStatus = "updated" | "failed" | "skipped" | "notVerified";

export interface ApplyResult {
  change: PlannedChange;
  status: ApplyStatus;
  error?: string;
  // What was read back afterwards.
  readBack?: Numbers;
  at?: string;
}
