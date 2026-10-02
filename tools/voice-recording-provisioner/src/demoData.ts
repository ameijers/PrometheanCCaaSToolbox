// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { DEFAULT_RECORDING_SETTINGS, WritableSettings, readRecordingSettings, recordingColumns } from "../../voice-workstream-builder/src/recordingSettings";
import { ProvisionerSource } from "./dataSource";
import { ChannelRow } from "./model";

// An in-memory sample environment: channels with each of the three options and both start modes, one
// holding recording without transcript (not an option, as found in some environments), one deactivated
// and one that refuses updates — so the demo shows filtering, the preview, a failure and the revert.
// Channels are stored as raw Dataverse columns and read through the same code as live rows.

type DemoChannel = Omit<ChannelRow, "settings"> & { columns: Record<string, unknown> };

const BOTH: Partial<WritableSettings> = { capture: "transcriptAndRecording" };
const TRANSCRIPT: Partial<WritableSettings> = { capture: "transcript" };
const BOTH_MANUAL: Partial<WritableSettings> = { capture: "transcriptAndRecording", start: "manual" };

function channel(n: number, name: string, workstreamName: string, phoneNumber: string | undefined, settings: Partial<WritableSettings> | Record<string, unknown>, extra: Partial<DemoChannel> = {}): DemoChannel {
  const columns = "msdyn_recordingenabled" in settings ? settings : recordingColumns({ ...DEFAULT_RECORDING_SETTINGS, ...settings });
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name, workstreamName, phoneNumber, direction: "Inbound", active: true, columns, ...extra };
}

// The channel whose updates fail, to show how a failure is reported.
const LOCKED = "Legacy callback line";

const CHANNELS: DemoChannel[] = [
  channel(1, "Sales – NL", "Sales – Voice", "+31201234567", BOTH),
  channel(2, "Sales – EN", "Sales – Voice", "+31201234568", TRANSCRIPT),
  channel(3, "Sales – DE", "Sales – Voice", undefined, {}),
  channel(4, "Support line", "Support – Voice", "+31201234570", BOTH_MANUAL),
  channel(5, "Support – premium", "Support – Voice", "+31201234571", { ...BOTH, requestConsent: true }),
  channel(6, "Support – overflow", "Support – Voice", undefined, TRANSCRIPT),
  channel(7, "Billing line", "Billing – Voice", "+31201234580", {}),
  channel(8, "Billing – business", "Billing – Voice", "+31201234581", {}),
  channel(9, "Claims", "Claims – Voice", "+31201234590", BOTH),
  channel(10, "Claims – after hours", "Claims – Voice", "+31201234591", { ...BOTH, stopOnHold: true }),
  channel(11, "Callbacks outbound", "Callbacks – Outbound", "+31201234599", TRANSCRIPT, { direction: "Outbound" }),
  channel(12, "Missed-call callbacks", "Callbacks – Outbound", "+31201234599", {}, { direction: "Other" }),
  channel(13, LOCKED, "Legacy – Voice", "+31201234500", {}),
  channel(14, "Legacy recording line", "Legacy – Voice", "+31201234501", { msdyn_transcriptionenabled: false, msdyn_transcriptionmode: "192351000", msdyn_recordingenabled: true, msdyn_recordingmode: "192351002" }),
  channel(15, "Old promo line", "Legacy – Voice", undefined, BOTH, { active: false })
];

let channels: DemoChannel[] = JSON.parse(JSON.stringify(CHANNELS));

export function resetDemo(): void {
  channels = JSON.parse(JSON.stringify(CHANNELS));
}

export const demoSource: ProvisionerSource = {
  mode: "demo",
  async loadChannels() {
    return channels.map(({ columns, ...rest }) => ({ ...JSON.parse(JSON.stringify(rest)), settings: readRecordingSettings(columns) }));
  },
  async updateChannel(channelId, columns) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    const row = channels.find((c) => c.id === channelId);
    if (!row) throw new Error("Record not found.");
    if (row.name === LOCKED) throw new Error("Simulated failure (sample environment): the update was rejected.");
    row.columns = { ...row.columns, ...columns };
  },
  recordUrl() {
    return undefined;
  },
  currentUser() {
    return "Sample user";
  }
};
