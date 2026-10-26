// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ChannelRow, Edit, PhoneNumber } from "../src/model";
import { afterOf, choicesFor, orderSteps, planChanges, revertEdits } from "../src/plan";

const n = (id: string, extra: Partial<PhoneNumber> = {}): PhoneNumber => ({ id, number: `+31${id}`, active: true, inbound: true, outbound: true, ...extra });
const ch = (id: string, kind: ChannelRow["kind"], numberId?: string, callerIdId?: string, extra: Partial<ChannelRow> = {}): ChannelRow =>
  ({ id, name: id, workstreamName: `${id} WS`, kind, active: true, numberId, callerIdId, ...extra });

const numbers = [n("1"), n("2"), n("3"), n("in", { outbound: false }), n("out", { inbound: false }), n("off", { active: false })];
const edits = (...e: [string, Edit][]) => new Map(e);

describe("afterOf", () => {
  test("an outbound profile's caller ID follows its number, unless switched off", () => {
    expect(afterOf(ch("p", "outbound", "1", "1"), { numberId: "2" })).toEqual({ numberId: "2", callerIdId: "2" });
    expect(afterOf(ch("p", "outbound", "1", "1"), { numberId: "2", callerIdFollows: false })).toEqual({ numberId: "2", callerIdId: "1" });
    expect(afterOf(ch("p", "proactive", "1", "1"), { numberId: null })).toEqual({ numberId: undefined, callerIdId: undefined });
  });
  test("an inbound channel's caller ID isn't touched; an explicit caller ID (revert) wins", () => {
    expect(afterOf(ch("a", "inbound", "1"), { numberId: "2" })).toEqual({ numberId: "2", callerIdId: undefined });
    expect(afterOf(ch("p", "outbound", "1", "2"), { numberId: "3", callerIdId: "2" })).toEqual({ numberId: "3", callerIdId: "2" });
  });
});

