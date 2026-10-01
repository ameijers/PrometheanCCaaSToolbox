import { Capture, RecordingField, RecordingSettings, WritableSettings } from "../../voice-workstream-builder/src/recordingSettings";

export type Direction = "Inbound" | "Outbound" | "Other";

// One voice channel (msdyn_ocvoicechannelsetting) with its current recording/transcription settings.
export interface ChannelRow {
  id: string;
  name: string;
  workstreamId?: string;
  workstreamName: string;
  direction: Direction;
  phoneNumber?: string;
  active: boolean;
  settings: RecordingSettings;
}

// The change the admin wants to make: every field present is set on every selected channel; fields
// left out ("Leave unchanged") are never written. Only the three options can be chosen.
export type SettingChange = Partial<Omit<WritableSettings, "capture">> & { capture?: Capture };

export type ChangeStatus = "change" | "noChange";

export interface ChannelChange {
  channel: ChannelRow;
  before: RecordingSettings;
  after: RecordingSettings;
  changedFields: RecordingField[];
  status: ChangeStatus;
}

export type ApplyStatus = "updated" | "failed" | "notVerified";

export interface ApplyResult {
  change: ChannelChange;
  status: ApplyStatus;
  error?: string;
  // What was read back after the update, when a read-back was possible.
  readBack?: RecordingSettings;
  at?: string; // ISO time the update was sent
}
