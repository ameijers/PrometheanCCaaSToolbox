export interface ParsedCondition {
  operator: string;
  lhs: string;
  rhs?: string;
  unit?: string;
}

export interface ParsedSetAttribute {
  lhs: string;
  rhs: string;
}

export interface ParsedRule {
  id: string;
  name: string;
  conditionLogic: "AND" | "OR";
  conditions: ParsedCondition[];
  setAttributes: ParsedSetAttribute[];
  // Present for a percentage-based weighted distribution action
  // (<upsertrecords><target>percentagebaseddistribution</target><records><record>...</record></records></upsertrecords>):
  // one entry per <record>, each holding that record's own setattribute group (e.g. a queue id + its weight).
  distributionRecords: ParsedSetAttribute[][];
}

export interface ParsedDecision {
  hitPolicy: "first" | "all";
  rules: ParsedRule[];
}

// Attribute values in this format can contain "<" or ">" (e.g. operator=">="), so tag
// matching must consume explicit `name="value"` pairs rather than "everything up to the next >".
const ATTR_RUN = `(?:\\s+[\\w:-]+="[^"]*")*`;

function attrValue(tagAttrs: string, name: string): string | undefined {
  return tagAttrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

function openTag(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}\\b(${ATTR_RUN})\\s*/?>`))?.[1] ?? "";
}

function tagText(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}\\b${ATTR_RUN}\\s*>([\\s\\S]*?)</${tag}>`))?.[1]?.trim();
}

/**
 * Parses the Dataverse unified-routing decision-table XML format
 * (`msdyn_decisionruleset.msdyn_rulesetdefinition` for Declarative rulesets):
 * <decision hit-policy="all"><rules><rule id="" name="">
 *   <logical operator="AND"><condition operator=">">...</condition></logical>
 *   <action><setattribute><lhs>...</lhs><rhs>...</rhs></setattribute></action>
 * </rule></rules></decision>
 * Returns null if the string doesn't look like this format at all (caller should
 * warn rather than assume the ruleset is empty).
 *
 * `hit-policy` matters and varies per ruleset (confirmed against real data: a workstream's
 * classification/enrichment ruleset used "first" while its queue-routing ruleset used "all") —
 * "first" means stop at the first matching rule; "all" means every matching rule applies, in
 * order, with a later match overriding an earlier one for the same output.
 */
export function parseDecisionXml(xml: string): ParsedDecision | null {
  if (typeof xml !== "string" || !/<decision\b/i.test(xml)) return null;
  const hitPolicy: "first" | "all" = attrValue(openTag(xml, "decision"), "hit-policy")?.toLowerCase() === "first" ? "first" : "all";

  const ruleTagRe = new RegExp(`<rule\\b(${ATTR_RUN})\\s*>([\\s\\S]*?)<\\/rule>`, "g");
  const ruleMatches = [...xml.matchAll(ruleTagRe)];
  const rules = ruleMatches.map(([, openAttrs, body], index) => {
    const id = attrValue(openAttrs, "id") ?? `rule-${index}`;
    const name = attrValue(openAttrs, "name") ?? `Rule ${index + 1}`;

    const conditionLogic: "AND" | "OR" = attrValue(openTag(body, "logical"), "operator")?.toUpperCase() === "OR" ? "OR" : "AND";

    const conditionTagRe = new RegExp(`<condition\\b(${ATTR_RUN})\\s*>([\\s\\S]*?)<\\/condition>`, "g");
    const rhsTagRe = new RegExp(`<rhs\\b(${ATTR_RUN})\\s*>([\\s\\S]*?)<\\/rhs>`);
    const conditions: ParsedCondition[] = [...body.matchAll(conditionTagRe)].map(([, condAttrs, condBody]) => {
      const rhsMatch = condBody.match(rhsTagRe);
      return {
        operator: attrValue(condAttrs, "operator") ?? "equals",
        lhs: tagText(condBody, "lhs") ?? "",
        rhs: rhsMatch?.[2]?.trim(),
        unit: rhsMatch ? attrValue(rhsMatch[1], "unit") : undefined
      };
    });

    const actionBody = tagText(body, "action") ?? "";
    const setAttributesOf = (scope: string): ParsedSetAttribute[] => [...scope.matchAll(/<setattribute>([\s\S]*?)<\/setattribute>/g)].map(([, saBody]) => ({
      lhs: tagText(saBody, "lhs") ?? "",
      rhs: tagText(saBody, "rhs") ?? ""
    }));
    const setAttributes = setAttributesOf(actionBody);
    const distributionRecords: ParsedSetAttribute[][] = [...actionBody.matchAll(/<record>([\s\S]*?)<\/record>/g)].map(([, recordBody]) => setAttributesOf(recordBody));

    return { id, name, conditionLogic, conditions, setAttributes, distributionRecords };
  });

  return { hitPolicy, rules };
}
