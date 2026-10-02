// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "./csv";
import { CAPACITY_FORMAT, DIRECTIONS, NOTIFICATION, PRESENCES, WORK_DISTRIBUTION } from "./voiceSchema";

// The CSV contract: one row per voice channel. Rows with the same workstream_name make up one
// workstream, so a workstream with three channels is three rows. Workstream columns only need to be
// filled in on the first row of a workstream; on later rows they may be left blank, and if they are
// filled in they must agree. A row with no channel columns creates a workstream without a channel.
//
// This list drives the downloadable template, validation and the README's column reference.

export type ColumnKind = "text" | "integer" | "yesno" | "choice" | "list" | "phone" | "reference";
export type ColumnLevel = "workstream" | "channel";

export interface ColumnDef {
  header: string;
  level: ColumnLevel;
  kind: ColumnKind;
  required?: boolean;           // for channel columns: required when the row has a channel
  choices?: readonly string[];
  defaultValue?: string;        // shown in the reference; applied when the cell is blank
  description: string;
}

const YES_NO = ["Yes", "No"] as const;
export const CAPTURE_CHOICES = ["None", "Transcript", "Transcript and Recording"] as const;
export const START_CHOICES = ["Automatic", "Manual"] as const;

export const COLUMNS: ColumnDef[] = [
  // --- workstream ------------------------------------------------------------------------------
  { header: "workstream_name", level: "workstream", kind: "text", required: true, description: "Name of the voice workstream. Rows with the same name belong to the same workstream. Must not exist in the environment yet." },
  { header: "direction", level: "workstream", kind: "choice", choices: Object.keys(DIRECTIONS), defaultValue: "Inbound", description: "Inbound or Outbound calling." },
  { header: "work_distribution", level: "workstream", kind: "choice", choices: Object.keys(WORK_DISTRIBUTION), defaultValue: "Push", description: "Push assigns calls to agents; Pick lets agents pick them." },
  { header: "capacity_format", level: "workstream", kind: "choice", choices: Object.keys(CAPACITY_FORMAT), defaultValue: "Profile", description: "Profile (capacity profile, the admin center default for voice) or Unit (capacity units)." },
  { header: "capacity_profile", level: "workstream", kind: "reference", description: "Capacity profile name or unique name, for Profile capacity. Blank uses the admin center default: Default voice inbound, or Default voice outbound for Outbound." },
  { header: "capacity_units", level: "workstream", kind: "integer", defaultValue: "30", description: "Units a call consumes, for Unit capacity. Stored but not used for Profile capacity." },
  { header: "allowed_presences", level: "workstream", kind: "list", choices: Object.keys(PRESENCES), defaultValue: "Available", description: "Presences in which agents can receive calls, separated by |, e.g. Available|Busy." },
  { header: "default_queue", level: "workstream", kind: "reference", description: "Fallback queue name, used when routing finds no queue. Recommended for inbound." },
  { header: "outbound_queue", level: "workstream", kind: "reference", description: "Queue name for outbound workstreams. Ignored for Inbound." },
  { header: "notification", level: "workstream", kind: "choice", choices: Object.keys(NOTIFICATION), defaultValue: "Screen pop with timeout", description: "How an agent is notified of a new call." },
  { header: "agent_affinity", level: "workstream", kind: "yesno", choices: YES_NO, defaultValue: "No", description: "Route returning callers to the agent who handled them before." },
  { header: "restrict_recording_download", level: "workstream", kind: "yesno", choices: YES_NO, defaultValue: "No", description: "Stop agents and supervisors downloading call recordings." },
  { header: "restrict_transcript_download", level: "workstream", kind: "yesno", choices: YES_NO, defaultValue: "No", description: "Stop agents and supervisors downloading transcripts." },

  // --- voice channel -----------------------------------------------------------------------------
  { header: "channel_name", level: "channel", kind: "text", required: true, description: "Name of the voice channel. Leave the whole channel part blank to create the workstream without a channel." },
  { header: "phone_number", level: "channel", kind: "phone", description: "Phone number in E.164 format, e.g. +31201234567. It must already exist in the environment. Leave blank to create the channel without a number and assign one later." },
  { header: "language", level: "channel", kind: "reference", required: true, description: "Primary language as a locale code, e.g. en-US or nl-NL." },
  { header: "tts_voice", level: "channel", kind: "text", description: "Azure text-to-speech voice name, e.g. en-US-AvaMultilingualNeural or nl-NL-FennaNeural." },
  { header: "voice_style", level: "channel", kind: "text", description: "Speaking style of the voice, where the voice supports styles. Usually blank." },
  { header: "voice_speed", level: "channel", kind: "integer", defaultValue: "0", description: "Speaking speed adjustment; 0 is the voice's normal speed." },
  { header: "voice_pitch", level: "channel", kind: "integer", defaultValue: "0", description: "Pitch adjustment; 0 is the voice's normal pitch." },
  { header: "hold_music", level: "channel", kind: "reference", description: "Hold music name, e.g. Transform. Blank leaves it unset." },
  { header: "wait_music", level: "channel", kind: "reference", description: "Wait music name, e.g. Transform. Blank leaves it unset." },
  { header: "operating_hours", level: "channel", kind: "reference", description: "Operating hours record name. Blank means the channel is always open." },
  { header: "transcript_recording", level: "channel", kind: "choice", choices: CAPTURE_CHOICES, defaultValue: "None", description: "None, Transcript, or Transcript and Recording." },
  { header: "transcript_recording_start", level: "channel", kind: "choice", choices: START_CHOICES, defaultValue: "Automatic", description: "Automatic (starts when the call connects) or Manual (the agent starts it). Only used when transcript_recording isn’t None." },
  { header: "agent_transcription_controls", level: "channel", kind: "yesno", choices: YES_NO, defaultValue: "Yes", description: "Agents can pause and resume transcription." },
  { header: "agent_recording_controls", level: "channel", kind: "yesno", choices: YES_NO, defaultValue: "Yes", description: "Agents can pause and resume recording." },
  { header: "request_recording_consent", level: "channel", kind: "yesno", choices: YES_NO, defaultValue: "No", description: "Ask the caller for consent before recording." },
  { header: "stop_recording_on_hold", level: "channel", kind: "yesno", choices: YES_NO, defaultValue: "No", description: "Pause recording and transcription while the caller is on hold." },
  { header: "play_recording_notifications", level: "channel", kind: "yesno", choices: YES_NO, defaultValue: "No", description: "Play a notification to the caller when recording or transcription starts." },
  { header: "show_transcript_by_default", level: "channel", kind: "yesno", choices: YES_NO, defaultValue: "No", description: "Show the live transcript to the agent by default." },
  { header: "pstn_transfer_controls", level: "channel", kind: "yesno", choices: YES_NO, defaultValue: "Yes", description: "Agents get transfer controls for external phone-number participants." },
  { header: "teams_transfer_controls", level: "channel", kind: "yesno", choices: YES_NO, defaultValue: "Yes", description: "Agents get transfer controls for Teams participants." }
];

