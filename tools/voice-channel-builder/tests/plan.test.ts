// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { BuilderSource, CreatableTable } from "../../voice-workstream-builder/src/dataSource";
import { demoSource, resetDemo } from "../../voice-workstream-builder/src/demoData";
import { Catalog } from "../../voice-workstream-builder/src/model";
import { addChannels, existingChannelCount, resolveChannelPlan, validateChannels } from "../src/plan";
import { EXAMPLE_FILE_NAME, exampleCsv } from "../src/template";

const WS_VOICE = "00000000-0000-4000-8000-000000000080";

let catalog: Catalog;
beforeEach(async () => {
  resetDemo();
  catalog = await demoSource.loadCatalog();
});

const plan = (lines: string[]) => resolveChannelPlan(validateChannels(parseCsv(lines.join("\n"))), catalog);
const errors = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "error").map((i) => i.message);
const HEAD = "workstream_name,channel_name,phone_number,language,tts_voice";

// A source that records what would be created, and refuses anything but channel records.
function recorder(): { source: BuilderSource; creates: { table: CreatableTable; payload: Record<string, unknown> }[] } {
  const creates: { table: CreatableTable; payload: Record<string, unknown> }[] = [];
  let n = 0;
  return {
    creates,
    source: {
      ...demoSource,
      async create(table, payload) { creates.push({ table, payload }); return `00000000-0000-4000-8000-${String(5000 + n++).padStart(12, "0")}`; },
      async countRoutingConfigurations() { throw new Error("An existing workstream mustn't be checked for routing."); }
    }
  };
}

describe("Voice Channel Builder: checks", () => {
  test("the example resolves cleanly against the sample environment", () => {
    const p = resolveChannelPlan(validateChannels(parseCsv(exampleCsv())), catalog);
    expect(p.issues).toEqual([]);
    expect(p.workstreams.map((w) => [w.name, w.existingId, w.channels.map((c) => [c.name, c.phoneNumber ?? null])])).toEqual([
      ["Contoso Voice", WS_VOICE, [["Contoso Voice – NL", "+31201234568"], ["Contoso Voice – EN", null]]],
      ["Contoso Voice Sales", "00000000-0000-4000-8000-000000000081", [["Contoso Voice Sales – BE", null]]]
    ]);
  });

  test("the copy in examples/ is exactly what the Upload step offers", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../examples", EXAMPLE_FILE_NAME), "utf8")).toBe(exampleCsv());
  });

  test("the workstream must exist, be voice, active and inbound", () => {
    const p = plan([HEAD,
      "Nope,Ch 1,,en-US,en-US-AvaMultilingualNeural",
      "Contoso Default Outbound Profile,Ch 2,,en-US,en-US-AvaMultilingualNeural",
      "Contoso Chat,Ch 3,,en-US,en-US-AvaMultilingualNeural",
      "Contoso Voice (old),Ch 4,,en-US,en-US-AvaMultilingualNeural"]);
    expect(errors(p)).toEqual([
      expect.stringContaining("No workstream named \"Nope\""),
      expect.stringContaining("is an outbound profile"),
      expect.stringContaining("isn't a voice workstream"),
      expect.stringContaining("is deactivated")
    ]);
    expect(p.workstreams.every((w) => !w.existingId)).toBe(true);
  });

  test("names match case-insensitively; several rows add several channels to one workstream", () => {
    const p = plan([HEAD, "contoso voice,A,,en-US,en-US-AvaMultilingualNeural", "CONTOSO VOICE,B,,en-US,en-US-AvaMultilingualNeural"]);
    expect(p.issues).toEqual([]);
    expect(p.workstreams).toHaveLength(1);
    expect(p.workstreams[0].channels.map((c) => c.name)).toEqual(["A", "B"]);
  });

  test("channel columns are checked as in Voice Workstream Builder", () => {
    const p = plan([HEAD, "Contoso Voice,,,en-US,", "Contoso Voice,X,+3120,en-US,en-US-AvaMultilingualNeural", "Contoso Voice,Y,+31207654321,xx-XX,", "Contoso Voice,Y,,en-US,en-US-AvaMultilingualNeural"]);
    const messages = errors(p).join("\n");
    expect(messages).toMatch(/channel_name is required/);
    expect(messages).toMatch(/isn't an E.164 phone number/);
    expect(messages).toMatch(/\+31207654321 is deactivated/);
    expect(messages).toMatch(/"xx-XX" isn't a language/);
    expect(messages).toMatch(/Channel "Y" is also on line 4/);
  });

  test("a number already used by another channel, or an existing channel name, is a warning", () => {
    const p = plan([HEAD, "Contoso Voice,Contoso Voice Sales,+13159956114,en-US,en-US-AvaMultilingualNeural"]);
    expect(errors(p)).toEqual([]);
    const warnings = p.issues.filter((i) => i.severity === "warning").map((i) => i.message);
    expect(warnings).toHaveLength(2);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("+13159956114 is already used by \"Contoso Voice Channel\""),
      expect.stringContaining("A voice channel named \"Contoso Voice Sales\" already exists")
    ]));
  });

  test("missing columns and empty files are reported", () => {
    expect(errors(plan(["channel_name,language", "A,en-US"]))[0]).toMatch(/no workstream_name column/);
    expect(errors(plan([HEAD]))[0]).toMatch(/no rows/);
  });

  test("the review shows how many channels a workstream has now", () => {
    expect(existingChannelCount(catalog, "contoso voice")).toBe(1);
  });
});

