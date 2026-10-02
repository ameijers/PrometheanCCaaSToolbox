// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { applyChanges, columnsFor, revertPlan } from "../src/apply";
import { planChanges } from "../src/change";
import { ProvisionerSource } from "../src/dataSource";
import { demoSource, resetDemo } from "../src/demoData";
import { runLogCsv } from "../src/export";
import { ChannelRow } from "../src/model";
import { parseCsv } from "../../voice-workstream-builder/src/csv";

beforeEach(() => resetDemo());

async function channels(names: string[]): Promise<ChannelRow[]> {
  const all = await demoSource.loadChannels();
  return names.map((n) => all.find((c) => c.name === n)!);
}

describe("applyChanges", () => {
  test("writes only the changed columns of each channel, then confirms them by reading back", async () => {
    const updates: { id: string; columns: Record<string, unknown> }[] = [];
    const spy: ProvisionerSource = { ...demoSource, updateChannel: async (id, columns) => { updates.push({ id, columns }); return demoSource.updateChannel(id, columns); } };
    const plan = planChanges(await channels(["Sales – NL", "Sales – EN", "Billing line"]), { capture: "transcriptAndRecording" });
    const results = await applyChanges(plan, spy);

    // Sales – NL already has it, so it isn't touched at all.
    expect(updates.map((u) => u.id)).toEqual([plan[1].channel.id, plan[2].channel.id]);
    // The option and its start mode always go together, as the four capture columns.
    expect(updates[0].columns).toEqual({ msdyn_transcriptionenabled: true, msdyn_transcriptionmode: "192351002", msdyn_recordingenabled: true, msdyn_recordingmode: "192351002" });
    expect(results.map((r) => r.status)).toEqual(["updated", "updated"]);
    expect((await channels(["Sales – EN", "Billing line"])).every((c) => c.settings.capture === "transcriptAndRecording")).toBe(true);
  });

  test("a manual start is written to the mode of each capability that is on", async () => {
    const [p] = planChanges(await channels(["Billing line"]), { capture: "transcript", start: "manual" });
    expect(columnsFor(p)).toEqual({ msdyn_transcriptionenabled: true, msdyn_transcriptionmode: "192351001", msdyn_recordingenabled: false, msdyn_recordingmode: "192351000" });
  });

  test("changing only another option doesn't touch the capture columns", async () => {
    const [p] = planChanges(await channels(["Sales – NL"]), { requestConsent: true });
    expect(columnsFor(p)).toEqual({ msdyn_requestuserconsentforrecording: true });
  });

  test("one failing channel doesn't stop the rest", async () => {
    const results = await applyChanges(planChanges(await channels(["Legacy callback line", "Billing line"]), { capture: "transcript" }), demoSource);
    expect(results.map((r) => r.status)).toEqual(["failed", "updated"]);
    expect(results[0].error).toMatch(/Simulated failure/);
    expect(results.every((r) => r.at)).toBe(true);
  });

  test("a value the platform didn't keep is reported as not confirmed", async () => {
    const stubborn: ProvisionerSource = { ...demoSource, updateChannel: async () => undefined };
    const [result] = await applyChanges(planChanges(await channels(["Billing line"]), { capture: "transcriptAndRecording" }), stubborn);
    expect(result.status).toBe("notVerified");
    expect(result.error).toMatch(/reads back differently for: capture/);
  });

  test("unchanged channels are never written", async () => {
    let writes = 0;
    const counting: ProvisionerSource = { ...demoSource, updateChannel: async () => { writes++; } };
    expect(await applyChanges(planChanges(await channels(["Sales – NL"]), { capture: "transcriptAndRecording" }), counting)).toEqual([]);
    expect(writes).toBe(0);
  });

  test("revert restores the previous settings exactly, including recording without transcript", async () => {
    const before = await channels(["Sales – EN", "Support line", "Legacy recording line"]);
    expect(before[2].settings.capture).toBe("recordingOnly");
    const results = await applyChanges(planChanges(before, { capture: "none" }), demoSource);
    expect(results.map((r) => r.status)).toEqual(["updated", "updated", "updated"]);
    const reverted = await applyChanges(revertPlan(results), demoSource);
    expect(reverted.map((r) => r.status)).toEqual(["updated", "updated", "updated"]);
    expect((await channels(["Sales – EN", "Support line", "Legacy recording line"])).map((c) => c.settings)).toEqual(before.map((c) => c.settings));
  });
});

describe("run log", () => {
  test("one row per channel with who, where, when, before and after", async () => {
    const results = await applyChanges(planChanges(await channels(["Billing line", "Legacy callback line"]), { capture: "transcript", start: "manual" }), demoSource);
    const csv = parseCsv(runLogCsv(results, { tool: "Recording & Transcription Provisioner", mode: "live", environment: "org.crm4.dynamics.com", user: "Admin", startedAt: "2026-09-30T10:00:00Z", finishedAt: "2026-09-30T10:00:05Z" }, "Apply"));
    expect(csv.headers).toEqual(["Tool", "Environment", "User", "Run started", "Run finished", "Source", "Action", "Workstream", "Channel", "Channel id", "Phone number", "Status", "Before", "After", "Changes", "Time", "Error"]);
    const [billing, legacy] = csv.records.map((r) => Object.fromEntries(csv.headers.map((h, i) => [h, r.cells[i]])));
    expect(billing).toMatchObject({ Environment: "org.crm4.dynamics.com", User: "Admin", Action: "Apply", Channel: "Billing line", Status: "Updated", Before: "None", After: "Transcript (manual)", Changes: "Transcript and recording: None → Transcript | Start: Automatic → Manual" });
    expect(billing.Time).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    expect(legacy).toMatchObject({ Status: "Failed", Error: expect.stringMatching(/Simulated failure/) });
  });
});

describe("demo data", () => {
  test("covers every state, a deactivated channel and a channel without a number", async () => {
    const all = await demoSource.loadChannels();
    expect(new Set(all.map((c) => c.settings.capture))).toEqual(new Set(["none", "transcript", "transcriptAndRecording", "recordingOnly"]));
    expect(all.some((c) => c.settings.start === "manual")).toBe(true);
    expect(all.some((c) => !c.active)).toBe(true);
    expect(all.some((c) => !c.phoneNumber)).toBe(true);
  });
});
