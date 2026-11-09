// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "../../voice-workstream-builder/src/csv";
import { COLUMNS as BUILDER_COLUMNS, ColumnDef } from "../../voice-workstream-builder/src/template";

// The CSV contract: one row per new voice channel, naming the existing workstream it's added to. The
// channel columns are exactly Voice Workstream Builder's (same names, defaults and checks), so a file
// written for one tool reads the same in the other. This list drives the example file, validation and
// the in-app column reference.

export const WORKSTREAM_COLUMN: ColumnDef = {
  header: "workstream_name", level: "workstream", kind: "reference", required: true,
  description: "Name of an existing, active inbound voice workstream. The channel is added to it. Rows with the same name add several channels to one workstream."
};

// The builder's channel_name text mentions creating a workstream without a channel, which this tool can't.
const OWN_DESCRIPTIONS: Record<string, string> = {
  channel_name: "Name of the new voice channel. Must be unique in the file; a name that already exists in the environment is a warning."
};
export const CHANNEL_COLUMNS: ColumnDef[] = BUILDER_COLUMNS.filter((c) => c.level === "channel")
  .map((c) => (OWN_DESCRIPTIONS[c.header] ? { ...c, description: OWN_DESCRIPTIONS[c.header] } : c));
export const COLUMNS: ColumnDef[] = [WORKSTREAM_COLUMN, ...CHANNEL_COLUMNS];
export const COLUMN_BY_HEADER = new Map(COLUMNS.map((c) => [c.header, c]));

export { normalizeHeader } from "../../voice-workstream-builder/src/template";

// Every name in the example exists in the sample environment: two channels on one workstream (one with
// a number, one without), and one on another workstream, without a number.
const EXAMPLE_ROWS: Record<string, string>[] = [
  { workstream_name: "Contoso Voice", channel_name: "Contoso Voice – NL", phone_number: "+31201234568", language: "nl-NL", tts_voice: "nl-NL-FennaNeural",
    hold_music: "Transform", wait_music: "Transform", operating_hours: "Workdays", transcript_recording: "Transcript and Recording", transcript_recording_start: "Automatic", request_recording_consent: "Yes", bridged_transfer_pstn: "Yes" },
  { workstream_name: "Contoso Voice", channel_name: "Contoso Voice – EN", language: "en-US", tts_voice: "en-US-AvaMultilingualNeural",
    hold_music: "Transform", wait_music: "Transform", operating_hours: "Workdays", transcript_recording: "Transcript" },
  { workstream_name: "Contoso Voice Sales", channel_name: "Contoso Voice Sales – BE", language: "nl-BE", tts_voice: "nl-BE-DenaNeural", operating_hours: "24/7", transcript_recording: "None" }
];

export const EXAMPLE_FILE_NAME = "voice-channels-example.csv";

export function exampleCsv(): string {
  const headers = COLUMNS.map((c) => c.header);
  return toCsv(headers, EXAMPLE_ROWS.map((row) => headers.map((h) => row[h] ?? "")));
}

export function emptyTemplateCsv(): string {
  return toCsv(COLUMNS.map((c) => c.header), []);
}
