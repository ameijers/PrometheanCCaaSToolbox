import { parseDecisionXml } from "../src/ruleXml";

// Fixtures captured verbatim from a real Dynamics 365 Contact Center environment
// (msdyn_decisionruleset.msdyn_rulesetdefinition for real Contoso demo workstreams).
const UNCONDITIONAL_QUEUE_ASSIGN = `
<decision hit-policy="all" version="1">
  <rules>
    <rule id="3fd4c1aa-7e5a-4373-add7-f8d304b91867" name="Route to Default Contoso Queue">
      <action>
        <setattribute>
          <lhs type="attribute">assign_to.queue</lhs>
          <rhs type="staticvalue">c8b65393-839f-f111-aaad-70a8a5b10059</rhs>
        </setattribute>
      </action>
    </rule>
  </rules>
</decision>`;

const CONDITIONAL_QUEUE_ASSIGN = `
<decision hit-policy="all" version="1">
  <rules>
    <rule id="28eec83f-71fc-42bf-90d4-54d51c4ea056" name="Sales">
      <logical operator="AND">
        <condition operator=">">
          <lhs type="attribute">msdyn_ocliveworkitem.msdyn_createdon</lhs>
          <rhs type="staticvalue">2026-08-01T00:00:00Z</rhs>
        </condition>
      </logical>
      <action>
        <setattribute>
          <lhs type="attribute">assign_to.queue</lhs>
          <rhs type="staticvalue">ac58a7ba-07a6-f111-aaad-6045bd0151a5</rhs>
        </setattribute>
      </action>
    </rule>
  </rules>
</decision>`;

const MULTI_RULE_PREQUEUE_OVERFLOW = `
<decision hit-policy="all" version="1">
  <rules>
    <rule id="942239d7-a9d4-0201-de38-8d4304bcfdfe" name="Rule1">
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
    </rule>
    <rule id="822387b4-a6ff-230c-7a3f-4276dd36cbe7" name="Rule2">
      <action>
        <setattribute>
          <lhs type="attribute">overflow.queuesizeoverflow</lhs>
          <rhs type="staticvalue">true</rhs>
        </setattribute>
        <setattribute>
          <lhs type="attribute">overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs>
          <rhs type="staticvalue">{0ef6a0c1-2bad-f111-aaac-70a8a5b10059}</rhs>
        </setattribute>
      </action>
      <logical operator="AND">
        <condition operator="not-null">
          <lhs type="attribute">queue_prequeue.currentqueuesize</lhs>
        </condition>
        <condition operator=">=">
          <lhs type="attribute">queue_prequeue.currentqueuesize</lhs>
          <rhs type="staticvalue">2</rhs>
        </condition>
      </logical>
    </rule>
  </rules>
</decision>`;

const IN_QUEUE_OVERFLOW_WITH_UNIT = `
<decision hit-policy="all" version="1">
  <rules>
    <rule id="1e57632e-3a40-5289-ce95-9b32ff05b877" name="Rule1">
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
    </rule>
  </rules>
</decision>`;

// Real percentage-based weighted distribution across two queues, plus a doubly-nested <logical> and
// the "liveworkitemcontext.<Name>" prefix used for custom context variables (as opposed to
// "msdyn_ocliveworkitem.<name>" used for system fields).
const PERCENTAGE_DISTRIBUTION = `
<decision hit-policy="all" version="1">
  <rules>
    <rule id="3fd4c1aa-7e5a-4373-add7-f8d304b91867" name="Route to Default Contoso Queue">
      <logical operator="AND">
        <logical operator="AND">
          <condition operator="==">
            <lhs type="attribute">liveworkitemcontext.PreferredLanguage</lhs>
            <rhs type="staticvalue">NL</rhs>
          </condition>
        </logical>
      </logical>
      <action>
        <upsertrecords>
          <target>percentagebaseddistribution</target>
          <records>
            <record>
              <setattribute>
                <lhs type="attribute">queuedetails.queueid</lhs>
                <rhs type="staticvalue">{c8b65393-839f-f111-aaad-70a8a5b10059}</rhs>
              </setattribute>
              <setattribute>
                <lhs type="attribute">queuedetails.percentage</lhs>
                <rhs type="staticvalue">80</rhs>
              </setattribute>
            </record>
            <record>
              <setattribute>
                <lhs type="attribute">queuedetails.queueid</lhs>
                <rhs type="staticvalue">{e11e9f11-2bad-f111-aaac-70a8a5b10059}</rhs>
              </setattribute>
              <setattribute>
                <lhs type="attribute">queuedetails.percentage</lhs>
                <rhs type="staticvalue">20</rhs>
              </setattribute>
            </record>
          </records>
        </upsertrecords>
      </action>
    </rule>
  </rules>
</decision>`;

