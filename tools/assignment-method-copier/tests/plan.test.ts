// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Method, QueueRow, Ruleset } from "../src/model";
import { planCopies, rulesOf, sourceProblems, syncRules, usesContextVariables } from "../src/plan";

const VOICE = 192350002, MESSAGING = 192350000, LEAST_ACTIVE = 192350003, CUSTOM = 192350002;
const OUTPUT = "f799a4fd-dd4a-44c9-aa40-5b663a52321f";

// The two rulesets of the method the admin center created in the reference environment, shortened.
const PRIORITIZATION = `<decision hit-policy="first" version="1"><rules>
  <rule id="52fe09f7-30e6-4266-956c-8b947cc768b6" name="Rule 1 for prioritization"><logical operator="AND"><condition operator="==">
    <lhs type="attribute">liveworkitemcontext.574cf69d-e275-39b7-d902-e0d633b63a63.IsIdentified</lhs><rhs type="staticvalue">1</rhs></condition></logical>
    <action><orderby type="attribute" descending="false">msdyn_ocliveworkitem.msdyn_customerlanguageid</orderby></action></rule></rules></decision>`;
const ASSIGNMENT = `<decision hit-policy="first" version="1"><rules>
  <rule id="85e6eff4-92a2-4215-ad53-ee2a6d78c430" name="Assignment rule 1"><logical operator="AND"><condition operator="exact_match">
    <lhs type="attribute">agent.bookableresourcecharacteristic</lhs><rhs type="attribute">msdyn_ocliveworkitemcharacteristic</rhs></condition></logical></rule>
  <rule id="26873219-2093-41dc-bbe0-7ab65436df92" name="Skills &amp; &quot;language&quot;"><logical operator="AND" /></rule></rules></decision>`;

function queue(n: number, extra: Partial<QueueRow> = {}): QueueRow {
  return { id: `q${n}`, name: `Queue ${n}`, type: VOICE, strategy: LEAST_ACTIVE, inputContractId: `contract-${n}`, methods: [], ...extra };
}

function ruleset(name: string, definition: string, output: string, extra: Partial<Ruleset> = {}): Ruleset {
  return { id: `rs-${name}`, name, definition, rulesetType: 192350000, authoringMode: 192350000, inputContractId: "contract-1", outputContractId: output, isInputCollection: false, persistOutputData: false, refreshInputData: false, ...extra };
}

function method(extra: Partial<Method> = {}): Method {
  return {
    id: "m1", name: "Skills first", active: false, queueId: "q1",
    steps: [
      { id: "s2", name: "Ruleset assignment", type: 192350002, order: 2, isDefault: true, ruleset: ruleset("Ruleset assignment", ASSIGNMENT, OUTPUT) },
      { id: "s1", name: "New ruleset", type: 192350000, order: 1, isDefault: true, ruleset: ruleset("New ruleset", PRIORITIZATION, "contract-1") }
    ],
    ...extra
  };
}

function ids(): () => string {
  let n = 0;
  return () => `new-rule-${++n}`;
}

const from = queue(1, { strategy: LEAST_ACTIVE, methods: [{ id: "m1", name: "Skills first", active: false }] });

describe("reading a ruleset", () => {
  test("lists the rules in order, with their names unescaped", () => {
    expect(rulesOf(ASSIGNMENT)).toEqual([
      { id: "85e6eff4-92a2-4215-ad53-ee2a6d78c430", name: "Assignment rule 1" },
      { id: "26873219-2093-41dc-bbe0-7ab65436df92", name: "Skills & \"language\"" }
    ]);
  });

  test("spots context variables", () => {
    expect(usesContextVariables(PRIORITIZATION)).toBe(true);
    expect(usesContextVariables(ASSIGNMENT)).toBe(false);
  });
});

