// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { parseCsv } from "../src/csv";
import { templateCsv } from "../src/template";
import { normalizePhoneNumber, validateCsv } from "../src/validate";

function validate(lines: string[]) {
  return validateCsv(parseCsv(lines.join("\n")));
}

const errors = (plan: ReturnType<typeof validate>) => plan.issues.filter((i) => i.severity === "error");
const warnings = (plan: ReturnType<typeof validate>) => plan.issues.filter((i) => i.severity === "warning");

describe("validateCsv", () => {
  test("the example is valid and groups rows into workstreams with their channels", () => {
    const plan = validateCsv(parseCsv(templateCsv()));
    expect(errors(plan)).toEqual([]);
    expect(plan.workstreams.map((w) => [w.name, w.channels.length])).toEqual([["Sales – Voice", 3], ["Support – Voice", 1], ["Claims – Voice", 1], ["Callbacks – Outbound", 1], ["Escalations – Voice", 0]]);
    const [sales, support, claims] = plan.workstreams;
    expect(sales.presences).toEqual(["Available", "Busy"]);
    expect(sales.channels[0].phoneNumber).toBe("+31201234567");
    expect(sales.channels[1].phoneNumber).toBeUndefined();
    expect(sales.channels.map((c) => c.recording.capture)).toEqual(["transcriptAndRecording", "transcript", "transcript"]);
    expect(support.channels[0].recording).toMatchObject({ capture: "transcriptAndRecording", start: "manual", stopOnHold: true });
    expect(claims).toMatchObject({ capacityFormat: "Unit", capacityUnits: 50, channels: [{ recording: { capture: "none" } }] });
  });

  test("the three transcript/recording options and the start mode", () => {
    const plan = validate(["workstream_name,channel_name,language,transcript_recording,transcript_recording_start", "WS,A,en-US,none,", "WS,B,en-US,transcript,manual", "WS,C,en-US,Transcript and Recording,Automatic", "WS,D,en-US,Recording,"]);
    expect(plan.workstreams[0].channels.map((c) => [c.recording.capture, c.recording.start])).toEqual([["none", "automatic"], ["transcript", "manual"], ["transcriptAndRecording", "automatic"], ["none", "automatic"]]);
    expect(errors(plan)[0]).toMatchObject({ line: 5, column: "transcript_recording" });
    expect(errors(plan)[0].message).toMatch(/Use one of: None, Transcript, Transcript and Recording/);
  });

  test("a manual start with None is flagged as unused", () => {
    const plan = validate(["workstream_name,channel_name,language,transcript_recording,transcript_recording_start", "WS,A,en-US,None,Manual"]);
    expect(warnings(plan).map((w) => w.column)).toContain("transcript_recording_start");
  });

  test("applies defaults for blank cells", () => {
    const plan = validate(["workstream_name,channel_name,language", "WS,Ch,en-US"]);
    const ws = plan.workstreams[0];
    expect(ws).toMatchObject({ direction: "Inbound", workDistribution: "Push", capacityFormat: "Profile", capacityUnits: 30, presences: ["Available"], notification: "Screen pop with timeout", agentAffinity: false });
    expect(ws.channels[0]).toMatchObject({ voiceSpeed: 0, voicePitch: 0, pstnTransferControls: true, recording: { capture: "none", start: "automatic", agentRecordingControls: true } });
  });

  test("accepts header variants and case-insensitive values", () => {
    const plan = validate(["Workstream Name,DIRECTION,Channel-Name,language,Transcript Recording,agent_affinity", "WS,outbound,Ch,en-US,TRANSCRIPT,yes"]);
    expect(errors(plan)).toEqual([]);
    expect(plan.workstreams[0]).toMatchObject({ direction: "Outbound", agentAffinity: true });
    expect(plan.workstreams[0].channels[0].recording.capture).toBe("transcript");
  });

  test("a row with no channel columns creates a workstream without a channel, with a warning", () => {
    const plan = validate(["workstream_name,default_queue,channel_name,language", "Lonely,Q,,"]);
    expect(plan.workstreams[0].channels).toEqual([]);
    expect(errors(plan)).toEqual([]);
    expect(warnings(plan).map((w) => w.message).join()).toMatch(/has no voice channel/);
  });

  test("a channel without its required columns is an error that names the fix", () => {
    const plan = validate(["workstream_name,channel_name,language,tts_voice", "WS,,,en-US-AvaMultilingualNeural"]);
    expect(errors(plan).map((e) => e.column)).toEqual(["channel_name", "language"]);
    expect(errors(plan)[0].message).toMatch(/leave every channel column on this row blank/);
  });

  test("later rows may leave workstream columns blank, but may not contradict the first row", () => {
    const plan = validate([
      "workstream_name,direction,default_queue,channel_name,language",
      "WS,Inbound,Main,A,en-US",
      "ws,,,B,en-US",
      "WS,Inbound,main,C,en-US",
      "WS,Outbound,,D,en-US"
    ]);
    expect(plan.workstreams).toHaveLength(1);
    expect(plan.workstreams[0].channels.map((c) => c.name)).toEqual(["A", "B", "C", "D"]);
    expect(errors(plan)).toHaveLength(1);
    expect(errors(plan)[0]).toMatchObject({ line: 5, column: "direction" });
    expect(errors(plan)[0].message).toMatch(/line 2/);
  });

  test("rejects invalid choices, numbers, yes/no values and presences", () => {
    const plan = validate(["workstream_name,direction,capacity_units,agent_affinity,allowed_presences", "WS,Sideways,lots,maybe,Available|Sleeping"]);
    expect(errors(plan).map((e) => e.column)).toEqual(["direction", "capacity_units", "allowed_presences", "agent_affinity"]);
  });

  test("phone numbers are normalized and must be E.164", () => {
    expect(normalizePhoneNumber("+31 (0)20-123 45 67")).toBe("+31201234567");
    const plan = validate(["workstream_name,channel_name,language,phone_number", "WS,A,en-US,+31 20 123 45 67", "WS,B,en-US,020 1234567"]);
    expect(plan.workstreams[0].channels[0].phoneNumber).toBe("+31201234567");
    expect(errors(plan)).toHaveLength(1);
    expect(errors(plan)[0]).toMatchObject({ line: 3, column: "phone_number" });
  });

  test("duplicate channel names are errors; a shared number is only a warning", () => {
    const plan = validate(["workstream_name,channel_name,language,phone_number", "WS,A,en-US,+31201234567", "WS2,a,en-US,+31201234567"]);
    expect(errors(plan).map((e) => e.column)).toEqual(["channel_name"]);
    expect(warnings(plan).some((w) => w.column === "phone_number")).toBe(true);
  });

  test("warns about a voice that doesn't match the language, except multilingual voices", () => {
    const plan = validate(["workstream_name,channel_name,language,tts_voice", "WS,A,nl-NL,en-US-JennyNeural", "WS,B,nl-NL,en-US-AvaMultilingualNeural", "WS,C,nl-NL,nl-NL-FennaNeural"]);
    expect(warnings(plan).filter((w) => w.column === "tts_voice").map((w) => w.line)).toEqual([2]);
  });

  test("warns about settings that won't be used", () => {
    const plan = validate(["workstream_name,direction,outbound_queue,capacity_format,capacity_profile,default_queue", "WS,Inbound,Q,Unit,P,F"]);
    expect(warnings(plan).map((w) => w.column).sort()).toEqual(["capacity_profile", "outbound_queue"]);
  });

  test("file-level problems", () => {
    expect(errors(validate(["name,other", "x,y"]))[0].message).toMatch(/no workstream_name column/);
    expect(errors(validate(["workstream_name"]))[0].message).toMatch(/no rows/);
    const plan = validate(["workstream_name,surprise", "WS,1"]);
    expect(warnings(plan)[0].message).toMatch(/Ignored column not in the template: surprise/);
    expect(errors(validate(["workstream_name,direction,Direction", "WS,Inbound,Inbound"]))[0].message).toMatch(/listed twice: direction/);
    expect(errors(validate(["workstream_name,channel_name", ",A"]))[0]).toMatchObject({ line: 2, column: "workstream_name" });
  });
});
