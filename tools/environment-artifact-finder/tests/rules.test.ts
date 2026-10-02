// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { analyze } from "../src/analyze";
import { buildGraph } from "../src/engine";
import { CURATED_EDGES } from "../src/referenceMap";
import { computeQueueReachability, parseDisabledRuleIds, runRules } from "../src/rules";
import { EdgeSpec } from "../src/model";
import { EMPTY_DECISION_XML, TableInput, edge, id, makeSnapshot, overflowXml, queueRoutingXml } from "./fixtures";

// Ids
const WS = id(1), WS_OFF = id(2);
const RC = id(10), RC_OLD = id(11);
const ST = id(20);
const RS_ROUTE = id(30), RS_OVERFLOW = id(31);
const Q_MAIN = id(40), Q_OVERFLOW = id(41), Q_IDLE = id(42), Q_STAFFED = id(43), Q_OFF = id(44);
const OA = id(50);
const USER = id(60);

// A small, fully readable routing world: one active workstream routing to Q_MAIN, whose overflow
// transfers to Q_OVERFLOW. Tests override individual tables.
function world(overrides: Record<string, TableInput> = {}): Record<string, TableInput> {
  return {
    msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: WS, name: "Sales", statecode: 0, msdyn_enablevoicev2: false }] },
    msdyn_routingconfiguration: { rows: [{ msdyn_routingconfigurationid: RC, name: "Sales v2", statecode: 0, msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: WS }] },
    msdyn_routingconfigurationstep: { rows: [{ msdyn_routingconfigurationstepid: ST, name: "Route to queue", statecode: 0, msdyn_type: 192350002, _msdyn_routingconfigurationid_value: RC, _msdyn_rulesetid_value: RS_ROUTE }] },
    msdyn_decisionruleset: {
      rows: [
        { msdyn_decisionrulesetid: RS_ROUTE, name: "Sales routing", statecode: 0, msdyn_rulesetdefinition: queueRoutingXml([Q_MAIN]) },
        { msdyn_decisionrulesetid: RS_OVERFLOW, name: "Sales overflow", statecode: 0, msdyn_rulesetdefinition: overflowXml(OA) }
      ]
    },
    msdyn_overflowactionconfig: { rows: [{ msdyn_overflowactionconfigid: OA, name: "Transfer", statecode: 0, msdyn_overflowactiondata: Q_OVERFLOW }] },
    msdyn_ocruleitem: { rows: [] },
    queue: {
      partial: true,
      rows: [
        { queueid: Q_MAIN, name: "Sales", statecode: 0, msdyn_isomnichannelqueue: true, _msdyn_prequeueoverflowrulesetid_value: RS_OVERFLOW },
        { queueid: Q_OVERFLOW, name: "Sales overflow", statecode: 0, msdyn_isomnichannelqueue: true }
      ]
    },
    queuemembership: { rows: [{ queuemembershipid: id(70), queueid: Q_MAIN, systemuserid: USER }] },
    ...overrides
  };
}

function run(tables: Record<string, TableInput>, edges: EdgeSpec[] = CURATED_EDGES) {
  const snapshot = makeSnapshot(tables, edges);
  const graph = buildGraph(snapshot);
  return { snapshot, graph, ...runRules(snapshot, graph) };
}

const checkIds = (findings: { checkId: string; recordId: string }[]) => findings.map((f) => `${f.checkId}@${f.recordId}`);

describe("queue reachability", () => {
  test("reached via routing rules, and via an overflow Queue Transfer from a reachable queue (fixed point)", () => {
    const { snapshot, graph } = run(world());
    const { reasons, gaps } = computeQueueReachability(snapshot, graph);
    expect(reasons.get(Q_MAIN)?.[0]).toContain("Routing rules of workstream “Sales”");
    expect(reasons.get(Q_OVERFLOW)?.[0]).toContain("Overflow transfer from queue “Sales”");
    expect(gaps).toEqual([]);
  });

  test("reached as a workstream's fallback queue", () => {
    const { snapshot, graph } = run(world({
      msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: WS, name: "Sales", statecode: 0, _msdyn_defaultqueue_value: Q_IDLE }] },
      queue: { rows: [{ queueid: Q_IDLE, name: "Fallback", statecode: 0 }] }
    }));
    expect(computeQueueReachability(snapshot, graph).reasons.get(Q_IDLE)?.[0]).toContain("Fallback queue");
  });
});

