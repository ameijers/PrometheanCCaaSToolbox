import { WritableSettings } from "./recordingSettings";
import { CapacityFormat, Direction, Notification, Presence, TableKey, WorkDistribution } from "./voiceSchema";

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  message: string;
  line?: number;      // CSV line the issue belongs to
  column?: string;    // CSV header
  workstream?: string;
}

// One workstream from the CSV, after parsing and defaults. `lines` lists every CSV line that belongs
// to it (its channels, or a single workstream-only line).
export interface WorkstreamSpec {
  key: string;
  name: string;
  lines: number[];
  direction: Direction;
  workDistribution: WorkDistribution;
  capacityFormat: CapacityFormat;
  capacityProfile?: string;
  capacityUnits: number;
  presences: Presence[];
  defaultQueue?: string;
  outboundQueue?: string;
  notification: Notification;
  agentAffinity: boolean;
  restrictRecordingDownload: boolean;
  restrictTranscriptDownload: boolean;
  channels: ChannelSpec[];
}

export interface ChannelSpec {
  line: number;
  name: string;
  phoneNumber?: string;     // normalized (+ and digits only); undefined = created without a number
  language: string;         // locale code, e.g. en-US
  ttsVoice?: string;
  voiceStyle?: string;
  voiceSpeed: number;
  voicePitch: number;
  holdMusic?: string;
  waitMusic?: string;
  operatingHours?: string;
  recording: WritableSettings;
  pstnTransferControls: boolean;
  teamsTransferControls: boolean;
  // Outbound calling: the number customers see and how it's shown. Set by Profile Builder; Voice
  // Workstream Builder's CSV doesn't use it, so its channels leave these columns empty.
  outbound?: OutboundSettings;
}

export interface OutboundSettings {
  callerIdNumber?: string;  // normalized; must be an existing number
  callerIdName?: string;
  anonymousCallerId: boolean;
}

export interface ParsedPlan {
  workstreams: WorkstreamSpec[];
  issues: Issue[];
  rowCount: number;
}

// What the environment already holds, read once before review so every name in the CSV can be
// resolved to a record (and duplicates caught) before anything is written.
export interface NamedRecord { id: string; name: string; }

export interface PhoneNumberRecord {
  id: string;
  number: string;           // normalized
  active: boolean;
  inbound: boolean;
  outbound: boolean;
}

export interface Catalog {
  queues: NamedRecord[];
  capacityProfiles: (NamedRecord & { uniqueName?: string })[];
  operatingHours: NamedRecord[];
  phoneNumbers: PhoneNumberRecord[];
  languages: (NamedRecord & { localeCode: string })[];
  music: NamedRecord[];
  workstreams: NamedRecord[];
  channels: (NamedRecord & { phoneNumberId?: string; workstreamName?: string })[];
}

export interface ResolvedChannel extends ChannelSpec {
  refs: {
    phoneNumber?: string;
    callerIdNumber?: string;
    language?: NamedRecord & { localeCode: string };
    holdMusic?: string;
    waitMusic?: string;
    operatingHours?: string;
  };
}

export interface ResolvedWorkstream extends Omit<WorkstreamSpec, "channels"> {
  refs: {
    defaultQueue?: string;
    outboundQueue?: string;
    capacityProfile?: NamedRecord;
  };
  channels: ResolvedChannel[];
}

export interface ResolvedPlan {
  workstreams: ResolvedWorkstream[];
  issues: Issue[];
  rowCount: number;
}

export function errorCount(issues: Issue[]): number {
  return issues.filter((i) => i.severity === "error").length;
}

export function recordCount(plan: ResolvedPlan): { workstreams: number; channels: number; records: number } {
  let records = 0;
  let channels = 0;
  plan.workstreams.forEach((ws) => {
    records += 1 + (ws.capacityFormat === "Profile" ? 1 : 0);
    ws.channels.forEach((ch) => { channels++; records += 2 + (ch.ttsVoice ? 1 : 0); });
  });
  return { workstreams: plan.workstreams.length, channels, records };
}

// --- execution results -----------------------------------------------------------------------------

export type StepStatus = "created" | "failed" | "skipped";

export interface StepResult {
  table: TableKey;
  label: string;   // "Workstream", "Voice channel", …
  name: string;
  status: StepStatus;
  id?: string;
  error?: string;
  at?: string;     // ISO time the record was created or failed
}

export type WorkstreamOutcome = "created" | "partial" | "failed";

export interface WorkstreamResult {
  name: string;
  outcome: WorkstreamOutcome;
  steps: StepResult[];
  notes: string[];
}
