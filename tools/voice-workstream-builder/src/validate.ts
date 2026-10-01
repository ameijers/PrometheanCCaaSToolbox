import { ParsedCsv } from "./csv";
import { ChannelSpec, Issue, ParsedPlan, WorkstreamSpec } from "./model";
import { Capture, StartMode, WritableSettings } from "./recordingSettings";
import { CHANNEL_HEADERS, COLUMN_BY_HEADER, ColumnDef, WORKSTREAM_HEADERS, normalizeHeader } from "./template";
import { CapacityFormat, Direction, Notification, Presence, WorkDistribution } from "./voiceSchema";

// Turns a parsed CSV into workstream/channel specs plus every problem found, without looking at the
// environment. Names that point at existing records (queues, numbers, languages, …) are checked
// afterwards by resolve.ts against what the environment actually holds.

type Row = { line: number; values: Map<string, string> };

// "+31 (0)20-123 45 67" → "+310201234567" is wrong, so "(0)" is dropped first: it's the trunk prefix
// people write for domestic dialling and never part of an E.164 number.
export function normalizePhoneNumber(raw: string): string {
  return raw.replace(/\(0\)/g, "").replace(/[\s\-().]/g, "");
}

const CAPTURE_BY_LABEL: Record<string, Capture> = { "None": "none", "Transcript": "transcript", "Transcript and Recording": "transcriptAndRecording" };

const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

class RowReader {
  constructor(private row: Row, private issues: Issue[], private workstream?: string) {}

  raw(header: string): string {
    return this.row.values.get(header) ?? "";
  }

  has(header: string): boolean {
    return this.raw(header) !== "";
  }

  private problem(header: string, message: string) {
    this.issues.push({ severity: "error", line: this.row.line, column: header, workstream: this.workstream, message });
  }

  private def(header: string): ColumnDef {
    const def = COLUMN_BY_HEADER.get(header);
    if (!def) throw new Error(`Unknown column ${header}`);
    return def;
  }

  text(header: string): string | undefined {
    return this.raw(header) || undefined;
  }

  choice<T extends string>(header: string): T {
    const def = this.def(header);
    const value = this.raw(header) || def.defaultValue || "";
    const match = def.choices?.find((c) => c.toLowerCase() === value.toLowerCase());
    if (!match) {
      this.problem(header, `"${value}" isn't a valid ${header}. Use one of: ${def.choices?.join(", ")}.`);
      return (def.defaultValue ?? def.choices?.[0]) as T;
    }
    return match as T;
  }

  yesNo(header: string): boolean {
    const def = this.def(header);
    const value = (this.raw(header) || def.defaultValue || "").toLowerCase();
    if (["yes", "y", "true", "1"].includes(value)) return true;
    if (["no", "n", "false", "0"].includes(value)) return false;
    this.problem(header, `"${this.raw(header)}" isn't Yes or No.`);
    return def.defaultValue === "Yes";
  }

  integer(header: string): number {
    const def = this.def(header);
    const value = this.raw(header) || def.defaultValue || "0";
    if (!/^-?\d+$/.test(value)) {
      this.problem(header, `"${value}" isn't a whole number.`);
      return Number(def.defaultValue ?? 0);
    }
    return Number(value);
  }

  list<T extends string>(header: string): T[] {
    const def = this.def(header);
    const value = this.raw(header) || def.defaultValue || "";
    const items = value.split(/[|;,]/).map((v) => v.trim()).filter(Boolean);
    const matched: T[] = [];
    items.forEach((item) => {
      const match = def.choices?.find((c) => c.toLowerCase() === item.toLowerCase());
      if (match) { if (!matched.includes(match as T)) matched.push(match as T); } else this.problem(header, `"${item}" isn't a valid value. Use any of: ${def.choices?.join(", ")}, separated by |.`);
    });
    if (!matched.length && !items.length) this.problem(header, "At least one value is needed.");
    return matched;
  }
}

function readWorkstream(row: Row, issues: Issue[], name: string): Omit<WorkstreamSpec, "channels" | "lines" | "key"> {
  const r = new RowReader(row, issues, name);
  const direction = r.choice<Direction>("direction");
  const capacityFormat = r.choice<CapacityFormat>("capacity_format");
  return {
    name,
    direction,
    workDistribution: r.choice<WorkDistribution>("work_distribution"),
    capacityFormat,
    capacityProfile: r.text("capacity_profile"),
    capacityUnits: r.integer("capacity_units"),
    presences: r.list<Presence>("allowed_presences"),
    defaultQueue: r.text("default_queue"),
    outboundQueue: r.text("outbound_queue"),
    notification: r.choice<Notification>("notification"),
    agentAffinity: r.yesNo("agent_affinity"),
    restrictRecordingDownload: r.yesNo("restrict_recording_download"),
    restrictTranscriptDownload: r.yesNo("restrict_transcript_download")
  };
}