describe("queue rule", () => {
  test("no members and nothing routes to it → High structural finding that marks it dead", () => {
    const { findings } = run(world({ queue: { rows: [...world().queue.rows!, { queueid: Q_IDLE, name: "Returns", statecode: 0, msdyn_isomnichannelqueue: true }] } }));
    expect(findings).toEqual([expect.objectContaining({ checkId: "queue.noMembersNoRoutes", recordId: Q_IDLE, confidence: "high", checkType: "structural", marksDead: true })]);
    expect(findings[0].explanation).toContain("transfer");
  });

  test("the same queue is only Medium when part of the routing data couldn't be read", () => {
    const { findings } = run(world({
      msdyn_ocruleitem: { status: "notFound" },
      queue: { rows: [...world().queue.rows!, { queueid: Q_IDLE, name: "Returns", statecode: 0 }] }
    }));
    expect(findings[0]).toMatchObject({ checkId: "queue.noMembersNoRoutes", confidence: "medium" });
    expect(findings[0].evidence.join(" ")).toContain("Legacy routing rule (msdyn_ocruleitem) couldn't be read");
  });

  test("members but no route (referenced only by a deactivated workstream's rules) → unreachable, Medium", () => {
    const { findings } = run(world({
      msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: WS, name: "Sales", statecode: 1 }] },
      queuemembership: { rows: [{ queuemembershipid: id(70), queueid: Q_MAIN, systemuserid: USER }] }
    }));
    const main = findings.find((f) => f.recordId === Q_MAIN);
    expect(main).toMatchObject({ checkId: "queue.unreachable", confidence: "medium", checkType: "functional" });
    expect(main!.evidence.join(" ")).toContain("1 member(s)");
    expect(main!.evidence.join(" ")).toContain("Decision ruleset “Sales routing”");
  });

  test("non-Omnichannel queues are ignored even if a data source returns them", () => {
    const { findings } = run(world({ queue: { rows: [...world().queue.rows!, { queueid: Q_IDLE, name: "Alex's queue", msdyn_isomnichannelqueue: false }] } }));
    expect(findings.find((f) => f.recordId === Q_IDLE)).toBeUndefined();
  });

  test("skipped, with a note, when workstreams can't be read", () => {
    const { findings, notes } = run(world({ msdyn_liveworkstream: { status: "noPermission" } }));
    expect(findings.filter((f) => f.table === "queue")).toEqual([]);
    expect(notes.join(" ")).toContain("Queue checks skipped");
  });
});

