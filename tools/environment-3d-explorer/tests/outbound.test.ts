// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { buildGraph, RawEnvironment } from "../src/graph";
import { demoRaw } from "../src/demoData";
import { findIssues } from "../src/health";
import { extendRide } from "../src/ride";
import { computeDiagram } from "../../environment-diagram/src/layout";
import { isUnlinked } from "../../contact-center-3d/src/centers";

// An outbound profile is a voice workstream with msdyn_direction 1 and an outbound queue, and no routing
// (Profile Builder, read live 2026-10-01). It places calls, so it must not look like an inbound workstream
// that routes nowhere.

const Q_OUT = "11111111-0000-4000-8000-000000000001";
const Q_GONE = "11111111-0000-4000-8000-000000000009";

function environment(): RawEnvironment {
  return {
    phoneNumbers: [
      { msdyn_ocphonenumberid: "P1", msdyn_phonenumber: "+1 425 555 0101", msdyn_phoneinboundenabled: true, msdyn_phoneoutboundenabled: true },
      { msdyn_ocphonenumberid: "P2", msdyn_phonenumber: "+1 425 555 0102", msdyn_phoneinboundenabled: true, msdyn_phoneoutboundenabled: false }
    ],
    channels: [
      { msdyn_ocvoicechannelsettingid: "C1", msdyn_name: "Sales outbound", _msdyn_phonenumberid_value: "P1", _msdyn_liveworkstreamid_value: "W1" },
      { msdyn_ocvoicechannelsettingid: "C2", msdyn_name: "Support outbound", _msdyn_phonenumberid_value: "P2", _msdyn_liveworkstreamid_value: "W2" },
      { msdyn_ocvoicechannelsettingid: "C3", msdyn_name: "Inbound line", _msdyn_liveworkstreamid_value: "W4" }
    ],
    workstreams: [
      { msdyn_liveworkstreamid: "W1", msdyn_name: "Sales profile", msdyn_streamsource: 192440000, msdyn_direction: 1, _msdyn_outboundqueueid_value: Q_OUT },
      { msdyn_liveworkstreamid: "W2", msdyn_name: "Support profile", msdyn_streamsource: 192440000, msdyn_direction: 1 },
      { msdyn_liveworkstreamid: "W3", msdyn_name: "Old profile", msdyn_streamsource: 192440000, msdyn_direction: 1, _msdyn_outboundqueueid_value: Q_GONE },
      { msdyn_liveworkstreamid: "W4", msdyn_name: "Inbound, no routing", msdyn_streamsource: 192440000, msdyn_direction: 0 }
    ],
    routingConfigurations: [], routingSteps: [], rulesets: [],
    queues: [{ queueid: Q_OUT, name: "Outbound Sales", msdyn_queuetype: 192350002 }],
    memberships: [{ queueid: Q_OUT, systemuserid: "U1" }],
    users: [{ systemuserid: "U1", fullname: "Ava de Vries", isdisabled: false }],
    resources: [{ bookableresourceid: "R1", _userid_value: "U1" }],
    resourceSkills: [], warnings: [], unread: []
  };
}

const graph = buildGraph(environment());
const issues = findIssues(graph);
const checksOf = (key: string) => issues.filter((i) => i.key === key).map((i) => i.check).sort();

describe("outbound profiles", () => {
  test("a profile is marked outbound and linked to its outbound queue", () => {
    const profile = graph.nodes.find((n) => n.key === "workstream:w1")!;
    expect(profile.facts?.outbound).toBe(true);
    expect(profile.details).toContainEqual(["Direction", "Outbound"]);
    expect(graph.edges).toContainEqual({ from: "workstream:w1", to: `queue:${Q_OUT}`, kind: "outbound", label: undefined });
    expect(graph.edges.some((e) => e.from === "workstream:w1" && e.kind === "default")).toBe(false);
  });

  test("a profile with its outbound queue has no health issue", () => {
    expect(checksOf("workstream:w1")).toEqual([]);
  });

  test("the inbound checks don't apply to profiles; the outbound ones do", () => {
    expect(checksOf("workstream:w2")).toEqual(["no-outbound-queue"]);
    expect(checksOf("workstream:w3")).toEqual(["missing-outbound-queue"]);
    const inboundOnly = ["routes-nowhere", "no-rules", "no-channel", "missing-default-queue"];
    ["workstream:w1", "workstream:w2", "workstream:w3"].forEach((k) => expect(checksOf(k).filter((c) => inboundOnly.includes(c))).toEqual([]));
  });

  test("an inbound workstream without routing still routes nowhere", () => {
    expect(checksOf("workstream:w4")).toContain("routes-nowhere");
  });

  test("the outbound queue isn't reported as unreachable", () => {
    expect(checksOf(`queue:${Q_OUT}`)).not.toContain("unreachable");
  });

  test("a profile's number that can't place calls is flagged", () => {
    expect(checksOf("phone:p2")).toContain("number-not-outbound");
    expect(checksOf("phone:p1")).not.toContain("number-not-outbound");
  });

  test("3D Contact Center doesn't hide a profile as linked to nothing", () => {
    expect(isUnlinked(graph, "w1")).toBe(false);
  });

  test("the Environment Diagram draws a profile's outbound queue, not 'Routes nowhere'", () => {
    const diagram = computeDiagram(graph);
    const rows = (key: string) => diagram.shapes.filter((s) => s.parent === `ws|${key}`).map((s) => s.label);
    expect(diagram.shapes.find((s) => s.id === "ws|workstream:w1")!.sub).toBe("Outbound profile");
    expect(rows("workstream:w1")).toEqual(["Places calls in: outbound queue"]);
    expect(diagram.connectors.find((c) => c.kind === "outbound")).toMatchObject({ from: "workstream:w1", to: `queue:${Q_OUT}`, dashed: true });
    expect(rows("workstream:w2")).toEqual(["No outbound queue"]);
    expect(rows("workstream:w4")).toEqual(["Routes nowhere"]);
    // The profile's number and channel are drawn with it, with dashed lines: no call comes in that way.
    expect(diagram.connectors.filter((c) => c.to === "workstream:w1").every((c) => c.dashed)).toBe(true);
  });

  test("following a call from a number shared with a profile doesn't go into the profile", () => {
    const demo = buildGraph(demoRaw());
    const shared = demo.nodes.find((n) => n.kind === "phone" && demo.edges.filter((e) => e.from === n.key && e.kind === "number").length > 1)!;
    const { path } = extendRide(demo, [shared.key]);
    expect(path.map((k) => demo.nodes.find((n) => n.key === k)!.name)).toEqual([shared.name, "Retail Sales channel", "Retail Sales – Voice"]);
  });

  test("the sample environment's outbound profile is healthy", () => {
    const demo = buildGraph(demoRaw());
    const profile = demo.nodes.find((n) => n.name === "Sales – Outbound Profile")!;
    expect(profile.facts?.outbound).toBe(true);
    expect(findIssues(demo).filter((i) => i.key === profile.key)).toEqual([]);
  });
});