describe("planCopies", () => {
  test("a copy points at the target queue and its contract, in step order", () => {
    const [copy] = planCopies({ queue: from, method: method({ description: "Best skill match" }) }, [queue(2)], { activate: true }, ids());
    expect(copy.status).toBe("copy");
    expect(copy.method).toEqual({ msdyn_name: "Skills first", msdyn_uniquename: "msdyn_uniquename_new-rule-8", msdyn_description: "Best skill match", msdyn_isactiveconfiguration: false, "msdyn_queueid@odata.bind": "/queues(q2)" });
    expect(copy.steps.map((s) => s.step)).toEqual([
      { msdyn_name: "New ruleset", msdyn_type: 192350000, msdyn_steporder: 1, msdyn_isdefaultruleset: true, msdyn_uniquename: "msdyn_newrule5" },
      { msdyn_name: "Ruleset assignment", msdyn_type: 192350002, msdyn_steporder: 2, msdyn_isdefaultruleset: true, msdyn_uniquename: "msdyn_newrule7" }
    ]);
    const [prioritization, assignment] = copy.steps.map((s) => s.ruleset);
    // A prioritization ruleset's output is the queue's own contract; an assignment ruleset keeps the shared one.
    expect(prioritization["msdyn_inputcontractid@odata.bind"]).toBe("/msdyn_decisioncontracts(contract-2)");
    expect(prioritization["msdyn_outputcontractid@odata.bind"]).toBe("/msdyn_decisioncontracts(contract-2)");
    expect(assignment["msdyn_inputcontractid@odata.bind"]).toBe("/msdyn_decisioncontracts(contract-2)");
    expect(assignment["msdyn_outputcontractid@odata.bind"]).toBe(`/msdyn_decisioncontracts(${OUTPUT})`);
    expect(assignment).toMatchObject({ msdyn_name: "Ruleset assignment", msdyn_rulesettype: 192350000, msdyn_authoringmode: 192350000, msdyn_isinputcollection: false, msdyn_persistoutputdata: false, msdyn_refreshinputdata: false });
    expect([prioritization.msdyn_uniquename, assignment.msdyn_uniquename]).toEqual(["msdyn_newrule4", "msdyn_newrule6"]);
    expect(copy.before).toEqual({ strategy: LEAST_ACTIVE, activeMethodIds: [] });
  });

  test("every rule gets a new id and nothing else in the rules changes", () => {
    const [copy] = planCopies({ queue: from, method: method() }, [queue(2)], { activate: true }, ids());
    const assignment = copy.steps[1];
    const definition = String(assignment.ruleset.msdyn_rulesetdefinition);
    expect(rulesOf(definition).map((r) => r.id)).toEqual(["new-rule-2", "new-rule-3"]);
    expect(assignment.ruleIds).toEqual({ "85e6eff4-92a2-4215-ad53-ee2a6d78c430": "new-rule-2", "26873219-2093-41dc-bbe0-7ab65436df92": "new-rule-3" });
    expect(definition.replace("new-rule-2", "85e6eff4-92a2-4215-ad53-ee2a6d78c430").replace("new-rule-3", "26873219-2093-41dc-bbe0-7ab65436df92")).toBe(ASSIGNMENT);
    // The workstream id of a context variable is not a rule id and is kept.
    expect(String(copy.steps[0].ruleset.msdyn_rulesetdefinition)).toContain("liveworkitemcontext.574cf69d-e275-39b7-d902-e0d633b63a63.IsIdentified");
  });

  test("two queues never share rule ids", () => {
    const copies = planCopies({ queue: from, method: method() }, [queue(2), queue(3)], { activate: true }, ids());
    const all = copies.flatMap((c) => c.steps.flatMap((s) => Object.values(s.ruleIds)));
    expect(new Set(all).size).toBe(6);
  });

  test("disabled rules follow the new rule ids", () => {
    const m = method();
    m.steps[0].ruleset!.disabledRules = "26873219-2093-41dc-bbe0-7ab65436df92";
    const [copy] = planCopies({ queue: from, method: m }, [queue(2)], { activate: true }, ids());
    expect(copy.steps[1].ruleset.msdyn_disabledrules).toBe("new-rule-3");
  });

  test("blocks the source queue, another queue type and a queue without a contract", () => {
    const copies = planCopies({ queue: from, method: method() }, [from, queue(2, { type: MESSAGING }), queue(3, { inputContractId: undefined })], { activate: true }, ids());
    expect(copies.map((c) => c.status)).toEqual(["blocked", "blocked", "blocked"]);
    expect(copies[0].reasons[0]).toMatch(/copied from/);
    expect(copies[1].reasons[0]).toMatch(/Messaging queue; the method belongs to a Voice queue/);
    expect(copies[2].reasons[0]).toMatch(/no assignment contract/);
    expect(copies.every((c) => c.steps.length === 0)).toBe(true);
  });

  test("a queue that already has the method name gets a numbered copy", () => {
    const target = queue(2, { methods: [{ id: "x", name: "skills first", active: false }, { id: "y", name: "Skills first (2)", active: false }] });
    const [copy] = planCopies({ queue: from, method: method() }, [target], { activate: false }, ids());
    expect(copy.methodName).toBe("Skills first (3)");
    expect(copy.method.msdyn_name).toBe("Skills first (3)");
    expect(copy.notes[0]).toMatch(/the copy is named "Skills first \(3\)"/);
  });

  test("a queue on a custom method keeps it, to be switched off, and remembers it for the switch back", () => {
    const target = queue(2, { strategy: CUSTOM, methods: [{ id: "old", name: "Old method", active: true }] });
    const [copy] = planCopies({ queue: from, method: method() }, [target], { activate: true }, ids());
    expect(copy.before).toEqual({ strategy: CUSTOM, activeMethodIds: ["old"] });
    expect(copy.notes).toEqual(expect.arrayContaining([expect.stringMatching(/"Old method" stays on the queue, switched off/)]));
    const [copyOnly] = planCopies({ queue: from, method: method() }, [target], { activate: false }, ids());
    expect(copyOnly.notes.some((n) => /switched off/.test(n))).toBe(false);
  });

  test("a plain copy has no notes", () => {
    const [copy] = planCopies({ queue: from, method: method() }, [queue(2)], { activate: true }, ids());
    expect(copy.notes).toEqual([]);
  });
});

