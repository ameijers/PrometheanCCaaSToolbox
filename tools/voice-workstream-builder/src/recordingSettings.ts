// Recording and transcription settings of a voice channel (msdyn_ocvoicechannelsetting). Shared by
// Voice Workstream Builder (settings for new channels) and Recording & Transcription Provisioner
// (bulk changes to existing ones), so both tools write exactly the same columns the same way.
//
// The admin chooses one of three options: None, Transcript, or Transcript and Recording. In Dataverse
// each capability is a pair — a boolean `…enabled` column and a `…mode` multi-select option set
// (None / Manual / Automatic) — so one option always writes all four columns together. Whether capture
// starts automatically or the agent starts it is a separate setting, written to the mode of whichever
// capability is switched on.

export type Capture = "none" | "transcript" | "transcriptAndRecording";
// What can be read back: an environment may hold recording switched on without transcription, which
// isn't one of the options. It's shown as-is and replaced by whichever option is applied.
export type ReadCapture = Capture | "recordingOnly";

export const CAPTURE_OPTIONS: Capture[] = ["none", "transcript", "transcriptAndRecording"];

export const CAPTURE_LABELS: Record<ReadCapture, string> = {
  none: "None",
  transcript: "Transcript",
  transcriptAndRecording: "Transcript and Recording",
  recordingOnly: "Recording without transcript"
};

export type StartMode = "automatic" | "manual";
export const START_MODES: StartMode[] = ["automatic", "manual"];
export const START_LABELS: Record<StartMode, string> = { automatic: "Automatic", manual: "Manual" };

// msdyn_recordingmode / msdyn_transcriptionmode option values (identical option sets).
const MODE_NONE = "192351000";
const MODE_VALUE: Record<StartMode, string> = { manual: "192351001", automatic: "192351002" };

export interface RecordingSettings {
  capture: ReadCapture;
  start: StartMode;
  // "Allow agents to pause and resume" for each capability.
  agentTranscriptionControls: boolean;
  agentRecordingControls: boolean;
  requestConsent: boolean;
  stopOnHold: boolean;
  playNotifications: boolean;
  showTranscriptByDefault: boolean;
}

// A change or a new channel's settings: only the three options can be written.
export type WritableSettings = Omit<RecordingSettings, "capture"> & { capture: Capture };

export type RecordingField = keyof RecordingSettings;

export const RECORDING_FIELDS: RecordingField[] = [
  "capture", "start", "agentTranscriptionControls", "agentRecordingControls",
  "requestConsent", "stopOnHold", "playNotifications", "showTranscriptByDefault"
];

export const RECORDING_FIELD_LABELS: Record<RecordingField, string> = {
  capture: "Transcript and recording",
  start: "Start",
  agentTranscriptionControls: "Agents can pause/resume transcription",
  agentRecordingControls: "Agents can pause/resume recording",
  requestConsent: "Ask the caller for recording consent",
  stopOnHold: "Stop recording and transcription on hold",
  playNotifications: "Play recording/transcription notifications",
  showTranscriptByDefault: "Show live transcript to agents by default"
};

const BOOLEAN_COLUMNS: Record<Exclude<RecordingField, "capture" | "start">, string> = {
  agentTranscriptionControls: "msdyn_agenttranscriptioncontrolsenabled",
  agentRecordingControls: "msdyn_agentrecordingcontrolsenabled",
  requestConsent: "msdyn_requestuserconsentforrecording",
  stopOnHold: "msdyn_enablestoprecordingtranscriptiononhold",
  playNotifications: "msdyn_playrecordingtranscriptionnotifications",
  showTranscriptByDefault: "msdyn_transcriptionshowbydefault"
};

const CAPTURE_COLUMNS = ["msdyn_transcriptionenabled", "msdyn_transcriptionmode", "msdyn_recordingenabled", "msdyn_recordingmode"];

