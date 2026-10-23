// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph, RawEnvironment } from "../src/graph";
import { demoRaw } from "../src/demoData";
import { demoLiveSource } from "../src/demoLive";
import { buildLive, liveDetails, newArrivals, waitingByQueue } from "../src/live";

const Q = "11111111-0000-4000-8000-000000000001";
const W = "22222222-0000-4000-8000-000000000001";

function graph() {
  const raw: RawEnvironment = {
    phoneNumbers: [], channels: [], routingConfigurations: [], routingSteps: [], rulesets: [], resources: [], resourceSkills: [], warnings: [], unread: [],
    workstreams: [{ msdyn_liveworkstreamid: W, msdyn_name: "Sales", msdyn_streamsource: 192440000, _msdyn_defaultqueue_value: Q }],
    queues: [{ queueid: Q, name: "Sales" }],
    memberships: [{ queueid: Q, systemuserid: "U1" }, { queueid: Q, systemuserid: "U2" }, { queueid: Q, systemuserid: "U3" }],
    users: [{ systemuserid: "U1", fullname: "Ava" }, { systemuserid: "U2", fullname: "Liam" }, { systemuserid: "U3", fullname: "Noor" }]
  };
  return buildGraph(raw);
}

const SINCE = "2026-10-22T12:00:00.000Z";
const call = (id: string, statecode: number, statuscode: number, createdon: string, agent?: string) =>
  ({ msdyn_ocliveworkitemid: id, statecode, statuscode, createdon, _msdyn_cdsqueueid_value: `{${Q.toUpperCase()}}`, _msdyn_activeagentid_value: agent ?? null, _msdyn_liveworkstreamid_value: W });

describe("buildLive", () => {
  const live = buildLive(graph(), {
    since: SINCE,
    agentStatuses: [
      { _msdyn_agentid_value: "U1", msdyn_isagentloggedin: true, msdyn_currentpresenceid: { msdyn_name: "Available", msdyn_basepresencestatus: 192360000 } },
      { _msdyn_agentid_value: "U2", msdyn_isagentloggedin: true, msdyn_currentpresenceid: { msdyn_name: "BusyDNDOnReservation", msdyn_basepresencestatus: 192360002 } },
      { _msdyn_agentid_value: "U3", msdyn_isagentloggedin: false, msdyn_currentpresenceid: { msdyn_name: "Available", msdyn_basepresencestatus: 192360000 } },
      { _msdyn_agentid_value: "SOMEONE-ELSE", msdyn_isagentloggedin: true }
    ],
    conversations: [
      call("C1", 0, 1, "2026-10-23T08:00:00Z"),
      call("C2", 0, 2, "2026-10-23T08:05:00Z", "U2"),
      call("C3", 0, 5, "2026-10-23T08:10:00Z", "U1"),
      call("C4", 1, 4, "2026-10-23T07:00:00Z", "U1"),
      call("C5", 0, 1, "2026-10-20T09:00:00Z")
    ]
  }, "2026-10-23T09:00:00Z");

  test("maps presence onto agents; signed out is offline whatever was last set", () => {
    expect(live.presence.get("agent:u1")).toEqual({ presence: "available", name: "Available" });
    expect(live.presence.get("agent:u2")?.presence).toBe("dnd");
    expect(live.presence.get("agent:u3")).toEqual({ presence: "offline", name: "Signed out" });
    expect(live.presence.size).toBe(3);
  });

  test("sorts open conversations into waiting, with an agent and wrap-up", () => {
    expect(live.open.map((c) => `${c.id.toUpperCase()} ${c.status} ${c.agentKey ?? "-"}`)).toEqual([
      "C1 waiting -", "C2 with-agent agent:u2", "C3 wrap-up agent:u1", "C5 waiting -"
    ]);
    expect(waitingByQueue(live).get(`queue:${Q}`)).toBe(2);
  });

  test("counts the last day's conversations, closed ones included, but not older open ones", () => {
    expect(live.recent.get(`queue:${Q}`)).toBe(4);
    expect(live.recent.get(`workstream:${W}`)).toBe(4);
  });

  test("gives the details panel its live lines", () => {
    expect(liveDetails(`queue:${Q}`, live)).toEqual([["Waiting now", "2"], ["With an agent now", "2"], ["Last 24 hours", "4"]]);
    expect(liveDetails("agent:u2", live)).toEqual([["Presence", "BusyDNDOnReservation"], ["Conversations now", "1"]]);
    expect(liveDetails("phone:x", live)).toEqual([]);
  });

  test("new arrivals are the conversations that weren't open at the previous read", () => {
    const next = { ...live, open: [...live.open, { id: "c6", status: "waiting" as const, queueKey: `queue:${Q}` }] };
    expect(newArrivals(undefined, live)).toEqual([]);
    expect(newArrivals(live, next).map((c) => c.id)).toEqual(["c6"]);
  });
});

describe("demo live activity", () => {
  test("moves: calls arrive, get picked up and finish, all on records that exist", () => {
    const g = buildGraph(demoRaw());
    const read = demoLiveSource(g);
    const reads = Array.from({ length: 8 }, () => buildLive(g, read(SINCE), "2026-10-23T09:00:00Z"));
    const keys = new Set(g.nodes.map((n) => n.key));
    expect(reads[0].open.length).toBeGreaterThan(0);
    expect(reads.some((r) => r.open.some((c) => c.status === "with-agent"))).toBe(true);
    reads.forEach((r) => r.open.forEach((c) => { expect(keys.has(c.queueKey!)).toBe(true); if (c.agentKey) expect(keys.has(c.agentKey)).toBe(true); }));
    expect(reads[7].presence.size).toBe(g.nodes.filter((n) => n.kind === "agent").length);
  });
});
