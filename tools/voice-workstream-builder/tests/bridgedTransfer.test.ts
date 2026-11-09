// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { parseCsv } from "../src/csv";
import { demoSource, resetDemo } from "../src/demoData";
import { channelPayload } from "../src/payload";
import { resolvePlan } from "../src/resolve";
import { validateCsv } from "../src/validate";
import { resolveChannelPlan, validateChannels } from "../../voice-channel-builder/src/plan";
import { resolveProfiles, validateProfiles } from "../../profile-builder/src/plan";

// Bridged transfer for PSTN and Teams (msdyn_usebridgetransferforpstntransfer / …forteamstransfer): CSV columns
// in all three voice creation tools, default No, and a warning when the matching transfer controls are off.

beforeEach(() => resetDemo());

const PSTN = "msdyn_usebridgetransferforpstntransfer";
const TEAMS = "msdyn_usebridgetransferforteamstransfer";

async function builderChannel(extra: string, values: string) {
  const csv = `workstream_name,channel_name,language,tts_voice${extra}\nNew – Voice,Line,en-US,en-US-AvaMultilingualNeural${values}`;
  const plan = resolvePlan(validateCsv(parseCsv(csv)), await demoSource.loadCatalog());
  return { plan, payload: channelPayload("w1", plan.workstreams[0].channels[0]) };
}

describe("bridged transfer", () => {
  test("defaults to No: both columns written false", async () => {
    const { payload } = await builderChannel("", "");
    expect(payload).toMatchObject({ [PSTN]: false, [TEAMS]: false });
  });

  test("Yes is written true, per kind of external party", async () => {
    const { plan, payload } = await builderChannel(",bridged_transfer_pstn,bridged_transfer_teams", ",Yes,No");
    expect(payload).toMatchObject({ [PSTN]: true, [TEAMS]: false });
    expect(plan.issues.filter((i) => /bridged/.test(i.column ?? ""))).toEqual([]);
  });

  test("Yes with the matching transfer controls off is a warning, not an error", async () => {
    const { plan, payload } = await builderChannel(",pstn_transfer_controls,teams_transfer_controls,bridged_transfer_pstn,bridged_transfer_teams", ",No,No,Yes,Yes");
    expect(payload).toMatchObject({ [PSTN]: true, [TEAMS]: true });
    const bridged = plan.issues.filter((i) => /bridged/.test(i.column ?? ""));
    expect(bridged.map((i) => [i.severity, i.column])).toEqual([["warning", "bridged_transfer_pstn"], ["warning", "bridged_transfer_teams"]]);
  });

  test("an invalid value is an error", async () => {
    const { plan } = await builderChannel(",bridged_transfer_teams", ",Maybe");
    expect(plan.issues.find((i) => i.column === "bridged_transfer_teams")?.severity).toBe("error");
  });

  test("Voice Channel Builder reads the columns", async () => {
    const csv = "workstream_name,channel_name,language,tts_voice,bridged_transfer_pstn,bridged_transfer_teams\nContoso Voice,Line,en-US,en-US-AvaMultilingualNeural,Yes,Yes";
    const plan = resolveChannelPlan(validateChannels(parseCsv(csv)), await demoSource.loadCatalog());
    expect(plan.issues).toEqual([]);
    expect(channelPayload("w1", plan.workstreams[0].channels[0])).toMatchObject({ [PSTN]: true, [TEAMS]: true });
  });

  test("Profile Builder reads the columns, with the same warning", async () => {
    const csv = "profile_name,phone_number,outbound_queue,teams_transfer_controls,bridged_transfer_pstn,bridged_transfer_teams\nP,+31201234567,Callbacks,No,Yes,Yes";
    const plan = resolveProfiles(validateProfiles(parseCsv(csv)), await demoSource.loadCatalog());
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(plan.issues.filter((i) => /bridged/.test(i.column ?? "")).map((i) => i.column)).toEqual(["bridged_transfer_teams"]);
    expect(channelPayload("w1", plan.workstreams[0].channels[0])).toMatchObject({ [PSTN]: true, [TEAMS]: true });
  });
});
