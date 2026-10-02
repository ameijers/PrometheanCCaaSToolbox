// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { DEFAULT_RECORDING_SETTINGS, RecordingSettings } from "../../voice-workstream-builder/src/recordingSettings";
import { describeChange, describeFieldChange, isEmptyChange, planChanges } from "../src/change";
import { ChannelRow } from "../src/model";

function row(name: string, settings: Partial<RecordingSettings>): ChannelRow {
  return { id: name, name, workstreamName: "WS", direction: "Inbound", active: true, settings: { ...DEFAULT_RECORDING_SETTINGS, ...settings } };
}

const none = row("none", {});
const transcript = row("transcript", { capture: "transcript" });
const both = row("both", { capture: "transcriptAndRecording", requestConsent: true });
const bothManual = row("bothManual", { capture: "transcriptAndRecording", start: "manual" });
const recordingOnly = row("recordingOnly", { capture: "recordingOnly" });

describe("planChanges", () => {
  test("setting an option only changes channels that differ, and only the fields that differ", () => {
    const plan = planChanges([none, transcript, both, bothManual], { capture: "transcriptAndRecording" });
    expect(plan.map((p) => p.status)).toEqual(["change", "change", "noChange", "noChange"]);
    expect(plan[0].changedFields).toEqual(["capture"]);
  });

  test("the start mode is kept unless it's set too", () => {
    const [p] = planChanges([bothManual], { capture: "transcript" });
    expect(p.after).toMatchObject({ capture: "transcript", start: "manual" });
    const [q] = planChanges([bothManual], { capture: "transcript", start: "automatic" });
    expect(q.changedFields).toEqual(["capture", "start"]);
  });

  test("None clears the start mode, which reads back as the default", () => {
    const [p] = planChanges([bothManual], { capture: "none" });
    expect(p.after).toMatchObject({ capture: "none", start: "automatic" });
    expect(p.changedFields).toEqual(["capture", "start"]);
  });

  test("a start mode on a channel with None changes nothing", () => {
    expect(planChanges([none], { start: "manual" })[0].status).toBe("noChange");
  });

  test("options not in the change are kept", () => {
    const [p] = planChanges([both], { capture: "transcript" });
    expect(p.after.requestConsent).toBe(true);
  });

  test("any option replaces recording-without-transcript", () => {
    const plan = planChanges([recordingOnly, recordingOnly], { capture: "transcriptAndRecording" });
    expect(plan[0].status).toBe("change");
    expect(planChanges([recordingOnly], { capture: "none" })[0].status).toBe("change");
  });

  test("a single other option can be set on its own", () => {
    const plan = planChanges([none, both], { stopOnHold: true });
    expect(plan.every((p) => p.status === "change" && p.changedFields.join() === "stopOnHold")).toBe(true);
  });

  test("describing changes", () => {
    expect(isEmptyChange({})).toBe(true);
    expect(describeChange({ capture: "transcriptAndRecording", start: "manual", requestConsent: false })).toEqual(["Transcript and recording: Transcript and Recording", "Start: Manual", "Ask the caller for recording consent: No"]);
    expect(describeFieldChange(planChanges([transcript], { capture: "none" })[0], "capture")).toBe("Transcript and recording: Transcript → None");
  });
});