describe("workstream rule", () => {
  test("deactivated workstream", () => {
    const { findings } = run(world({ msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: WS_OFF, name: "Legacy", statecode: 1 }] } }));
    expect(findings.find((f) => f.recordId === WS_OFF)).toMatchObject({ checkId: "workstream.inactive", confidence: "medium", marksDead: true });
  });

  test("active workstream with no steps, no legacy rules and no fallback → noRouting", () => {
    const { findings } = run(world({ msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: WS_OFF, name: "Chat", statecode: 0 }] } }));
    expect(findings.find((f) => f.recordId === WS_OFF)?.checkId).toBe("workstream.noRouting");
  });

  test("an active legacy routing rule counts as routing", () => {
    const { findings } = run(world({
      msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: WS_OFF, name: "Legacy chat", statecode: 0 }] },
      msdyn_ocruleitem: { rows: [{ msdyn_ocruleitemid: id(80), name: "Old rule", statecode: 0, _msdyn_liveworkstream_value: WS_OFF, _msdyn_queueassignid_value: Q_MAIN }] }
    }));
    expect(findings.find((f) => f.recordId === WS_OFF)).toBeUndefined();
  });

  test("every routing target deactivated or missing → allTargetsUnreachable", () => {
    const { findings } = run(world({
      msdyn_decisionruleset: { rows: [{ msdyn_decisionrulesetid: RS_ROUTE, name: "Escalations", statecode: 0, msdyn_rulesetdefinition: queueRoutingXml([Q_OFF, id(999)]) }] },
      queue: { rows: [{ queueid: Q_OFF, name: "Retired", statecode: 1 }] }
    }));
    const finding = findings.find((f) => f.checkId === "workstream.allTargetsUnreachable");
    expect(finding?.recordId).toBe(WS);
    expect(finding?.evidence).toEqual(expect.arrayContaining(["Target queue “Retired” is deactivated.", `Target queue ${id(999)} was not found among the Omnichannel queues you can read.`]));
  });

  describe("voice", () => {
    const VOICE = id(90), NUMBER = id(91);
    const voiceEdges = [...CURATED_EDGES,
      edge({ from: "msdyn_ocvoice", field: "msdyn_liveworkstreamid", to: ["msdyn_liveworkstream"], semantics: "parent" }),
      edge({ from: "cts_servicenumber", field: "cts_ocvoiceid", to: ["msdyn_ocvoice"], semantics: "parent" })];
    const voiceWs = { msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: WS, name: "Billing", statecode: 0, msdyn_enablevoicev2: true }] } };
    const voice = (statecode = 0) => ({ msdyn_ocvoice: { rows: [{ msdyn_ocvoiceid: VOICE, name: "Billing line", statecode, _msdyn_liveworkstreamid_value: WS }] } });
    const numbers = (rows: Record<string, unknown>[]) => ({ cts_servicenumber: { rows } });

    test("no linked voice channel → voiceNoChannel", () => {
      const { findings } = run(world({ ...voiceWs, msdyn_ocvoice: { rows: [] }, ...numbers([]) }), voiceEdges);
      expect(checkIds(findings)).toContain(`workstream.voiceNoChannel@${WS}`);
    });

    test("linked channel is deactivated → voiceChannelDisabled (and the channel itself isn't asked for a number)", () => {
      const { findings } = run(world({ ...voiceWs, ...voice(1), ...numbers([]) }), voiceEdges);
      expect(checkIds(findings)).toContain(`workstream.voiceChannelDisabled@${WS}`);
      expect(checkIds(findings)).not.toContain(`voicechannel.noNumber@${VOICE}`);
    });

    test("worked example: active voice workstream + channel, but no number → voiceNoNumber on both", () => {
      const { findings } = run(world({ ...voiceWs, ...voice(), ...numbers([]) }), voiceEdges);
      expect(checkIds(findings)).toEqual(expect.arrayContaining([`workstream.voiceNoNumber@${WS}`, `voicechannel.noNumber@${VOICE}`]));
    });

    test("a deactivated number doesn't count", () => {
      const { findings } = run(world({ ...voiceWs, ...voice(), ...numbers([{ cts_servicenumberid: NUMBER, name: "+31 20 555 0100", statecode: 1, _cts_ocvoiceid_value: VOICE }]) }), voiceEdges);
      expect(checkIds(findings)).toContain(`workstream.voiceNoNumber@${WS}`);
    });

    test("with an active number, nothing voice-related is reported", () => {
      const { findings } = run(world({ ...voiceWs, ...voice(), ...numbers([{ cts_servicenumberid: NUMBER, name: "+31 20 555 0100", statecode: 0, _cts_ocvoiceid_value: VOICE }]) }), voiceEdges);
      expect(findings.filter((f) => f.checkId.includes("voice"))).toEqual([]);
    });

    test("skipped with a note when no relationship between voice tables and workstreams is known", () => {
      const { findings, notes } = run(world({ ...voiceWs, ...voice(), ...numbers([]) }));
      expect(findings.filter((f) => f.checkId.includes("voice"))).toEqual([]);
      expect(notes.join(" ")).toContain("Voice channel checks skipped");
    });
  });
});

describe("record.inactive", () => {
  test("deactivated records of flagInactive tables are reported", () => {
    const { findings } = run({ cts_contactcenter: { rows: [{ cts_contactcenterid: id(100), name: "Old site", statecode: 1 }, { cts_contactcenterid: id(101), name: "EMEA", statecode: 0 }] } });
    expect(checkIds(findings)).toEqual([`record.inactive@${id(100)}`]);
  });
});