// Real classification/enrichment ruleset (RS1) — note hit-policy="first", unlike the queue-routing
// and overflow rulesets above which all use "all".
const ENRICHMENT_HIT_FIRST = `
<decision hit-policy="first" version="1">
  <rules>
    <rule id="c2e4212c-a355-4994-b654-8dc150141363" name="rule2">
      <logical operator="AND">
        <condition operator="==">
          <lhs type="attribute">msdyn_ocliveworkitem.msdyn_customer_msdyn_ocliveworkitem_contact.contactid</lhs>
          <rhs type="staticvalue">{b863ecc8-849f-f111-aaad-70a8a5b10059}</rhs>
        </condition>
      </logical>
      <action>
        <setattribute>
          <lhs type="attribute">msdyn_ocliveworkitem.msdyn_priorityscore</lhs>
          <rhs type="staticvalue">20</rhs>
        </setattribute>
      </action>
    </rule>
  </rules>
</decision>`;

describe("parseDecisionXml", () => {
  test("returns null for a non-decision-table string", () => {
    expect(parseDecisionXml("not xml at all")).toBeNull();
    expect(parseDecisionXml("{\"some\":\"json\"}")).toBeNull();
  });

  test("parses an unconditional rule with a queue-assignment action, and hit-policy all", () => {
    const decision = parseDecisionXml(UNCONDITIONAL_QUEUE_ASSIGN);
    expect(decision?.hitPolicy).toBe("all");
    expect(decision?.rules).toHaveLength(1);
    expect(decision?.rules[0]).toMatchObject({
      name: "Route to Default Contoso Queue",
      conditionLogic: "AND",
      conditions: [],
      setAttributes: [{ lhs: "assign_to.queue", rhs: "c8b65393-839f-f111-aaad-70a8a5b10059" }]
    });
  });

  test("parses a conditional rule wrapped in a <logical> group", () => {
    const decision = parseDecisionXml(CONDITIONAL_QUEUE_ASSIGN);
    expect(decision?.rules).toHaveLength(1);
    expect(decision?.rules[0].conditions).toEqual([
      { operator: ">", lhs: "msdyn_ocliveworkitem.msdyn_createdon", rhs: "2026-08-01T00:00:00Z", unit: undefined }
    ]);
    expect(decision?.rules[0].setAttributes[0]).toEqual({ lhs: "assign_to.queue", rhs: "ac58a7ba-07a6-f111-aaad-6045bd0151a5" });
  });

  test("parses multiple ordered rules each with a not-null guard and a real comparison", () => {
    const decision = parseDecisionXml(MULTI_RULE_PREQUEUE_OVERFLOW);
    expect(decision?.rules).toHaveLength(2);
    expect(decision?.rules[0].name).toBe("Rule1");
    expect(decision?.rules[0].conditions.map((c) => c.operator)).toEqual(["not-null", ">="]);
    expect(decision?.rules[0].setAttributes).toEqual([
      { lhs: "overflow.estimatedwaittimeoverflow", rhs: "true" },
      { lhs: "overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid", rhs: "{07f6a0c1-2bad-f111-aaac-70a8a5b10059}" }
    ]);
    expect(decision?.rules[1].conditions[1]).toMatchObject({ operator: ">=", lhs: "queue_prequeue.currentqueuesize", rhs: "2" });
  });

  test("parses bare (non-<logical>-wrapped) conditions and captures a unit attribute", () => {
    const decision = parseDecisionXml(IN_QUEUE_OVERFLOW_WITH_UNIT);
    expect(decision?.rules).toHaveLength(1);
    expect(decision?.rules[0].conditions).toEqual([
      { operator: "not-null", lhs: "queue_inqueue.lapsedwaittime", rhs: undefined, unit: undefined },
      { operator: ">=", lhs: "queue_inqueue.lapsedwaittime", rhs: "30", unit: "seconds" }
    ]);
  });

  test("parses hit-policy=\"first\" distinctly from the default \"all\"", () => {
    const decision = parseDecisionXml(ENRICHMENT_HIT_FIRST);
    expect(decision?.hitPolicy).toBe("first");
    expect(decision?.rules[0].setAttributes).toEqual([{ lhs: "msdyn_ocliveworkitem.msdyn_priorityscore", rhs: "20" }]);
  });

  test("parses a percentage-based weighted distribution into one group per record, and the liveworkitemcontext prefix", () => {
    const decision = parseDecisionXml(PERCENTAGE_DISTRIBUTION);
    expect(decision?.rules[0].conditions).toEqual([
      { operator: "==", lhs: "liveworkitemcontext.PreferredLanguage", rhs: "NL", unit: undefined }
    ]);
    expect(decision?.rules[0].distributionRecords).toEqual([
      [{ lhs: "queuedetails.queueid", rhs: "{c8b65393-839f-f111-aaad-70a8a5b10059}" }, { lhs: "queuedetails.percentage", rhs: "80" }],
      [{ lhs: "queuedetails.queueid", rhs: "{e11e9f11-2bad-f111-aaac-70a8a5b10059}" }, { lhs: "queuedetails.percentage", rhs: "20" }]
    ]);
  });
});
