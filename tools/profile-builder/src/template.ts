// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { toCsv } from "../../voice-workstream-builder/src/csv";
import { PRESENCES } from "../../voice-workstream-builder/src/voiceSchema";

// The CSV contract: one row per outbound profile. Defaults follow the outbound profile the admin center
// created in the reference environment ("Contoso Default Outbound Profile"). This list drives the
// example file, validation and the in-app column reference.

export interface ColumnDef {
  header: string;
  required?: boolean;
  choices?: readonly string[];
  defaultValue?: string;
  description: string;
}

const YES_NO = ["Yes", "No"] as const;
export const CAPTURE_CHOICES = ["None", "Transcript", "Transcript and Recording"] as const;
export const PROFILE_TYPES = ["Outbound"] as const;

export const COLUMNS: ColumnDef[] = [
  // --- profile -----------------------------------------------------------------------------------
  { header: "profile_name", required: true, description: "Name of the outbound profile. Must not exist in the environment yet (as a profile or any other workstream)." },
  { header: "profile_type", choices: PROFILE_TYPES, defaultValue: "Outbound", description: "Outbound. Inbound profiles aren't supported yet." },
  { header: "phone_number", required: true, description: "The profile's phone number in E.164 format, e.g. +31201234567. Must exist in the environment and be enabled for outbound calling." },
  // --- outbound information ------------------------------------------------------------------------
  { header: "outbound_queue", required: true, description: "Queue the outbound calls are placed in, by name." },
  { header: "caller_id_number", description: "Number the customer sees. Empty uses the profile's phone_number. Must be one of your own numbers." },
  { header: "caller_id_name", description: "Name the customer sees, where the carrier shows names. Empty sends no name." },
  { header: "anonymous_caller_id", choices: YES_NO, defaultValue: "No", description: "Yes hides the caller ID from the customer." },
  { header: "capacity_profile", description: "Capacity profile name or unique name. Empty uses the admin center default: Default voice outbound." },
  { header: "allowed_presences", choices: Object.keys(PRESENCES), defaultValue: "Available|Busy", description: "Presences in which agents can use the profile, separated by |." },
  { header: "language", defaultValue: "en-US", description: "Primary language as a locale code, e.g. en-US or nl-NL." },
  { header: "hold_music", description: "Hold music name, e.g. Transform. Empty leaves it unset." },
  { header: "wait_music", description: "Wait music name, e.g. Transform. Empty leaves it unset." },
  // --- behaviors -----------------------------------------------------------------------------------
  { header: "transcript_recording", choices: CAPTURE_CHOICES, defaultValue: "None", description: "None, Transcript, or Transcript and Recording." },
  { header: "transcript_recording_start", choices: ["Automatic", "Manual"], defaultValue: "Automatic", description: "Automatic (starts when the call connects) or Manual (the agent starts it). Only used when transcript_recording isn’t None." },
  { header: "agent_transcription_controls", choices: YES_NO, defaultValue: "Yes", description: "Agents can pause and resume transcription." },
  { header: "agent_recording_controls", choices: YES_NO, defaultValue: "Yes", description: "Agents can pause and resume recording." },
  { header: "request_recording_consent", choices: YES_NO, defaultValue: "No", description: "Ask the customer for consent before recording." },
  { header: "stop_recording_on_hold", choices: YES_NO, defaultValue: "No", description: "Pause recording and transcription while the customer is on hold." },
  { header: "play_recording_notifications", choices: YES_NO, defaultValue: "No", description: "Play a notification to the customer when recording or transcription starts." },
  { header: "show_transcript_by_default", choices: YES_NO, defaultValue: "No", description: "Show the live transcript to the agent by default." },
  { header: "pstn_transfer_controls", choices: YES_NO, defaultValue: "Yes", description: "Agents get transfer controls for external phone-number participants." },
  { header: "teams_transfer_controls", choices: YES_NO, defaultValue: "Yes", description: "Agents get transfer controls for Teams participants." }
];

export const COLUMN_BY_HEADER = new Map(COLUMNS.map((c) => [c.header, c]));

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// Every name in the example exists in the sample environment.
const EXAMPLE_ROWS: Record<string, string>[] = [
  { profile_name: "Sales – Outbound", profile_type: "Outbound", phone_number: "+31201234567", outbound_queue: "Sales Fallback", caller_id_name: "Contoso Sales", language: "nl-NL", hold_music: "Transform", wait_music: "Transform", transcript_recording: "Transcript and Recording", transcript_recording_start: "Automatic", request_recording_consent: "Yes" },
  { profile_name: "Callbacks – Outbound", profile_type: "Outbound", phone_number: "+18005550100", outbound_queue: "Callbacks", language: "en-US", transcript_recording: "Transcript" },
  { profile_name: "Support – Outbound", phone_number: "+31201234568", outbound_queue: "Support Fallback", caller_id_number: "+31201234567", language: "en-GB", hold_music: "Anthem", wait_music: "Anthem", transcript_recording: "Transcript and Recording", transcript_recording_start: "Manual", stop_recording_on_hold: "Yes" },
  { profile_name: "Escalations – Outbound (hidden number)", phone_number: "+31201234568", outbound_queue: "Escalations", anonymous_caller_id: "Yes", capacity_profile: "Escalation profile", allowed_presences: "Available|Busy|Busy - DND" }
];

export const EXAMPLE_FILE_NAME = "outbound-profiles-example.csv";

export function exampleCsv(): string {
  const headers = COLUMNS.map((c) => c.header);
  return toCsv(headers, EXAMPLE_ROWS.map((row) => headers.map((h) => row[h] ?? "")));
}

export function emptyTemplateCsv(): string {
  return toCsv(COLUMNS.map((c) => c.header), []);
}