describe("routing configuration and steps", () => {
  test("a routing configuration of an active workstream with no steps → noSteps", () => {
    const { findings } = run(world({ msdyn_routingconfigurationstep: { rows: [] } }));
    expect(checkIds(findings)).toContain(`routingconfig.noSteps@${RC}`);
  });

  test("a non-active version next to an active one → superseded (Low, doesn't cascade)", () => {
    const { findings } = run(world({
      msdyn_routingconfiguration: { rows: [
        ...world().msdyn_routingconfiguration.rows!,
        { msdyn_routingconfigurationid: RC_OLD, name: "Sales v1", statecode: 0, msdyn_isactiveconfiguration: false, _msdyn_liveworkstreamid_value: WS }
      ] },
      msdyn_routingconfigurationstep: { rows: [
        ...world().msdyn_routingconfigurationstep.rows!,
        { msdyn_routingconfigurationstepid: id(21), name: "v1 step", statecode: 0, _msdyn_routingconfigurationid_value: RC_OLD, _msdyn_rulesetid_value: RS_ROUTE }
      ] }
    }));
    expect(findings.find((f) => f.recordId === RC_OLD)).toMatchObject({ checkId: "routingconfig.superseded", confidence: "low", marksDead: false });
  });

  test("step whose ruleset targets a deactivated queue → broken, High; a missing queue → broken, Medium", () => {
    const inactive = run(world({ queue: { rows: [{ queueid: Q_MAIN, name: "Sales", statecode: 1 }] } })).findings.find((f) => f.checkId === "routingstep.targetQueueBroken");
    expect(inactive).toMatchObject({ recordId: ST, confidence: "high", checkType: "broken", marksDead: false });
    const missing = run(world({ queue: { rows: [], partial: true } })).findings.find((f) => f.checkId === "routingstep.targetQueueBroken");
    expect(missing).toMatchObject({ recordId: ST, confidence: "medium" });
    expect(missing!.evidence[0]).toContain("among the Omnichannel queues you can read");
  });
});

describe("decision rulesets", () => {
  test("no rules, or every rule disabled → noRules; unparseable definitions are left alone", () => {
    const { findings } = run(world({ msdyn_decisionruleset: { rows: [
      { msdyn_decisionrulesetid: id(110), name: "Empty", msdyn_rulesetdefinition: EMPTY_DECISION_XML },
      { msdyn_decisionrulesetid: id(111), name: "All off", msdyn_rulesetdefinition: queueRoutingXml([Q_MAIN, Q_OVERFLOW]), msdyn_disabledrules: "[\"r0\",\"r1\"]" },
      { msdyn_decisionrulesetid: id(112), name: "One off", msdyn_rulesetdefinition: queueRoutingXml([Q_MAIN, Q_OVERFLOW]), msdyn_disabledrules: "r0" },
      { msdyn_decisionrulesetid: id(113), name: "ML model", msdyn_rulesetdefinition: "{\"type\":\"ml\"}" }
    ] } }));
    expect(checkIds(findings.filter((f) => f.checkId === "ruleset.noRules"))).toEqual([`ruleset.noRules@${id(110)}`, `ruleset.noRules@${id(111)}`]);
  });

  test("disabled-rule lists are read as JSON arrays or plain lists", () => {
    expect([...parseDisabledRuleIds("[\"a\",\"b\"]")]).toEqual(["a", "b"]);
    expect([...parseDisabledRuleIds("a, b")]).toEqual(["a", "b"]);
    expect(parseDisabledRuleIds(undefined).size).toBe(0);
  });
});

describe("assignment configurations", () => {
  const AC = id(120);
  const acEdges = [...CURATED_EDGES,
    edge({ from: "msdyn_assignmentconfiguration", field: "msdyn_queueid", to: ["queue"], semantics: "parent" }),
    edge({ from: "msdyn_assignmentconfigurationstep", field: "msdyn_assignmentconfigurationid", to: ["msdyn_assignmentconfiguration"], semantics: "parent" })];

  test("no steps → Low finding", () => {
    const { findings } = run(world({
      msdyn_assignmentconfiguration: { rows: [{ msdyn_assignmentconfigurationid: AC, name: "Sales assignment", _msdyn_queueid_value: Q_MAIN }] },
      msdyn_assignmentconfigurationstep: { rows: [] }
    }), acEdges);
    expect(findings.find((f) => f.recordId === AC)).toMatchObject({ checkId: "assignmentconfig.noSteps", confidence: "low" });
  });

  test("skipped with a note when the step → configuration relationship isn't known", () => {
    const { notes } = run(world({ msdyn_assignmentconfiguration: { rows: [] }, msdyn_assignmentconfigurationstep: { rows: [] } }));
    expect(notes.join(" ")).toContain("Assignment configuration “no steps” check skipped");
  });
});

