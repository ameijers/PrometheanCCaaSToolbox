// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { hash } from "./layout";
import { LiveRows } from "./live";
import { Graph } from "./model";

// A made-up, moving contact center for the offline demo: each read, a few calls arrive, some are
// picked up, some finish, and agents change presence now and then. Same row shapes as Dataverse.

const PRESENCES = [
  { msdyn_name: "Available", msdyn_basepresencestatus: 192360000 },
  { msdyn_name: "Busy", msdyn_basepresencestatus: 192360001 },
  { msdyn_name: "Do not disturb", msdyn_basepresencestatus: 192360002 },
  { msdyn_name: "Away", msdyn_basepresencestatus: 192360003 }
];

interface DemoCall { id: string; queue: string; workstream?: string; agent?: string; status: number; createdon: string; closed: boolean }

export function demoLiveSource(graph: Graph): (since: string) => LiveRows {
  const agents = graph.nodes.filter((n) => n.kind === "agent" && n.recordId);
  const members = new Map<string, string[]>();
  graph.edges.filter((e) => e.kind === "member").forEach((e) => members.set(e.from, [...(members.get(e.from) ?? []), e.to]));
  // A call comes in through a workstream's route to a queue that has members.
  const routes = graph.edges
    .filter((e) => (e.kind === "routes" || e.kind === "default") && e.to.startsWith("queue:") && members.has(e.to))
    .map((e) => ({ queue: e.to, workstream: e.from.startsWith("workstream:") ? e.from : graph.edges.find((x) => x.to === e.from && x.from.startsWith("workstream:"))?.from }));
  const recordId = (key?: string) => (key ? graph.nodes.find((n) => n.key === key)?.recordId : undefined);

  let tick = 0;
  let serial = 0;
  const calls: DemoCall[] = [];
  const random = (salt: number) => (hash(`demo-live-${tick}`, salt) + 1) / 2;
  const busyAgents = () => new Set(calls.filter((c) => !c.closed && c.agent).map((c) => c.agent));

  const step = () => {
    tick++;
    const now = new Date().toISOString();
    // Calls in wrap-up finish; calls with an agent go to wrap-up or finish; waiting calls get picked up.
    calls.forEach((c, i) => {
      if (c.closed) return;
      const r = random(i + 1);
      if (c.status === 5) { if (r < 0.6) c.closed = true; }
      else if (c.agent) { if (r < 0.25) c.status = 5; else if (r < 0.35) c.closed = true; }
      else if (r < 0.7) {
        const free = (members.get(`queue:${c.queue}`) ?? []).filter((a) => !busyAgents().has(a));
        if (free.length) { c.agent = free[Math.floor(random(i + 50) * free.length)]; c.status = 2; }
      }
    });
    // A few new calls.
    const arriving = tick === 1 ? 12 : Math.floor(random(999) * 4);
    for (let n = 0; n < arriving && routes.length; n++) {
      const route = routes[Math.floor(random(2000 + n) * routes.length)];
      calls.push({ id: `00000000-0000-4000-9000-${String(++serial).padStart(12, "0")}`, queue: recordId(route.queue)!, workstream: recordId(route.workstream), status: 1, createdon: now, closed: false });
    }
  };

  return (since: string) => {
    step();
    const busy = busyAgents();
    return {
      since,
      agentStatuses: agents.map((a, i) => {
        const r = (hash(`${a.key}-${Math.floor(tick / 6)}`, 7) + 1) / 2;
        const presence = busy.has(a.key) ? PRESENCES[1] : r < 0.12 ? PRESENCES[3] : r < 0.18 ? PRESENCES[2] : PRESENCES[0];
        return { _msdyn_agentid_value: a.recordId, msdyn_isagentloggedin: i % 9 !== 4, msdyn_currentpresenceid: presence };
      }),
      conversations: calls.map((c) => ({
        msdyn_ocliveworkitemid: c.id, statecode: c.closed ? 1 : 0, statuscode: c.closed ? 4 : c.status, createdon: c.createdon,
        _msdyn_cdsqueueid_value: c.queue, _msdyn_activeagentid_value: c.agent ? recordId(c.agent) : null, _msdyn_liveworkstreamid_value: c.workstream ?? null
      }))
    };
  };
}
