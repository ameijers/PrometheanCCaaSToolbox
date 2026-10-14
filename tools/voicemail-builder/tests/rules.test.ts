// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { intakeRuleXml, readIntakeRules, setIntakeRule } from "../src/intake";
import { applyChanges, readRules, ruleXml } from "../src/overflow";

// Rules the admin center wrote in academyexperiment (Step 0), with "Contoso Parts Main"'s overflow and
// the intake rule for "Contoso Flags Sales".
const VOICEMAIL = "08f6a0c1-2bad-f111-aaac-70a8a5b10059";

const PARTS_PREQUEUE_RULE3 = `    <rule id="30c34cf9-fda6-1879-39f1-68c03474569d" name="Rule3">
      <action>
        <setattribute>
          <lhs type="attribute">overflow.operatinghouroverflow</lhs>
          <rhs type="staticvalue">true</rhs>
        </setattribute>
        <setattribute>
          <lhs type="attribute">overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs>
          <rhs type="staticvalue">{08f6a0c1-2bad-f111-aaac-70a8a5b10059}</rhs>
        </setattribute>
      </action>
      <logical operator="AND">
        <condition operator="not-null">
          <lhs type="attribute">queue_prequeue.iswithinoperatinghour</lhs>
        </condition>
        <condition operator="==">
          <lhs type="attribute">queue_prequeue.iswithinoperatinghour</lhs>
          <rhs type="staticvalue">false</rhs>
        </condition>
      </logical>
    </rule>`;

const PARTS_PREQUEUE_RULE1 = `    <rule id="942239d7-a9d4-0201-de38-8d4304bcfdfe" name="Rule1">
      <action>
        <setattribute>
          <lhs type="attribute">overflow.estimatedwaittimeoverflow</lhs>
          <rhs type="staticvalue">true</rhs>
        </setattribute>
        <setattribute>
          <lhs type="attribute">overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs>
          <rhs type="staticvalue">{07f6a0c1-2bad-f111-aaac-70a8a5b10059}</rhs>
        </setattribute>
      </action>
      <logical operator="AND">
        <condition operator="not-null">
          <lhs type="attribute">queue_prequeue.estimatedwaittimeinminutes</lhs>
        </condition>
        <condition operator=">=">
          <lhs type="attribute">queue_prequeue.estimatedwaittimeinminutes</lhs>
          <rhs type="staticvalue">1</rhs>
        </condition>
      </logical>
    </rule>`;

const PARTS_INQUEUE_RULE1 = `    <rule id="1e57632e-3a40-5289-ce95-9b32ff05b877" name="Rule1">
      <action>
        <setattribute>
          <lhs type="attribute">overflow.lapsedwaittimeoverflow</lhs>
          <rhs type="staticvalue">true</rhs>
        </setattribute>
        <setattribute>
          <lhs type="attribute">overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs>
          <rhs type="staticvalue">{08f6a0c1-2bad-f111-aaac-70a8a5b10059}</rhs>
        </setattribute>
      </action>
      <condition operator="not-null">
        <lhs type="attribute">queue_inqueue.lapsedwaittime</lhs>
      </condition>
      <condition operator=">=">
        <lhs type="attribute">queue_inqueue.lapsedwaittime</lhs>
        <rhs type="staticvalue" unit="seconds">30</rhs>
      </condition>
    </rule>`;

const FLAGS_SALES_INTAKE = `<decision hit-policy="first" version="1">
  <rules>
    <rule id="f0477d8d-b128-416c-b07c-e235beb3291b" name="Missed Conversation">
      <logical operator="AND">
        <logical operator="AND">
          <condition operator="==">
            <lhs type="attribute">msdyn_ocvoicemail.msdyn_missedconversationid_msdyn_ocvoicemail.msdyn_cdsqueueid_msdyn_ocliveworkitem.queueid</lhs>
            <rhs type="staticvalue">{23958b21-a9c7-f111-a05c-6045bd0151a5}</rhs>
          </condition>
        </logical>
      </logical>
      <action>
        <setattribute>
          <lhs type="attribute">action.unifiedrouting</lhs>
          <rhs type="staticvalue">{d8dc5b09-d159-0126-e01b-0db902281cbc}</rhs>
        </setattribute>
      </action>
    </rule>
  </rules>
</decision>`;

const wrap = (rules: string[]) => `<decision hit-policy="all" version="1">\n  <rules>\n${rules.join("\n")}\n  </rules>\n</decision>`;