describe("syncRules", () => {
  const rule = (id: string, name: string, body: string) => `<rule id="${id}" name="${name}">${body}</rule>`;
  const decision = (...rules: string[]) => `<decision hit-policy="first" version="1"><rules>${rules.join("")}</rules></decision>`;
  const SKILLS = "<logical operator=\"AND\"><condition operator=\"exact_match\"><lhs type=\"attribute\">agent.bookableresourcecharacteristic</lhs></condition></logical>";
  const IDLE = "<action><orderby type=\"attribute\">agent.lastSessionReleasedOn</orderby></action>";
  const CAPACITY = "<logical operator=\"AND\"><condition operator=\"&gt;\"><lhs type=\"attribute\">agent.availableCapacity</lhs></condition></logical>";

  test("a rule that does the same keeps its id, then a rule with the same name; others are new or removed", () => {
    const source = ruleset("A", decision(rule("s1", "Skills", SKILLS), rule("s2", "Idle first", IDLE), rule("s3", "Capacity", CAPACITY), rule("s4", "Brand new", "<logical />")), OUTPUT);
    const target = ruleset("A", decision(rule("t1", "Skills", SKILLS), rule("t2", "Oldest first", IDLE), rule("t3", "Capacity", SKILLS.replace("exact_match", "contains")), rule("t4", "Gone", "<x />")), OUTPUT);
    const synced = syncRules(source, target, ids());
    expect(rulesOf(synced.definition)).toEqual([
      { id: "t1", name: "Skills" },        // same rule
      { id: "t2", name: "Idle first" },    // does the same, renamed
      { id: "t3", name: "Capacity" },      // same name, other conditions
      { id: "new-rule-1", name: "Brand new" }
    ]);
    expect(synced.changes).toEqual({ added: ["Brand new"], changed: ["Idle first", "Capacity"], removed: ["Gone"] });
    expect(synced.unchanged).toBe(false);
  });

  test("the same rules, laid out differently, are unchanged", () => {
    const source = ruleset("A", decision(rule("s1", "Skills", SKILLS)), OUTPUT);
    const target = ruleset("A", decision(rule("t1", "Skills", SKILLS)).replace(/></g, ">\r\n  <"), OUTPUT);
    expect(syncRules(source, target, ids())).toMatchObject({ unchanged: true, changes: { added: [], changed: [], removed: [] } });
  });

  test("disabled rules follow the kept ids, and clearing them is a change", () => {
    const source = ruleset("A", decision(rule("s1", "Skills", SKILLS), rule("s2", "Idle", IDLE)), OUTPUT, { disabledRules: "s2" });
    const target = ruleset("A", decision(rule("t1", "Skills", SKILLS), rule("t2", "Idle", IDLE)), OUTPUT);
    expect(syncRules(source, target, ids())).toMatchObject({ disabledRules: "t2", unchanged: false });
    const cleared = syncRules({ ...source, disabledRules: undefined }, { ...target, disabledRules: "t2" }, ids());
    expect(cleared).toMatchObject({ disabledRules: null, unchanged: false });
  });
});