function readChannel(row: Row, issues: Issue[], workstream: string, direction: Direction): ChannelSpec | undefined {
  const r = new RowReader(row, issues, workstream);
  const push = (severity: Issue["severity"], column: string | undefined, message: string) => issues.push({ severity, line: row.line, column, workstream, message });

  const missing = CHANNEL_HEADERS.filter((h) => COLUMN_BY_HEADER.get(h)?.required && !r.has(h));
  if (missing.length) {
    missing.forEach((h) => push("error", h, `${h} is required for a voice channel. To create "${workstream}" without a channel, leave every channel column on this row blank.`));
    return undefined;
  }

  let phoneNumber: string | undefined;
  if (r.has("phone_number")) {
    phoneNumber = normalizePhoneNumber(r.raw("phone_number"));
    if (!PHONE_PATTERN.test(phoneNumber)) push("error", "phone_number", `"${r.raw("phone_number")}" isn't an E.164 phone number (+ country code and number, e.g. +31201234567).`);
  }

  const capture = CAPTURE_BY_LABEL[r.choice<string>("transcript_recording")];
  const start = r.choice<string>("transcript_recording_start").toLowerCase() as StartMode;
  if (capture === "none" && r.has("transcript_recording_start") && start === "manual") push("warning", "transcript_recording_start", "transcript_recording is None, so the start setting isn’t used.");
  const recording: WritableSettings = {
    capture,
    start,
    agentTranscriptionControls: r.yesNo("agent_transcription_controls"),
    agentRecordingControls: r.yesNo("agent_recording_controls"),
    requestConsent: r.yesNo("request_recording_consent"),
    stopOnHold: r.yesNo("stop_recording_on_hold"),
    playNotifications: r.yesNo("play_recording_notifications"),
    showTranscriptByDefault: r.yesNo("show_transcript_by_default")
  };

  const language = r.raw("language");
  const ttsVoice = r.text("tts_voice");
  if (!ttsVoice && direction === "Inbound") push("warning", "tts_voice", "No text-to-speech voice: automated prompts and messages on this channel have no voice until one is set in the admin center.");
  // Azure voice names start with their locale ("nl-NL-FennaNeural"). Multilingual voices speak other
  // languages too, so a mismatch is only a warning, and not raised for them.
  if (ttsVoice && !/multilingual/i.test(ttsVoice) && !ttsVoice.toLowerCase().startsWith(`${language.toLowerCase()}-`)) {
    push("warning", "tts_voice", `The voice "${ttsVoice}" doesn't look like a ${language} voice. Check it speaks the channel's language.`);
  }

  return {
    line: row.line,
    name: r.raw("channel_name"),
    phoneNumber,
    language,
    ttsVoice,
    voiceStyle: r.text("voice_style"),
    voiceSpeed: r.integer("voice_speed"),
    voicePitch: r.integer("voice_pitch"),
    holdMusic: r.text("hold_music"),
    waitMusic: r.text("wait_music"),
    operatingHours: r.text("operating_hours"),
    recording,
    pstnTransferControls: r.yesNo("pstn_transfer_controls"),
    teamsTransferControls: r.yesNo("teams_transfer_controls")
  };
}

// Record names are matched case-insensitively everywhere, so "sales fallback" on a later row agrees
// with "Sales Fallback" on the first.
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => JSON.stringify(v)?.toLowerCase();
  return norm(a) === norm(b);
}