export const COLUMN_BY_HEADER = new Map(COLUMNS.map((c) => [c.header, c]));
export const CHANNEL_HEADERS = COLUMNS.filter((c) => c.level === "channel").map((c) => c.header);
export const WORKSTREAM_HEADERS = COLUMNS.filter((c) => c.level === "workstream").map((c) => c.header);

// "Workstream Name", "workstream-name" and "WORKSTREAM_NAME" all mean workstream_name.
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// The example file offered in the Upload step (and kept in examples/ in the repo). It shows every shape
// the tool supports: several channels on one workstream, channels without a phone number yet, all three
// transcript/recording options with automatic and manual start, an outbound workstream, unit capacity,
// and a workstream without a channel. Every name in it exists in the sample environment.
const EXAMPLE_ROWS: Record<string, string>[] = [
  { workstream_name: "Sales – Voice", direction: "Inbound", work_distribution: "Push", capacity_format: "Profile", allowed_presences: "Available|Busy", default_queue: "Sales Fallback", notification: "Screen pop with timeout",
    channel_name: "Sales – NL", phone_number: "+31201234567", language: "nl-NL", tts_voice: "nl-NL-FennaNeural", hold_music: "Transform", wait_music: "Transform", operating_hours: "Workdays",
    transcript_recording: "Transcript and Recording", transcript_recording_start: "Automatic", request_recording_consent: "Yes" },
  { workstream_name: "Sales – Voice", channel_name: "Sales – EN", language: "en-US", tts_voice: "en-US-AvaMultilingualNeural", hold_music: "Transform", wait_music: "Transform", operating_hours: "Workdays", transcript_recording: "Transcript" },
  { workstream_name: "Sales – Voice", channel_name: "Sales – BE", language: "nl-BE", tts_voice: "nl-BE-DenaNeural", hold_music: "Transform", wait_music: "Transform", operating_hours: "Workdays", transcript_recording: "Transcript" },
  { workstream_name: "Support – Voice", direction: "Inbound", default_queue: "Support Fallback", agent_affinity: "Yes",
    channel_name: "Support line", phone_number: "+31201234568", language: "en-GB", tts_voice: "en-GB-SoniaNeural", hold_music: "Anthem", wait_music: "Parallel", operating_hours: "24/7",
    transcript_recording: "Transcript and Recording", transcript_recording_start: "Manual", stop_recording_on_hold: "Yes", agent_recording_controls: "Yes", agent_transcription_controls: "Yes" },
  { workstream_name: "Claims – Voice", direction: "Inbound", capacity_format: "Unit", capacity_units: "50", default_queue: "Claims Fallback", restrict_recording_download: "Yes",
    channel_name: "Claims hotline", language: "de-DE", tts_voice: "de-DE-KatjaNeural", transcript_recording: "None" },
  { workstream_name: "Callbacks – Outbound", direction: "Outbound", outbound_queue: "Callbacks",
    channel_name: "Callbacks outbound", phone_number: "+18005550100", language: "en-US", transcript_recording: "Transcript", transcript_recording_start: "Automatic" },
  { workstream_name: "Escalations – Voice", direction: "Inbound", default_queue: "Escalations" }
];

export const EXAMPLE_FILE_NAME = "voice-workstreams-example.csv";

export function templateCsv(): string {
  const headers = COLUMNS.map((c) => c.header);
  return toCsv(headers, EXAMPLE_ROWS.map((row) => headers.map((h) => row[h] ?? "")));
}

export function emptyTemplateCsv(): string {
  return toCsv(COLUMNS.map((c) => c.header), []);
}