describe("planCopies with a method already on the queue", () => {
  // The target queue's version of the method, with its own ids and contract.
  function onTarget(extra: Partial<Method> = {}, definitions: [string, string] = [PRIORITIZATION, ASSIGNMENT]): Method {
    const own = (d: string) => d.replace(/id="([0-9a-f]{8})/g, "id=\"t$1");
    return {
      id: "existing", name: "Skills first", active: true, queueId: "q2",
      steps: [
        { id: "ts1", name: "New ruleset", type: 192350000, order: 1, isDefault: true, ruleset: ruleset("New ruleset", own(definitions[0]), "contract-2", { id: "trs1", inputContractId: "contract-2" }) },
        { id: "ts2", name: "Ruleset assignment", type: 192350002, order: 2, isDefault: true, ruleset: ruleset("Ruleset assignment", own(definitions[1]), OUTPUT, { id: "trs2", inputContractId: "contract-2" }) }
      ],
      ...extra
    };
  }
  const target = (m: Method, extra: Partial<QueueRow> = {}) => queue(2, { strategy: CUSTOM, methods: [{ id: m.id, name: m.name, active: m.active }], ...extra });
  const both = { activate: true, match: { byName: true, byRules: true } };

  test("the same rules, in use: already up to date", () => {
    const m = onTarget();
    const [copy] = planCopies({ queue: from, method: method() }, [target(m)], both, ids(), { existing: m });
    expect(copy).toMatchObject({ status: "upToDate", activate: false, steps: [], existing: { matchedBy: "rules", updates: [] } });
  });

  test("the same rules, not in use: switched on, nothing rewritten", () => {
    const m = onTarget({ active: false, name: "Other name" });
    const [copy] = planCopies({ queue: from, method: method() }, [target(m, { strategy: LEAST_ACTIVE })], both, ids(), { existing: m });
    expect(copy).toMatchObject({ status: "update", activate: true, methodName: "Other name", existing: { matchedBy: "rules", updates: [] } });
    const [copyOnly] = planCopies({ queue: from, method: method() }, [target(m, { strategy: LEAST_ACTIVE })], { ...both, activate: false }, ids(), { existing: m });
    expect(copyOnly.status).toBe("upToDate");
  });

  test("the same name with other rules: those rulesets are rewritten, keeping rule ids where they match", () => {
    const changed = ASSIGNMENT.replace("exact_match", "contains");
    const m = onTarget({}, [PRIORITIZATION, changed]);
    const [copy] = planCopies({ queue: from, method: method() }, [target(m)], both, ids(), { existing: m });
    expect(copy.status).toBe("update");
    expect(copy.existing!.matchedBy).toBe("name");
    expect(copy.existing!.unchanged).toEqual(["New ruleset"]);
    const [update] = copy.existing!.updates;
    expect(update).toMatchObject({ rulesetId: "trs2", name: "Ruleset assignment", changes: { added: [], changed: ["Assignment rule 1"], removed: [] } });
    expect(rulesOf(String(update.columns.msdyn_rulesetdefinition)).map((r) => r.id)).toEqual(["t85e6eff4-92a2-4215-ad53-ee2a6d78c430", "t26873219-2093-41dc-bbe0-7ab65436df92"]);
    expect(update.before).toEqual({ msdyn_rulesetdefinition: m.steps[1].ruleset!.definition, msdyn_disabledrules: null });
    expect(copy.notes[0]).toBe("Assignment ruleset \"Ruleset assignment\": changes \"Assignment rule 1\".");
  });

  test("only matched by the chosen check", () => {
    const renamed = onTarget({ name: "Other name" });
    const byName = { activate: true, match: { byName: true, byRules: false } };
    expect(planCopies({ queue: from, method: method() }, [target(renamed)], byName, ids(), { existing: renamed })[0].status).toBe("copy");
    const otherRules = onTarget({}, [PRIORITIZATION, ASSIGNMENT.replace("exact_match", "contains")]);
    const byRules = { activate: true, match: { byName: false, byRules: true } };
    const [copy] = planCopies({ queue: from, method: method() }, [target(otherRules)], byRules, ids(), { existing: otherRules });
    expect([copy.status, copy.methodName]).toEqual(["copy", "Skills first (2)"]);
  });

  test("a missing ruleset is added to the method, and one the source lacks stays", () => {
    const m = onTarget();
    m.steps = [m.steps[1], { id: "ts3", name: "Selection", type: 192350001, order: 3, isDefault: true, ruleset: ruleset("Selection", "<decision />", OUTPUT, { inputContractId: "contract-2" }) }];
    const [copy] = planCopies({ queue: from, method: method() }, [target(m)], both, ids(), { existing: m });
    expect(copy.status).toBe("update");
    expect(copy.steps.map((s) => [s.step.msdyn_type, s.ruleset["msdyn_inputcontractid@odata.bind"], s.ruleset["msdyn_outputcontractid@odata.bind"]]))
      .toEqual([[192350000, "/msdyn_decisioncontracts(contract-2)", "/msdyn_decisioncontracts(contract-2)"]]);
    expect(copy.existing!.extra).toEqual(["Selection"]);
    expect(copy.notes).toEqual(["Adds the prioritization ruleset \"New ruleset\".", "\"Selection\" isn't in the source and stays as it is."]);
  });

  test("removing all rules first empties a ruleset the source lacks, and other methods, but not rulesets it rewrites", () => {
    const m = onTarget();
    m.steps.push({ id: "ts3", name: "Selection", type: 192350001, order: 3, isDefault: true, ruleset: ruleset("Selection", ASSIGNMENT, OUTPUT, { id: "trs3", inputContractId: "contract-2", disabledRules: "26873219-2093-41dc-bbe0-7ab65436df92" }) });
    const old = onTarget({ id: "old", name: "Old method", active: false }, [PRIORITIZATION, ASSIGNMENT.replace("exact_match", "contains")]);
    old.steps.forEach((s) => { s.ruleset!.id = `old-${s.ruleset!.id}`; });
    const q = queue(2, { strategy: CUSTOM, methods: [{ id: "existing", name: "Skills first", active: true }, { id: "old", name: "Old method", active: false }] });
    const [copy] = planCopies({ queue: from, method: method() }, [q], { ...both, clearFirst: true }, ids(), { existing: m, old });
    expect(copy.status).toBe("update");
    expect(copy.cleared.map((c) => [c.methodName, c.name])).toEqual([["Skills first", "Selection"], ["Old method", "New ruleset"], ["Old method", "Ruleset assignment"]]);
    const selection = copy.cleared[0];
    expect(rulesOf(String(selection.columns.msdyn_rulesetdefinition))).toEqual([]);
    expect(selection.columns.msdyn_disabledrules).toBeNull();
    expect(selection.before).toEqual({ msdyn_rulesetdefinition: ASSIGNMENT, msdyn_disabledrules: "26873219-2093-41dc-bbe0-7ab65436df92" });
    // The emptied ruleset isn't also reported as staying as it is.
    expect(copy.notes.some((n) => /stays as it is/.test(n))).toBe(false);
  });

  test("with nothing else on the queue and the method up to date, removing first changes nothing", () => {
    const m = onTarget();
    const [copy] = planCopies({ queue: from, method: method() }, [target(m)], { ...both, clearFirst: true }, ids(), { existing: m });
    expect(copy).toMatchObject({ status: "upToDate", cleared: [] });
  });

  test("blocks what it can't tell apart or read, and rulesets it doesn't expect", () => {
    const m = onTarget();
    const twice = queue(2, { methods: [{ id: "existing", name: "Skills first", active: false }, { id: "x", name: "skills first", active: false }] });
    const other = onTarget({ id: "x", name: "skills first" }, [PRIORITIZATION, ASSIGNMENT.replace("exact_match", "contains")]);
    const changed = onTarget({}, [PRIORITIZATION, ASSIGNMENT.replace("exact_match", "contains")]);
    expect(planCopies({ queue: from, method: method() }, [twice], both, ids(), { existing: changed, x: other })[0].reasons[0]).toMatch(/2 methods named "Skills first"/);
    expect(planCopies({ queue: from, method: method() }, [target(m)], both, ids(), {})[0].reasons[0]).toMatch(/couldn't be read, so it can't be checked/);
    const foreign = onTarget({}, [PRIORITIZATION, ASSIGNMENT.replace("exact_match", "contains")]);
    foreign.steps[1].ruleset!.inputContractId = "another";
    expect(planCopies({ queue: from, method: method() }, [target(foreign)], both, ids(), { existing: foreign })[0].reasons[0]).toMatch(/doesn't use this queue's assignment contract/);
    const doubled = onTarget({}, [PRIORITIZATION, ASSIGNMENT.replace("exact_match", "contains")]);
    doubled.steps.push({ ...doubled.steps[1], id: "ts9" });
    expect(planCopies({ queue: from, method: method() }, [target(doubled)], both, ids(), { existing: doubled })[0].reasons[0]).toMatch(/more than one Assignment ruleset/);
  });
});

