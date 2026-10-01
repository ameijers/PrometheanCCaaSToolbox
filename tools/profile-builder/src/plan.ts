import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { Catalog, ChannelSpec, Issue, ParsedPlan, ResolvedPlan, WorkstreamSpec } from "../../voice-workstream-builder/src/model";
import { Capture, StartMode } from "../../voice-workstream-builder/src/recordingSettings";
import { resolvePlan } from "../../voice-workstream-builder/src/resolve";
import { normalizePhoneNumber } from "../../voice-workstream-builder/src/validate";
import { Presence } from "../../voice-workstream-builder/src/voiceSchema";
import { COLUMN_BY_HEADER, normalizeHeader } from "./template";

// An outbound profile is stored exactly like an outbound voice workstream with one voice channel
// (see IMPLEMENTATION_STATUS.md). So each CSV row becomes one WorkstreamSpec with one ChannelSpec,
// and Voice Workstream Builder's verified resolution, payloads and create engine do the rest. This
// file only adds what's specific to profiles: the CSV columns, the required number and queue, the
// caller ID, and stricter number checks.

const CAPTURE_BY_LABEL: Record<string, Capture> = { "none": "none", "transcript": "transcript", "transcript and recording": "transcriptAndRecording" };
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

export function validateProfiles(csv: ParsedCsv): ParsedPlan {
  const issues: Issue[] = [];
  const headers = csv.headers.map(normalizeHeader);
  if (!headers.includes("profile_name")) {
    issues.push({ severity: "error", message: "The file has no profile_name column. Start from the example: its first line must be the column headers." });
    return { workstreams: [], issues, rowCount: csv.records.length };
  }
  const unknown = csv.headers.filter((h, i) => h && !COLUMN_BY_HEADER.has(headers[i]));
  if (unknown.length) issues.push({ severity: "warning", message: `Ignored column${unknown.length > 1 ? "s" : ""} not in the template: ${unknown.join(", ")}.` });
  const duplicated = headers.filter((h, i) => h && headers.indexOf(h) !== i);
  if (duplicated.length) issues.push({ severity: "error", message: `Column${duplicated.length > 1 ? "s" : ""} listed twice: ${[...new Set(duplicated)].join(", ")}.` });

  const seen = new Map<string, number>();
  const workstreams: WorkstreamSpec[] = [];

  csv.records.forEach(({ line, cells }) => {
    const cell = (h: string) => { const i = headers.indexOf(h); return i >= 0 ? (cells[i] ?? "").trim() : ""; };
    const name = cell("profile_name");
    const error = (column: string | undefined, message: string) => issues.push({ severity: "error", line, column, workstream: name || undefined, message });
    const warning = (column: string | undefined, message: string) => issues.push({ severity: "warning", line, column, workstream: name || undefined, message });
    const value = (h: string) => cell(h) || COLUMN_BY_HEADER.get(h)?.defaultValue || "";
    const choice = (h: string): string => {
      const def = COLUMN_BY_HEADER.get(h)!;
      const v = value(h);
      const match = def.choices?.find((c) => c.toLowerCase() === v.toLowerCase());
      if (!match) { error(h, `"${v}" isn't a valid ${h}. Use one of: ${def.choices?.join(", ")}.`); return def.defaultValue ?? ""; }
      return match;
    };
    const yes = (h: string) => choice(h) === "Yes";

    if (!name) { error("profile_name", "profile_name is empty. Every row needs the name of the profile to create."); return; }
    if (seen.has(name.toLowerCase())) error("profile_name", `"${name}" is also on line ${seen.get(name.toLowerCase())}. Each row creates one profile, so names must be unique.`);
    else seen.set(name.toLowerCase(), line);

    const type = cell("profile_type");
    if (type && type.toLowerCase() === "inbound") error("profile_type", "Inbound profiles aren't supported yet. Create them in the admin center for now.");
    else choice("profile_type");

    const number = (h: string, required: boolean): string | undefined => {
      const raw = cell(h);
      if (!raw) { if (required) error(h, `${h} is required. Every profile needs a phone number.`); return undefined; }
      const n = normalizePhoneNumber(raw);
      if (!PHONE_PATTERN.test(n)) { error(h, `"${raw}" isn't an E.164 phone number (+ country code and number, e.g. +31201234567).`); return undefined; }
      return n;
    };
    const phoneNumber = number("phone_number", true);
    const callerIdNumber = number("caller_id_number", false) ?? phoneNumber;

    const outboundQueue = cell("outbound_queue");
    if (!outboundQueue) error("outbound_queue", "outbound_queue is required: it's the queue outbound calls from this profile are placed in.");

    const presences: Presence[] = [];
    value("allowed_presences").split(/[|;,]/).map((p) => p.trim()).filter(Boolean).forEach((p) => {
      const match = COLUMN_BY_HEADER.get("allowed_presences")!.choices!.find((c) => c.toLowerCase() === p.toLowerCase());
      if (match) { if (!presences.includes(match as Presence)) presences.push(match as Presence); }
      else error("allowed_presences", `"${p}" isn't a valid presence. Use any of: ${COLUMN_BY_HEADER.get("allowed_presences")!.choices!.join(", ")}, separated by |.`);
    });

    const anonymous = yes("anonymous_caller_id");
    const callerIdName = cell("caller_id_name") || undefined;
    if (anonymous && callerIdName) warning("caller_id_name", "anonymous_caller_id is Yes, so the caller ID name isn't shown.");
    if (anonymous && cell("caller_id_number")) warning("caller_id_number", "anonymous_caller_id is Yes, so the caller ID number isn't shown.");

    const capture = CAPTURE_BY_LABEL[choice("transcript_recording").toLowerCase()];
    const start = choice("transcript_recording_start").toLowerCase() as StartMode;
    if (capture === "none" && cell("transcript_recording_start").toLowerCase() === "manual") warning("transcript_recording_start", "transcript_recording is None, so the start setting isn’t used.");

    const channel: ChannelSpec = {
      line,
      name,
      phoneNumber,
      language: value("language"),
      voiceSpeed: 0,
      voicePitch: 0,
      holdMusic: cell("hold_music") || undefined,
      waitMusic: cell("wait_music") || undefined,
      recording: {
        capture, start,
        agentTranscriptionControls: yes("agent_transcription_controls"),
        agentRecordingControls: yes("agent_recording_controls"),
        requestConsent: yes("request_recording_consent"),
        stopOnHold: yes("stop_recording_on_hold"),
        playNotifications: yes("play_recording_notifications"),
        showTranscriptByDefault: yes("show_transcript_by_default")
      },
      pstnTransferControls: yes("pstn_transfer_controls"),
      teamsTransferControls: yes("teams_transfer_controls"),
      outbound: { callerIdNumber, callerIdName, anonymousCallerId: anonymous }
    };

    // The rest is what the admin center wrote on its outbound profile: push distribution, profile-based
    // capacity (30, unused for profiles), screen pop with timeout, no affinity, downloads not restricted.
    workstreams.push({
      key: name.toLowerCase(), name, lines: [line],
      direction: "Outbound", workDistribution: "Push", capacityFormat: "Profile",
      capacityProfile: cell("capacity_profile") || undefined, capacityUnits: 30, presences,
      outboundQueue: outboundQueue || undefined, notification: "Screen pop with timeout",
      agentAffinity: false, restrictRecordingDownload: false, restrictTranscriptDownload: false,
      channels: [channel]
    });
  });

  if (!csv.records.length) issues.push({ severity: "error", message: "The file has a header line but no rows." });
  return { workstreams, issues, rowCount: csv.records.length };
}

// Voice Workstream Builder's resolution, made stricter for profiles: a profile's number must be
// enabled for outbound calling (an error, not a warning), and a number already used by an inbound
// channel is normal for an outbound profile, so that warning is dropped.
export function resolveProfiles(parsed: ParsedPlan, catalog: Catalog): ResolvedPlan {
  const resolved = resolvePlan(parsed, catalog);
  const issues = resolved.issues
    .filter((i) => !(i.column === "phone_number" && /is already used by/.test(i.message)))
    .map((i) => i.column === "phone_number" && /isn't enabled for outbound calling/.test(i.message)
      ? { ...i, severity: "error" as const, message: `${i.message} An outbound profile can't place calls from it.` }
      : i)
    .map((i) => i.column === "workstream_name" ? { ...i, column: "profile_name", message: i.message.replace("A workstream named", "A profile or workstream named").replace("only creates new workstreams", "only creates new profiles") } : i)
    .map((i) => i.column === "channel_name" ? { ...i, column: "profile_name" } : i);
  return { ...resolved, issues };
}
