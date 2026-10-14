// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { appendRules, canAppend, existingRules, ruleIds, ruleXml } from "../src/rules";

// The ruleset the admin center wrote in Step 0 ("Route Selected Menu Items" on Contoso Flags Retail).
const ADMIN_CENTER = `<decision hit-policy="all" version="1">
  <rules>
    <rule id="6af2bb5a-0ed2-4d66-adbc-f53e7857792b" name="Route to service">
      <logical operator="AND">
        <logical operator="AND">
          <condition operator="==">
            <lhs type="attribute">liveworkitemcontext.MenuItemSelected</lhs>
            <rhs type="staticvalue">Service</rhs>
          </condition>
        </logical>
      </logical>
      <action>
        <setattribute>
          <lhs type="attribute">assign_to.queue</lhs>
          <rhs type="staticvalue">612694e4-babc-f111-aaaf-6045bd0151a5</rhs>
        </setattribute>
      </action>
    </rule>
    <rule id="d0bd6317-67c1-4528-8d37-bab7383e3d93" name="Route to Sales">
      <logical operator="AND">
        <logical operator="AND">
          <condition operator="==">
            <lhs type="attribute">liveworkitemcontext.MenuItemSelected</lhs>
            <rhs type="staticvalue">Sales</rhs>
          </condition>
        </logical>
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

const service = { id: "6af2bb5a-0ed2-4d66-adbc-f53e7857792b", name: "Route to service", variable: "MenuItemSelected", value: "Service", queueId: "612694e4-babc-f111-aaaf-6045bd0151a5" };
const sales = { id: "d0bd6317-67c1-4528-8d37-bab7383e3d93", name: "Route to Sales", variable: "MenuItemSelected", value: "Sales", queueId: "ac58a7ba-07a6-f111-aaad-6045bd0151a5" };

describe("rules", () => {
  test("a new ruleset with the admin center's two rules is character for character what the admin center wrote", () => {
    expect(appendRules(undefined, [service, sales])).toBe(ADMIN_CENTER);
    expect(appendRules("", [service, sales])).toBe(ADMIN_CENTER);
  });

  test("rules are added after the existing ones, and the rest is kept", () => {
    const first = appendRules(undefined, [service]);
    expect(appendRules(first, [sales])).toBe(ADMIN_CENTER);
    const firstPolicy = first.replace('hit-policy="all"', 'hit-policy="first"');
    expect(appendRules(firstPolicy, [sales])).toBe(ADMIN_CENTER.replace('hit-policy="all"', 'hit-policy="first"'));
  });

  test("an empty rules element and a definition with other rules work too", () => {
    expect(appendRules('<decision hit-policy="all" version="1">\n  <rules />\n</decision>', [service, sales])).toBe(ADMIN_CENTER);
    const parts = '<decision hit-policy="all" version="1">\n  <rules>\n    <rule id="x" name="Part Rule 1">\n      <action />\n    </rule>\n  </rules>\n</decision>';
    expect(ruleIds(appendRules(parts, [service]))).toEqual(["x", service.id]);
  });

  test("values and names are escaped", () => {
    const xml = ruleXml({ ...service, name: "Sales & \"more\"", value: "<1>&'2'" });
    expect(xml).toContain('name="Sales &amp; &quot;more&quot;"');
    expect(xml).toContain("<rhs type=\"staticvalue\">&lt;1&gt;&amp;&apos;2&apos;</rhs>");
    expect(existingRules(appendRules(undefined, [{ ...service, name: "Sales & \"more\"", value: "<1>&'2'" }]), "MenuItemSelected"))
      .toEqual([{ id: service.id, name: "Sales & \"more\"", values: ["<1>&'2'"] }]);
  });

  test("reads the existing rules and the values they compare the variable with", () => {
    expect(existingRules(ADMIN_CENTER, "MenuItemSelected")).toEqual([
      { id: service.id, name: "Route to service", values: ["Service"] },
      { id: sales.id, name: "Route to Sales", values: ["Sales"] }
    ]);
    expect(existingRules(ADMIN_CENTER, "CallReason").map((r) => r.values)).toEqual([[], []]);
    expect(existingRules(undefined, "MenuItemSelected")).toEqual([]);
  });

  test("a definition that isn't a decision with rules can't be added to", () => {
    expect(canAppend(undefined)).toBe(true);
    expect(canAppend(ADMIN_CENTER)).toBe(true);
    expect(canAppend("<something />")).toBe(false);
    expect(canAppend("<decision version=\"1\" />")).toBe(false);
    expect(() => appendRules("<something />", [service])).toThrow(/can't be read/);
  });
});