describe("Voice Channel Builder: creating", () => {
  test("only channels, voices and language settings are created, on the existing workstream", async () => {
    const p = resolveChannelPlan(validateChannels(parseCsv(exampleCsv())), catalog);
    const { source, creates } = recorder();
    const results = await addChannels(p, source);
    expect([...new Set(creates.map((c) => c.table))].sort()).toEqual(["channel", "languageSetting", "ttsVoice"]);
    const channels = creates.filter((c) => c.table === "channel").map((c) => c.payload);
    expect(channels).toHaveLength(3);
    expect(channels[0]).toMatchObject({ msdyn_name: "Contoso Voice – NL", "msdyn_liveworkstreamid@odata.bind": `/msdyn_liveworkstreams(${WS_VOICE})`, "msdyn_phonenumberid@odata.bind": expect.any(String) });
    expect(channels[1]["msdyn_phonenumberid@odata.bind"]).toBeUndefined();
    expect(results.map((r) => r.outcome)).toEqual(["created", "created"]);
    expect(results[0].steps.some((s) => s.table === "workstream")).toBe(false);
    expect(results[0].notes).toEqual(["\"Contoso Voice – EN\" has no phone number yet. Assign one in the admin center when it's available."]);
  });

  test("refuses to run when a workstream isn't an existing one, so it can never create a workstream", async () => {
    const p = plan([HEAD, "Brand new,A,,en-US,en-US-AvaMultilingualNeural"]);
    const { source, creates } = recorder();
    await expect(addChannels(p, source)).rejects.toThrow(/Not an existing workstream: Brand new/);
    expect(creates).toEqual([]);
  });

  test("a failure stops that workstream, with what was already created", async () => {
    const p = resolveChannelPlan(validateChannels(parseCsv(exampleCsv())), catalog);
    const { source } = recorder();
    let calls = 0;
    const failing: BuilderSource = { ...source, async create(table, payload) { if (++calls === 2) throw new Error("Locked."); return source.create(table, payload); } };
    const results = await addChannels(p, failing);
    expect(results[0].outcome).toBe("partial");
    expect(results[0].steps.map((s) => s.status)).toEqual(["created", "failed", "skipped", "skipped", "skipped", "skipped"]);
    expect(results[0].notes[0]).toMatch(/finish the channel in the admin center/);
    expect(results[1].outcome).toBe("created");
  });
});