describe("context variables", () => {
  const variable = (n: number, name: string, extra: Record<string, unknown> = {}) => ({ msdyn_ocliveworkstreamcontextvariableid: id(n), name, msdyn_name: name, statecode: 0, _msdyn_liveworkstreamid_value: WS, ...extra });

  test("only a variable that no condition reads and agents don't see is reported (Low)", () => {
    const { findings } = run(world({ msdyn_ocliveworkstreamcontextvariable: { rows: [
      variable(130, "Language"),
      variable(131, "PromoCode"),
      variable(132, "CustomerTier", { msdyn_isdisplayable: true })
    ] } }));
    const unused = findings.filter((f) => f.checkId === "contextvariable.unused");
    expect(unused.map((f) => f.recordId)).toEqual([id(131)]);
    expect(unused[0].confidence).toBe("low");
    expect(unused[0].confidenceReason).toMatch(/bots, IVR/);
  });

  test("a condition in any other ruleset, or a legacy rule mentioning it, counts as use (conservative)", () => {
    const { findings } = run(world({
      msdyn_decisionruleset: { rows: [...world().msdyn_decisionruleset.rows!, { msdyn_decisionrulesetid: id(133), name: "Elsewhere", msdyn_rulesetdefinition: queueRoutingXml([Q_MAIN], "PromoCode") }] },
      msdyn_ocruleitem: { rows: [{ msdyn_ocruleitemid: id(134), name: "Legacy", statecode: 0, msdyn_condition: "[{\"variableId\":\"Segment\"}]" }] },
      msdyn_ocliveworkstreamcontextvariable: { rows: [variable(131, "PromoCode"), variable(135, "Segment")] }
    }));
    expect(findings.filter((f) => f.checkId === "contextvariable.unused")).toEqual([]);
  });
});

describe("Omnichannel configuration", () => {
  test("with more than one record, the deactivated one is Medium and an older active one is Low", () => {
    const { findings } = run({ msdyn_omnichannelconfiguration: { rows: [
      { msdyn_omnichannelconfigurationid: id(140), name: "Current", statecode: 0, modifiedon: "2026-09-01T00:00:00Z" },
      { msdyn_omnichannelconfigurationid: id(141), name: "Copy", statecode: 0, modifiedon: "2025-01-01T00:00:00Z" },
      { msdyn_omnichannelconfigurationid: id(142), name: "Old", statecode: 1, modifiedon: "2024-01-01T00:00:00Z" }
    ] } });
    expect(findings.map((f) => [f.recordId, f.confidence])).toEqual([[id(141), "low"], [id(142), "medium"]]);
  });

  test("a single record is never reported", () => {
    expect(run({ msdyn_omnichannelconfiguration: { rows: [{ msdyn_omnichannelconfigurationid: id(140), name: "Only", statecode: 1 }] } }).findings).toEqual([]);
  });
});

describe("analyze: rules and engine together", () => {
  test("operating hours used only by an unreachable queue are reported as usedOnlyByCandidates", () => {
    const OH = id(150);
    const { findings } = analyze(makeSnapshot(world({
      msdyn_liveworkstream: { rows: [{ msdyn_liveworkstreamid: WS, name: "Sales", statecode: 0 }] },
      queue: { rows: [...world().queue.rows!, { queueid: Q_STAFFED, name: "Tier 2", statecode: 0, _msdyn_operatinghourid_value: OH }] },
      queuemembership: { rows: [{ queuemembershipid: id(71), queueid: Q_STAFFED, systemuserid: USER }] },
      msdyn_operatinghour: { rows: [{ msdyn_operatinghourid: OH, name: "Tier 2 hours" }] }
    })));
    expect(findings.find((f) => f.recordId === Q_STAFFED)?.checkId).toBe("queue.unreachable");
    expect(findings.find((f) => f.recordId === OH)?.checkId).toBe("structural.usedOnlyByCandidates");
  });
});