describe("planChanges", () => {
  test("only the numbers a channel can use: active, and enabled for its direction", () => {
    const inbound = ch("a", "inbound", "1");
    const outbound = ch("p", "outbound", "1", "1");
    const errorsFor = (c: ChannelRow, to: string) => planChanges([c], numbers, edits([c.id, { numberId: to }])).issues.filter((i) => i.severity === "error").map((i) => i.message);
    expect(errorsFor(inbound, "out")[0]).toMatch(/isn't enabled for inbound calls/);
    expect(errorsFor(outbound, "in")[0]).toMatch(/isn't enabled for outbound calls/);
    expect(errorsFor(inbound, "off")[0]).toMatch(/deactivated/);
    expect(errorsFor(inbound, "2")).toEqual([]);
    const choices = choicesFor(inbound, numbers, [inbound, ch("b", "inbound", "2"), outbound]);
    expect(choices.find((c) => c.number.id === "out")?.reason).toBe("not enabled for inbound");
    expect(choices.some((c) => c.number.id === "1")).toBe(false);
    // Free first, then numbers now on another inbound channel; an outbound profile on it doesn't count.
    expect(choices.map((c) => [c.number.id, c.heldBy.map((h) => h.id)]).slice(0, 3)).toEqual([["3", []], ["in", []], ["2", ["b"]]]);
  });

  test("a number is on one inbound channel and one outbound profile at most; one of each may share it", () => {
    const a = ch("a", "inbound", "1"), b = ch("b", "inbound", "2"), p = ch("p", "outbound", "3", "3"), q = ch("q", "proactive", "2", "2");
    const inbound = planChanges([a, b, p, q], numbers, edits(["b", { numberId: "1" }]));
    expect(inbound.issues.find((i) => i.channelId === "b" && i.severity === "error")?.message).toMatch(/is on "a".*one inbound channel only/);
    const outbound = planChanges([a, b, p, q], numbers, edits(["q", { numberId: "3" }]));
    expect(outbound.issues.find((i) => i.channelId === "q" && i.severity === "error")?.message).toMatch(/is on "p".*one outbound profile only/);
    const shared = planChanges([a, b, p, q], numbers, edits(["b", { numberId: "3" }]));
    expect(shared.issues).toEqual([]);
  });

  test("a move or a swap between inbound channels is fine when done together", () => {
    const a = ch("a", "inbound", "1"), b = ch("b", "inbound", "2");
    const move = planChanges([a, b], numbers, edits(["a", { numberId: "3" }], ["b", { numberId: "1" }]));
    expect(move.issues.filter((i) => i.severity === "error")).toEqual([]);
    const swap = planChanges([a, b], numbers, edits(["a", { numberId: "2" }], ["b", { numberId: "1" }]));
    expect(swap.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("a pick that changes nothing isn't a change; no number warns", () => {
    const a = ch("a", "inbound", "1");
    expect(planChanges([a], numbers, edits(["a", { numberId: "1" }])).changes).toEqual([]);
    const none = planChanges([a], numbers, edits(["a", { numberId: null }]));
    expect(none.changes[0]).toMatchObject({ number: true, callerId: false, after: { numberId: undefined } });
    expect(none.issues[0]).toMatchObject({ severity: "warning" });
  });
});

describe("orderSteps", () => {
  const ids = (steps: ReturnType<typeof orderSteps>) => steps.map((s) => `${s.change.channel.id}${s.temporary ? "(free)" : ""}:${s.set.numberId === undefined ? "-" : s.set.numberId ?? "none"}`);

  test("a move updates the channel giving the number away first", () => {
    const a = ch("a", "inbound", "1"), b = ch("b", "inbound", "2");
    const plan = planChanges([a, b], numbers, edits(["b", { numberId: "1" }], ["a", { numberId: "3" }]));
    expect(ids(orderSteps(plan, [a, b]))).toEqual(["a:3", "b:1"]);
  });

  test("a swap frees one number first", () => {
    const a = ch("a", "inbound", "1"), b = ch("b", "inbound", "2");
    const plan = planChanges([a, b], numbers, edits(["a", { numberId: "2" }], ["b", { numberId: "1" }]));
    expect(ids(orderSteps(plan, [a, b]))).toEqual(["a(free):none", "b:1", "a:2"]);
  });

  test("outbound profiles keep the same order, and send the caller ID with the number", () => {
    const p = ch("p", "outbound", "1", "1"), q = ch("q", "outbound", "2", "2"), a = ch("a", "inbound", "2");
    const plan = planChanges([p, q, a], numbers, edits(["p", { numberId: "2" }], ["q", { numberId: "1" }]));
    const steps = orderSteps(plan, [p, q, a]);
    expect(ids(steps)).toEqual(["p(free):none", "q:1", "p:2"]);
    expect(steps.map((s) => s.set)).toEqual([{ numberId: null }, { numberId: "1", callerIdId: "1" }, { numberId: "2", callerIdId: "2" }]);
  });

  test("an inbound channel and an outbound profile don't wait for each other", () => {
    const a = ch("a", "inbound", "1"), p = ch("p", "outbound", "2", "2");
    const plan = planChanges([a, p], numbers, edits(["a", { numberId: "2" }], ["p", { numberId: "1" }]));
    expect(ids(orderSteps(plan, [a, p]))).toEqual(["a:2", "p:1"]);
  });
});

describe("revertEdits", () => {
  test("puts back the previous numbers of what was changed, and the caller ID only if it changed", () => {
    const p = ch("p", "outbound", "1", "1"), a = ch("a", "inbound", "2");
    const plan = planChanges([p, a], numbers, edits(["p", { numberId: "3", callerIdFollows: false }], ["a", { numberId: "3" }]));
    const back = revertEdits(plan.changes.map((change, i) => ({ change, status: i === 0 ? "updated" : "failed" as const })));
    expect([...back.entries()]).toEqual([["p", { numberId: "1", callerIdId: undefined, callerIdFollows: false }]]);
  });
});
