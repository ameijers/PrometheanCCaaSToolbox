// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { applySteps } from "../src/apply";
import { NumberSource } from "../src/dataSource";
import { demoSource, resetDemo } from "../src/demoData";
import { ChannelRow, Edit, PhoneNumber } from "../src/model";
import { orderSteps, planChanges, revertEdits } from "../src/plan";

// A source in memory: channels change as the updates come in; failing channels refuse them.
function memorySource(channels: ChannelRow[], numbers: PhoneNumber[], failing: string[] = []): NumberSource & { sent: { id: string; set: object }[] } {
  const sent: { id: string; set: object }[] = [];
  return {
    mode: "demo", sent,
    async load() { return { channels: JSON.parse(JSON.stringify(channels)), numbers }; },
    async setNumbers(id, set) {
      sent.push({ id, set });
      if (failing.includes(id)) throw new Error("Refused");
      const row = channels.find((c) => c.id === id)!;
      if (set.numberId !== undefined) row.numberId = set.numberId ?? undefined;
      if (set.callerIdId !== undefined) row.callerIdId = set.callerIdId ?? undefined;
    },
    recordUrl: () => undefined,
    currentUser: () => "test"
  };
}

const numbers: PhoneNumber[] = ["1", "2", "3"].map((id) => ({ id, number: `+31${id}`, active: true, inbound: true, outbound: true }));
const ch = (id: string, numberId?: string): ChannelRow => ({ id, name: id, workstreamName: id, kind: "inbound", active: true, numberId });

async function run(channels: ChannelRow[], edits: [string, Edit][], failing: string[] = []) {
  const start = JSON.parse(JSON.stringify(channels));
  const source = memorySource(channels, numbers, failing);
  const plan = planChanges(start, numbers, new Map(edits));
  const results = await applySteps(orderSteps(plan, start), start, source);
  return { results, source, channels };
}

describe("applySteps", () => {
  test("a swap ends with both channels on each other's number, confirmed by reading back", async () => {
    const { results, channels } = await run([ch("a", "1"), ch("b", "2")], [["a", { numberId: "2" }], ["b", { numberId: "1" }]]);
    expect(results.map((r) => [r.change.channel.id, r.status])).toEqual([["a", "updated"], ["b", "updated"]]);
    expect(channels.map((c) => c.numberId)).toEqual(["2", "1"]);
  });

  test("if the channel giving a number away fails, the one taking it is skipped, not doubled up", async () => {
    const { results, channels } = await run([ch("a", "1"), ch("b", "2")], [["a", { numberId: "3" }], ["b", { numberId: "1" }]], ["a"]);
    expect(results.find((r) => r.change.channel.id === "a")).toMatchObject({ status: "failed", error: "Refused" });
    expect(results.find((r) => r.change.channel.id === "b")).toMatchObject({ status: "skipped" });
    expect(channels.map((c) => c.numberId)).toEqual(["1", "2"]);
  });

  test("in a swap, a channel whose final update fails says it has no number now", async () => {
    const channels = [ch("a", "1"), ch("b", "2")];
    const source = memorySource(channels, numbers);
    let calls = 0;
    const inner = source.setNumbers;
    source.setNumbers = async (id, set) => { calls += 1; if (calls === 3) throw new Error("Refused"); return inner(id, set); };
    const start = JSON.parse(JSON.stringify(channels));
    const plan = planChanges(start, numbers, new Map([["a", { numberId: "2" }], ["b", { numberId: "1" }]]));
    const results = await applySteps(orderSteps(plan, start), start, source);
    expect(results.find((r) => r.change.channel.id === "a")?.error).toMatch(/no number now/);
  });

  test("the sample: change, then revert puts everything back", async () => {
    resetDemo();
    const before = await demoSource.load();
    const sales = before.channels.find((c) => c.name === "Sales line")!;
    const claims = before.channels.find((c) => c.name === "Claims line")!;
    const free = before.numbers.find((n) => n.number === "+31201234590")!;
    const edits = new Map<string, Edit>([[sales.id, { numberId: free.id }], [claims.id, { numberId: sales.numberId! }]]);
    const plan = planChanges(before.channels, before.numbers, edits);
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
    const results = await applySteps(orderSteps(plan, before.channels), before.channels, demoSource);
    expect(results.every((r) => r.status === "updated")).toBe(true);
    const mid = await demoSource.load();
    const back = planChanges(mid.channels, mid.numbers, revertEdits(results));
    await applySteps(orderSteps(back, mid.channels), mid.channels, demoSource);
    expect((await demoSource.load()).channels).toEqual(before.channels);
  });
});