// Every column this module can write — the allowlist the provisioner's update path enforces.
export const RECORDING_COLUMNS: string[] = [...CAPTURE_COLUMNS, ...Object.values(BOOLEAN_COLUMNS)];

export const DEFAULT_RECORDING_SETTINGS: WritableSettings = {
  capture: "none",
  start: "automatic",
  agentTranscriptionControls: true,
  agentRecordingControls: true,
  requestConsent: false,
  stopOnHold: false,
  playNotifications: false,
  showTranscriptByDefault: false
};

// Dataverse columns for the given (possibly partial) settings. Only the fields present are written, so
// a bulk change of one option never touches the others. The option and its start mode always go
// together (all four capture columns), so a channel can't end up half switched. "recordingOnly" is
// accepted only so a revert can put back exactly what was there; it's never offered as a choice.
export function recordingColumns(settings: Partial<RecordingSettings>): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  if (settings.capture === undefined && settings.start !== undefined) throw new Error("A start mode is written together with the transcript/recording option.");
  if (settings.capture !== undefined) {
    const mode = MODE_VALUE[settings.start ?? "automatic"];
    const transcribe = settings.capture === "transcript" || settings.capture === "transcriptAndRecording";
    const record = settings.capture === "transcriptAndRecording" || settings.capture === "recordingOnly";
    columns.msdyn_transcriptionenabled = transcribe;
    columns.msdyn_transcriptionmode = transcribe ? mode : MODE_NONE;
    columns.msdyn_recordingenabled = record;
    columns.msdyn_recordingmode = record ? mode : MODE_NONE;
  }
  (Object.keys(BOOLEAN_COLUMNS) as (keyof typeof BOOLEAN_COLUMNS)[]).forEach((field) => {
    if (settings[field] !== undefined) columns[BOOLEAN_COLUMNS[field]] = settings[field];
  });
  return columns;
}

// A multi-select comes back as a comma-separated string of values. Enabled with no mode recorded
// reads as automatic, the admin center's default.
function readStart(mode: unknown): StartMode {
  const values = typeof mode === "string" ? mode.split(",").map((v) => v.trim()) : typeof mode === "number" ? [String(mode)] : [];
  if (values.includes(MODE_VALUE.automatic)) return "automatic";
  if (values.includes(MODE_VALUE.manual)) return "manual";
  return "automatic";
}

export function readRecordingSettings(row: Record<string, unknown>): RecordingSettings {
  const transcribe = row.msdyn_transcriptionenabled === true;
  const record = row.msdyn_recordingenabled === true;
  const capture: ReadCapture = transcribe ? (record ? "transcriptAndRecording" : "transcript") : record ? "recordingOnly" : "none";
  // With nothing switched on the start mode means nothing; it reads as the default so it never shows
  // up as a difference.
  const start = transcribe ? readStart(row.msdyn_transcriptionmode) : record ? readStart(row.msdyn_recordingmode) : "automatic";
  return {
    capture,
    start,
    agentTranscriptionControls: row[BOOLEAN_COLUMNS.agentTranscriptionControls] === true,
    agentRecordingControls: row[BOOLEAN_COLUMNS.agentRecordingControls] === true,
    requestConsent: row[BOOLEAN_COLUMNS.requestConsent] === true,
    stopOnHold: row[BOOLEAN_COLUMNS.stopOnHold] === true,
    playNotifications: row[BOOLEAN_COLUMNS.playNotifications] === true,
    showTranscriptByDefault: row[BOOLEAN_COLUMNS.showTranscriptByDefault] === true
  };
}

export function describeCapture(settings: Pick<RecordingSettings, "capture" | "start">): string {
  const label = CAPTURE_LABELS[settings.capture];
  return settings.capture === "none" || settings.capture === "recordingOnly" ? label : `${label} (${START_LABELS[settings.start].toLowerCase()})`;
}

export function sameSettings(a: RecordingSettings, b: RecordingSettings): boolean {
  return RECORDING_FIELDS.every((f) => a[f] === b[f]);
}