export function validateCsv(csv: ParsedCsv): ParsedPlan {
  const issues: Issue[] = [];
  const headers = csv.headers.map(normalizeHeader);

  if (!headers.includes("workstream_name")) {
    issues.push({ severity: "error", message: "The file has no workstream_name column. Start from the template: its first line must be the column headers." });
    return { workstreams: [], issues, rowCount: csv.records.length };
  }
  const unknown = csv.headers.filter((h, i) => h && !COLUMN_BY_HEADER.has(headers[i]));
  if (unknown.length) issues.push({ severity: "warning", message: `Ignored column${unknown.length > 1 ? "s" : ""} not in the template: ${unknown.join(", ")}.` });
  const duplicated = headers.filter((h, i) => h && headers.indexOf(h) !== i);
  if (duplicated.length) issues.push({ severity: "error", message: `Column${duplicated.length > 1 ? "s" : ""} listed twice: ${[...new Set(duplicated)].join(", ")}.` });

  const rows: Row[] = csv.records.map((record) => {
    const values = new Map<string, string>();
    headers.forEach((h, i) => { if (COLUMN_BY_HEADER.has(h)) values.set(h, (record.cells[i] ?? "").trim()); });
    return { line: record.line, values };
  });

  const byKey = new Map<string, WorkstreamSpec>();
  const firstLine = new Map<string, number>();
  const channelNames = new Map<string, number>();
  const phoneNumbers = new Map<string, number>();

  rows.forEach((row) => {
    const name = row.values.get("workstream_name") ?? "";
    if (!name) {
      issues.push({ severity: "error", line: row.line, column: "workstream_name", message: "workstream_name is empty. Every row needs the workstream it belongs to." });
      return;
    }
    const key = name.toLowerCase();
    let spec = byKey.get(key);
    if (!spec) {
      spec = { key, lines: [], channels: [], ...readWorkstream(row, issues, name) };
      byKey.set(key, spec);
      firstLine.set(key, row.line);
    } else {
      // A later row of the same workstream: any workstream column it fills in must match the first row.
      const scratch: Issue[] = [];
      const explicit = WORKSTREAM_HEADERS.filter((h) => h !== "workstream_name" && (row.values.get(h) ?? "") !== "");
      if (explicit.length) {
        const again = readWorkstream(row, scratch, name);
        issues.push(...scratch);
        explicit.forEach((h) => {
          const field = FIELD_BY_HEADER[h];
          if (field && !sameValue(again[field], spec![field])) {
            issues.push({ severity: "error", line: row.line, column: h, workstream: name, message: `${h} is "${row.values.get(h)}" here, but line ${firstLine.get(key)} (the first row of "${name}") sets it to "${display(spec![field])}". Workstream settings must agree, or be left blank on later rows.` });
          }
        });
      }
    }
    spec.lines.push(row.line);

    const hasChannel = CHANNEL_HEADERS.some((h) => (row.values.get(h) ?? "") !== "");
    if (!hasChannel) return;
    const channel = readChannel(row, issues, name, spec.direction);
    if (!channel) return;

    const channelKey = channel.name.toLowerCase();
    if (channelNames.has(channelKey)) issues.push({ severity: "error", line: row.line, column: "channel_name", workstream: name, message: `Channel "${channel.name}" is also on line ${channelNames.get(channelKey)}. Channel names must be unique.` });
    else channelNames.set(channelKey, row.line);
    if (channel.phoneNumber) {
      if (phoneNumbers.has(channel.phoneNumber)) issues.push({ severity: "warning", line: row.line, column: "phone_number", workstream: name, message: `${channel.phoneNumber} is also used on line ${phoneNumbers.get(channel.phoneNumber)}. That's allowed (e.g. one inbound and one outbound channel), but check it's intended.` });
      else phoneNumbers.set(channel.phoneNumber, row.line);
    }
    spec.channels.push(channel);
  });

  const workstreams = [...byKey.values()];
  workstreams.forEach((ws) => {
    const at = { line: firstLine.get(ws.key), workstream: ws.name };
    if (!ws.channels.length) issues.push({ severity: "warning", ...at, message: `"${ws.name}" has no voice channel, so it can't take calls yet. Add a channel in the admin center, or add a row with channel columns.` });
    if (ws.direction === "Inbound" && ws.outboundQueue) issues.push({ severity: "warning", ...at, column: "outbound_queue", message: "outbound_queue is only used by Outbound workstreams. It won't be set." });
    if (ws.capacityFormat === "Unit" && ws.capacityProfile) issues.push({ severity: "warning", ...at, column: "capacity_profile", message: "capacity_profile is only used with Profile capacity. It won't be linked." });
    if (ws.capacityUnits < 0) issues.push({ severity: "error", ...at, column: "capacity_units", message: "capacity_units can't be negative." });
    if (ws.direction === "Inbound" && !ws.defaultQueue) issues.push({ severity: "warning", ...at, column: "default_queue", message: "No fallback queue: calls that match no routing rule have nowhere to go." });
  });
  if (!rows.length) issues.push({ severity: "error", message: "The file has a header line but no rows." });

  return { workstreams, issues, rowCount: rows.length };
}

type WorkstreamField = keyof ReturnType<typeof readWorkstream>;

const FIELD_BY_HEADER: Record<string, WorkstreamField> = {
  direction: "direction",
  work_distribution: "workDistribution",
  capacity_format: "capacityFormat",
  capacity_profile: "capacityProfile",
  capacity_units: "capacityUnits",
  allowed_presences: "presences",
  default_queue: "defaultQueue",
  outbound_queue: "outboundQueue",
  notification: "notification",
  agent_affinity: "agentAffinity",
  restrict_recording_download: "restrictRecordingDownload",
  restrict_transcript_download: "restrictTranscriptDownload"
};

function display(value: unknown): string {
  if (Array.isArray(value)) return value.join("|");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value === undefined ? "" : String(value);
}
