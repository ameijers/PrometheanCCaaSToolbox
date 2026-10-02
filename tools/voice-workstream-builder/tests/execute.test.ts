// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { parseCsv } from "../src/csv";
import { BuilderSource, CreatableTable } from "../src/dataSource";
import { executePlan } from "../src/execute";
import { Catalog } from "../src/model";
import { demoSource, resetDemo } from "../src/demoData";
import { resolvePlan } from "../src/resolve";
import { validateCsv } from "../src/validate";

// A recording source over the demo catalog: logs every create in order and can be told to fail one.
function recordingSource(catalog: Catalog, failOn?: (table: CreatableTable, payload: Record<string, unknown>) => boolean, routing: { count: number | undefined } = { count: 1 }) {
  const created: { table: CreatableTable; payload: Record<string, unknown>; id: string }[] = [];
  const source: BuilderSource = {
    mode: "demo",
    loadCatalog: async () => catalog,
    create: async (table, payload) => {
      if (failOn?.(table, payload)) throw new Error("The phone number is already provisioned elsewhere.");
      const id = `${table}-${created.length + 1}`;
      created.push({ table, payload, id });
      return id;
    },
    countRoutingConfigurations: async () => routing.count,
    recordUrl: () => undefined,
    currentUser: () => "Test user"
  };
  return { source, created };
}

const CSV = [
  "workstream_name,default_queue,channel_name,language,tts_voice,phone_number",
  "Sales,Sales Fallback,Sales NL,nl-NL,nl-NL-FennaNeural,+31201234567",
  "Sales,,Sales EN,en-US,,",
  "Support,Callbacks,Support line,en-US,en-US-AvaMultilingualNeural,"
].join("\n");

async function plan() {
  resetDemo();
  const catalog = await demoSource.loadCatalog();
  return { catalog, plan: resolvePlan(validateCsv(parseCsv(CSV)), catalog) };
}

describe("executePlan", () => {
  test("creates records in dependency order, wiring each to the ids created before it", async () => {
    const { catalog, plan: p } = await plan();
    const { source, created } = recordingSource(catalog);
    const results = await executePlan(p, source);

    expect(created.map((c) => c.table)).toEqual([
      "workstream", "capacityLink", "channel", "ttsVoice", "languageSetting", "channel", "languageSetting",
      "workstream", "capacityLink", "channel", "ttsVoice", "languageSetting"
    ]);
    expect(created[1].payload["msdyn_workstream_id@odata.bind"]).toBe("/msdyn_liveworkstreams(workstream-1)");
    expect(created[2].payload["msdyn_liveworkstreamid@odata.bind"]).toBe("/msdyn_liveworkstreams(workstream-1)");
    expect(created[4].payload["msdyn_ocvoicechannelsettingid@odata.bind"]).toBe("/msdyn_ocvoicechannelsettings(channel-3)");
    expect(created[4].payload["msdyn_ocvoiceid@odata.bind"]).toBe("/msdyn_ocvoices(ttsVoice-4)");
    // The second channel has no voice: its language setting must not borrow the first channel's.
    expect(created[6].payload).not.toHaveProperty("msdyn_ocvoiceid@odata.bind");
    expect(created[9].payload["msdyn_liveworkstreamid@odata.bind"]).toBe("/msdyn_liveworkstreams(workstream-8)");

    expect(results.map((r) => r.outcome)).toEqual(["created", "created"]);
    expect(results[0].notes).toEqual(['"Sales EN" has no phone number yet. Assign one in the admin center when it\'s available.']);
  });

  test("a failure stops that workstream only, reports what exists, and skips the rest of it", async () => {
    const { catalog, plan: p } = await plan();
    const { source, created } = recordingSource(catalog, (table, payload) => table === "channel" && payload.msdyn_name === "Sales NL");
    const progress: number[] = [];
    const results = await executePlan(p, source, (pr) => progress.push(pr.done));

    expect(results[0].outcome).toBe("partial");
    expect(results[0].steps.map((s) => s.status)).toEqual(["created", "created", "failed", "skipped", "skipped", "skipped", "skipped"]);
    expect(results[0].steps[2].error).toMatch(/already provisioned/);
    expect(results[0].notes[0]).toMatch(/records marked Created exist/);
    expect(results[1].outcome).toBe("created");
    expect(created.filter((c) => c.table === "workstream")).toHaveLength(2);
    expect(progress[progress.length - 1]).toBe(12);
  });

  test("a failed workstream create is reported as failed with nothing created", async () => {
    const { catalog, plan: p } = await plan();
    const { source } = recordingSource(catalog, (table, payload) => table === "workstream" && payload.msdyn_name === "Support");
    const results = await executePlan(p, source);
    expect(results[1].outcome).toBe("failed");
    expect(results[1].steps.every((s) => s.status !== "created")).toBe(true);
    expect(results[1].notes).toEqual([]);
  });

  test("says when a workstream has no routing rules yet, or when it could not check", async () => {
    const { catalog, plan: p } = await plan();
    expect((await executePlan(p, recordingSource(catalog, undefined, { count: 0 }).source))[1].notes[0]).toMatch(/No routing rules yet/);
    expect((await executePlan(p, recordingSource(catalog, undefined, { count: undefined }).source))[1].notes[0]).toMatch(/Couldn't check/);
  });

  test("the demo source remembers what it created, so a second run hits the duplicate check", async () => {
    const { plan: p } = await plan();
    await executePlan(p, demoSource);
    const again = resolvePlan(validateCsv(parseCsv(CSV)), await demoSource.loadCatalog());
    expect(again.issues.filter((i) => i.severity === "error" && i.column === "workstream_name")).toHaveLength(2);
  });
});