describe("sourceProblems", () => {
  test("a normal method has none", () => {
    expect(sourceProblems({ queue: from, method: method() })).toEqual([]);
  });

  test("a method without rulesets, a model-based ruleset, a foreign contract and a rule naming its own queue all block", () => {
    expect(sourceProblems({ queue: from, method: method({ steps: [] }) })[0]).toMatch(/no rulesets yet/);
    const model = method(); model.steps[0].ruleset!.rulesetType = 192350001;
    expect(sourceProblems({ queue: from, method: model })[0]).toMatch(/isn't rule-based/);
    const foreign = method(); foreign.steps[0].ruleset!.inputContractId = "another-contract";
    expect(sourceProblems({ queue: from, method: foreign })[0]).toMatch(/doesn't use its queue's own assignment contract/);
    const selfReference = method(); selfReference.steps[0].ruleset!.definition = ASSIGNMENT.replace("msdyn_ocliveworkitemcharacteristic", "Q1");
    expect(sourceProblems({ queue: from, method: selfReference })[0]).toMatch(/refers to the queue "Queue 1" itself/);
    const unread = method(); unread.steps[0].ruleset = undefined;
    expect(sourceProblems({ queue: from, method: unread })[0]).toMatch(/couldn't be read/);
  });

  test("a blocked method blocks every queue", () => {
    const copies = planCopies({ queue: from, method: method({ steps: [] }) }, [queue(2), queue(3)], { activate: true }, ids());
    expect(copies.map((c) => c.status)).toEqual(["blocked", "blocked"]);
  });
});