describe("overflow rules", () => {
  test("each condition is written character for character as the admin center wrote it", () => {
    expect(ruleXml("30c34cf9-fda6-1879-39f1-68c03474569d", "Rule3", { condition: "outOfHours" }, VOICEMAIL)).toBe(PARTS_PREQUEUE_RULE3);
    expect(ruleXml("942239d7-a9d4-0201-de38-8d4304bcfdfe", "Rule1", { condition: "estimatedWait", value: 1 }, "07f6a0c1-2bad-f111-aaac-70a8a5b10059")).toBe(PARTS_PREQUEUE_RULE1);
    expect(ruleXml("1e57632e-3a40-5289-ce95-9b32ff05b877", "Rule1", { condition: "waitTime", value: 30 }, VOICEMAIL)).toBe(PARTS_INQUEUE_RULE1);
    expect(ruleXml("x", "Rule2", { condition: "callsWaiting", value: 2 }, VOICEMAIL)).toContain("<lhs type=\"attribute\">queue_prequeue.currentqueuesize</lhs>\n          <rhs type=\"staticvalue\">2</rhs>");
  });

  test("reads each rule's condition, action and threshold", () => {
    expect(readRules(wrap([PARTS_PREQUEUE_RULE1, PARTS_PREQUEUE_RULE3])).map((r) => [r.name, r.condition, r.actionId, r.value])).toEqual([
      ["Rule1", "estimatedWait", "07f6a0c1-2bad-f111-aaac-70a8a5b10059", "1"],
      ["Rule3", "outOfHours", VOICEMAIL, "false"]
    ]);
    expect(readRules(wrap([PARTS_INQUEUE_RULE1]))[0]).toMatchObject({ condition: "waitTime", value: "30", actionId: VOICEMAIL });
  });

  test("a new ruleset is a decision with the new rules, named Rule1, Rule2…", () => {
    let n = 0;
    const { definition, ruleIds } = applyChanges(undefined, [{ kind: "add", wanted: { condition: "estimatedWait", value: 1 } }], "07f6a0c1-2bad-f111-aaac-70a8a5b10059", () => ["942239d7-a9d4-0201-de38-8d4304bcfdfe"][n++]);
    expect(definition).toBe(wrap([PARTS_PREQUEUE_RULE1]));
    expect(ruleIds).toEqual(["942239d7-a9d4-0201-de38-8d4304bcfdfe"]);
  });

  test("adding keeps the existing rules and continues their numbering; updating keeps id and name", () => {
    const existing = wrap([PARTS_PREQUEUE_RULE1]);
    const rule1 = readRules(existing)[0];
    const { definition, ruleIds } = applyChanges(existing, [
      { kind: "update", wanted: { condition: "estimatedWait", value: 5 }, rule: rule1, overwrote: true },
      { kind: "add", wanted: { condition: "outOfHours" } }
    ], VOICEMAIL, () => "30c34cf9-fda6-1879-39f1-68c03474569d");
    const rules = readRules(definition);
    expect(rules.map((r) => [r.id, r.name, r.condition, r.actionId, r.value])).toEqual([
      ["942239d7-a9d4-0201-de38-8d4304bcfdfe", "Rule1", "estimatedWait", VOICEMAIL, "5"],
      ["30c34cf9-fda6-1879-39f1-68c03474569d", "Rule2", "outOfHours", VOICEMAIL, "false"]
    ]);
    expect(ruleIds).toEqual(["942239d7-a9d4-0201-de38-8d4304bcfdfe", "30c34cf9-fda6-1879-39f1-68c03474569d"]);
    expect(definition).toContain(PARTS_PREQUEUE_RULE3.replace("Rule3", "Rule2"));
  });

  test("a definition that isn't a decision with rules can't be changed", () => {
    expect(() => applyChanges("<something />", [{ kind: "add", wanted: { condition: "outOfHours" } }], VOICEMAIL, () => "x")).toThrow(/can't be read/);
  });
});

describe("intake rules", () => {
  test("a rule is written character for character as the admin center wrote it", () => {
    expect(setIntakeRule(undefined, { id: "f0477d8d-b128-416c-b07c-e235beb3291b", name: "Missed Conversation", queueId: "23958b21-a9c7-f111-a05c-6045bd0151a5", workstreamId: "d8dc5b09-d159-0126-e01b-0db902281cbc" })).toBe(FLAGS_SALES_INTAKE);
  });

  test("reads which queue each rule matches and where it sends the voicemail", () => {
    expect(readIntakeRules(FLAGS_SALES_INTAKE).map((r) => [r.name, r.queueId, r.workstreamId, r.unconditional])).toEqual([
      ["Missed Conversation", "23958b21-a9c7-f111-a05c-6045bd0151a5", "d8dc5b09-d159-0126-e01b-0db902281cbc", false]
    ]);
    const catchAll = FLAGS_SALES_INTAKE.replace(/<logical operator="AND">[\s\S]*<\/logical>\n/, "");
    expect(readIntakeRules(catchAll)[0].unconditional).toBe(true);
  });

  test("rules are added at the end, or replaced keeping their id and name", () => {
    const added = setIntakeRule(FLAGS_SALES_INTAKE, { id: "new", name: "Voicemail – Support", queueId: "q2", workstreamId: "w2" });
    expect(readIntakeRules(added).map((r) => r.name)).toEqual(["Missed Conversation", "Voicemail – Support"]);
    const replaced = setIntakeRule(FLAGS_SALES_INTAKE, { id: "ignored", name: "ignored", queueId: "23958b21-a9c7-f111-a05c-6045bd0151a5", workstreamId: "w9" }, readIntakeRules(FLAGS_SALES_INTAKE)[0]);
    expect(readIntakeRules(replaced).map((r) => [r.id, r.name, r.workstreamId])).toEqual([["f0477d8d-b128-416c-b07c-e235beb3291b", "Missed Conversation", "w9"]]);
    expect(intakeRuleXml("i", "A & B", "q", "w")).toContain('name="A &amp; B"');
  });
});
