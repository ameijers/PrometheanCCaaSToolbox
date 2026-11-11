// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

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

// The rule's conditions as they are nested: <logical operator="AND|OR"> groups holding conditions and
// further groups. A single outer group holding everything is the group itself.
export interface ParsedGroup {
  operator: "AND" | "OR";
  items: (ParsedCondition | ParsedGroup)[];
}

export const isParsedGroup = (item: ParsedCondition | ParsedGroup): item is ParsedGroup => "items" in item;

export interface ParsedRule {
  id: string;
  name: string;
  // The operator of the first <logical> group, and every condition in document order. Kept for code
  // that shows rules as one flat list; "group" has the nesting.
  conditionLogic: "AND" | "OR";
  conditions: ParsedCondition[];
  group: ParsedGroup;
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

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function unescapeXml(value: string): string {
  return value.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attrValue(tagAttrs: string, name: string): string | undefined {
  return tagAttrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

function openTag(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}\\b(${ATTR_RUN})\\s*/?>`))?.[1] ?? "";
}

function tagText(xml: string, tag: string): string | undefined {
  const text = xml.match(new RegExp(`<${tag}\\b${ATTR_RUN}\\s*>([\\s\\S]*?)</${tag}>`))?.[1]?.trim();
  return text === undefined ? undefined : unescapeXml(text);
}

const RHS_TAG = new RegExp(`<rhs\\b(${ATTR_RUN})\\s*>([\\s\\S]*?)<\\/rhs>`);

function parseCondition(condAttrs: string, condBody: string): ParsedCondition {
  const rhsMatch = condBody.match(RHS_TAG);
  return {
    operator: unescapeXml(attrValue(condAttrs, "operator") ?? "equals"),
    lhs: tagText(condBody, "lhs") ?? "",
    rhs: rhsMatch ? unescapeXml(rhsMatch[2].trim()) : undefined,
    unit: rhsMatch ? attrValue(rhsMatch[1], "unit") : undefined
  };
}

// The nested groups of a rule body, its <action> left out.
function parseGroup(body: string): ParsedGroup {
  const root: ParsedGroup = { operator: "AND", items: [] };
  const stack = [root];
  const token = new RegExp(`<logical\\b(${ATTR_RUN})\\s*>|<\\/logical>|<condition\\b(${ATTR_RUN})\\s*>([\\s\\S]*?)<\\/condition>`, "g");
  for (const m of body.replace(/<action\b[\s\S]*?<\/action>/g, "").matchAll(token)) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith("</logical")) { if (stack.length > 1) stack.pop(); continue; }
    if (m[0].startsWith("<logical")) {
      const group: ParsedGroup = { operator: attrValue(m[1], "operator")?.toUpperCase() === "OR" ? "OR" : "AND", items: [] };
      top.items.push(group);
      stack.push(group);
      continue;
    }
    top.items.push(parseCondition(m[2], m[3]));
  }
  return root.items.length === 1 && isParsedGroup(root.items[0]) ? root.items[0] : root;
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
 * "first" means stop at the first matching rule; "all" means every rule is evaluated. What "all" does
 * with several matches is up to the stage (src/evaluator.ts).
 */
export function parseDecisionXml(xml: string): ParsedDecision | null {
  if (typeof xml !== "string" || !/<decision\b/i.test(xml)) return null;
  const hitPolicy: "first" | "all" = attrValue(openTag(xml, "decision"), "hit-policy")?.toLowerCase() === "first" ? "first" : "all";

  const ruleTagRe = new RegExp(`<rule\\b(${ATTR_RUN})\\s*>([\\s\\S]*?)<\\/rule>`, "g");
  const ruleMatches = [...xml.matchAll(ruleTagRe)];
  const rules = ruleMatches.map(([, openAttrs, body], index) => {
    const id = attrValue(openAttrs, "id") ?? `rule-${index}`;
    const rawName = attrValue(openAttrs, "name");
    const name = rawName === undefined ? `Rule ${index + 1}` : unescapeXml(rawName);

    const conditionLogic: "AND" | "OR" = attrValue(openTag(body, "logical"), "operator")?.toUpperCase() === "OR" ? "OR" : "AND";

    const conditionTagRe = new RegExp(`<condition\\b(${ATTR_RUN})\\s*>([\\s\\S]*?)<\\/condition>`, "g");
    const conditions: ParsedCondition[] = [...body.matchAll(conditionTagRe)].map(([, condAttrs, condBody]) => parseCondition(condAttrs, condBody));

    const actionBody = body.match(/<action\b[^>]*>([\s\S]*?)<\/action>/)?.[1] ?? "";
    const setAttributesOf = (scope: string): ParsedSetAttribute[] => [...scope.matchAll(/<setattribute>([\s\S]*?)<\/setattribute>/g)].map(([, saBody]) => ({
      lhs: tagText(saBody, "lhs") ?? "",
      rhs: tagText(saBody, "rhs") ?? ""
    }));
    const setAttributes = setAttributesOf(actionBody);
    const distributionRecords: ParsedSetAttribute[][] = [...actionBody.matchAll(/<record>([\s\S]*?)<\/record>/g)].map(([, recordBody]) => setAttributesOf(recordBody));

    return { id, name, conditionLogic, conditions, group: parseGroup(body), setAttributes, distributionRecords };
  });

  return { hitPolicy, rules };
}

// ---- Writing rules ----
//
// What a rule's XML looks like, written the way the real admin center writes it: a percentage split as
// <upsertrecords> with queuedetails.queueid and queuedetails.percentage per record, a queue as
// assign_to.queue, classification outputs as setattribute (all confirmed against real data, see
// tests/ruleXml.test.ts). Conditions: one outer <logical> group, as in real data; an Or group nested inside
// it is written the same way, which hasn't been compared with a real rule yet.

export interface WritableCondition {
  operator: string;
  lhs: string;
  rhs?: string;
}

export interface WritableGroup {
  operator: "AND" | "OR";
  items: (WritableCondition | WritableGroup)[];
}

export type WritableAction =
  | { queueId: string }
  | { split: { queueId: string; percentage: number }[] }
  | { sets: { lhs: string; rhs: string }[] };

export interface WritableRule {
  id: string;
  name: string;
  conditions: WritableGroup;
  action: WritableAction;
}

const isWritableGroup = (item: WritableCondition | WritableGroup): item is WritableGroup => "items" in item;

function setAttributeXml(lhs: string, rhs: string, pad: string): string {
  return `${pad}<setattribute>\n${pad}  <lhs type="attribute">${escapeXml(lhs)}</lhs>\n${pad}  <rhs type="staticvalue">${escapeXml(rhs)}</rhs>\n${pad}</setattribute>`;
}

function groupXml(group: WritableGroup, pad: string): string {
  const items = group.items.map((item) => {
    if (isWritableGroup(item)) return groupXml(item, `${pad}  `);
    const inner = `${pad}  `;
    const rhs = item.rhs === undefined ? "" : `\n${inner}  <rhs type="staticvalue">${escapeXml(item.rhs)}</rhs>`;
    // Real data writes operator=">=" as it is, so only quotes and ampersands are escaped here.
    return `${inner}<condition operator="${item.operator.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">\n${inner}  <lhs type="attribute">${escapeXml(item.lhs)}</lhs>${rhs}\n${inner}</condition>`;
  });
  return `${pad}<logical operator="${group.operator}">\n${items.join("\n")}\n${pad}</logical>`;
}

function hasConditions(group: WritableGroup): boolean {
  return group.items.some((item) => !isWritableGroup(item) || hasConditions(item));
}

function actionXml(action: WritableAction, pad: string): string {
  const inner = `${pad}  `;
  if ("queueId" in action) return `${pad}<action>\n${setAttributeXml("assign_to.queue", action.queueId, inner)}\n${pad}</action>`;
  if ("sets" in action) return `${pad}<action>\n${action.sets.map((s) => setAttributeXml(s.lhs, s.rhs, inner)).join("\n")}\n${pad}</action>`;
  const record = (q: { queueId: string; percentage: number }) =>
    `${inner}      <record>\n${setAttributeXml("queuedetails.queueid", `{${q.queueId}}`, `${inner}        `)}\n${setAttributeXml("queuedetails.percentage", String(q.percentage), `${inner}        `)}\n${inner}      </record>`;
  return `${pad}<action>\n${inner}<upsertrecords>\n${inner}  <target>percentagebaseddistribution</target>\n${inner}  <records>\n${action.split.map(record).join("\n")}\n${inner}  </records>\n${inner}</upsertrecords>\n${pad}</action>`;
}

// One <rule> element, indented for a ruleset's <rules>. Groups without any condition are left out.
export function writeRuleXml(rule: WritableRule): string {
  const pad = "    ";
  const logical = hasConditions(rule.conditions) ? `${groupXml(prune(rule.conditions), `${pad}  `)}\n` : "";
  return `${pad}<rule id="${escapeXml(rule.id)}" name="${escapeXml(rule.name)}">\n${logical}${actionXml(rule.action, `${pad}  `)}\n${pad}</rule>`;
}

function prune(group: WritableGroup): WritableGroup {
  return { operator: group.operator, items: group.items.filter((item) => !isWritableGroup(item) || hasConditions(item)).map((item) => (isWritableGroup(item) ? prune(item) : item)) };
}

// The definition with its decision's hit policy set ("first" is Hit-first, "all" is Hit-all).
export function withHitPolicy(definition: string, hitPolicy: "first" | "all"): string {
  if (!/<decision\b/.test(definition)) throw new Error("The ruleset's rules can't be read.");
  return /<decision\b[^>]*\bhit-policy="/.test(definition)
    ? definition.replace(/(<decision\b[^>]*\bhit-policy=")[^"]*"/, `$1${hitPolicy}"`)
    : definition.replace(/<decision\b/, `<decision hit-policy="${hitPolicy}"`);
}
