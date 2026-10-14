// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Reads and writes the rules of a route-to-queue ruleset (msdyn_rulesetdefinition). The XML a new rule
// gets is exactly what the admin center wrote for "<variable> equals <value> → route to <queue>". Pure.

export interface RuleToWrite {
  id: string;
  name: string;
  variable: string;
  value: string;
  queueId: string;
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function ruleXml(rule: RuleToWrite): string {
  return `    <rule id="${rule.id}" name="${escapeXml(rule.name)}">
      <logical operator="AND">
        <logical operator="AND">
          <condition operator="==">
            <lhs type="attribute">liveworkitemcontext.${rule.variable}</lhs>
            <rhs type="staticvalue">${escapeXml(rule.value)}</rhs>
          </condition>
        </logical>
      </logical>
      <action>
        <setattribute>
          <lhs type="attribute">assign_to.queue</lhs>
          <rhs type="staticvalue">${rule.queueId}</rhs>
        </setattribute>
      </action>
    </rule>`;
}

// A ruleset without any rules yet. "all" is what the admin center writes for route-to-queue.
export function emptyDefinition(): string {
  return "<decision hit-policy=\"all\" version=\"1\">\n  <rules>\n  </rules>\n</decision>";
}

// Whether rules can be added to this definition: empty, or a decision with a rules element.
export function canAppend(definition: string | undefined): boolean {
  if (!definition || !definition.trim()) return true;
  return /<decision\b/.test(definition) && (/<\/rules>/.test(definition) || /<rules\s*\/>/.test(definition));
}

// Adds the rules after the existing ones, keeping everything else as it was.
export function appendRules(definition: string | undefined, rules: RuleToWrite[]): string {
  if (!canAppend(definition)) throw new Error("The ruleset's rules can't be read, so no rules can be added to it.");
  let base = definition && definition.trim() ? definition : emptyDefinition();
  if (!/<\/rules>/.test(base)) base = base.replace(/<rules\s*\/>/, "<rules>\n  </rules>");
  const at = base.lastIndexOf("</rules>");
  const before = base.slice(0, at).replace(/[ \t]*$/, "");
  const newline = before.endsWith("\n") ? "" : "\n";
  return `${before}${newline}${rules.map(ruleXml).join("\n")}\n  ${base.slice(at)}`;
}

export interface ExistingRule {
  id: string;
  name: string;
  // The values this rule compares the given context variable with (equals), if any.
  values: string[];
}

export function existingRules(definition: string | undefined, variable: string): ExistingRule[] {
  if (!definition) return [];
  const rules: ExistingRule[] = [];
  const pattern = /<rule\s+id="([^"]*)"(?:\s+name="([^"]*)")?[^>]*>([\s\S]*?)<\/rule>/g;
  for (const m of definition.matchAll(pattern)) {
    const values: string[] = [];
    const condition = /<condition operator="=="\s*>\s*<lhs type="attribute">liveworkitemcontext\.([^<]+)<\/lhs>\s*<rhs type="staticvalue">([^<]*)<\/rhs>/g;
    for (const c of m[3].matchAll(condition)) if (c[1] === variable) values.push(unescapeXml(c[2]));
    rules.push({ id: m[1], name: unescapeXml(m[2] ?? ""), values });
  }
  return rules;
}

export function ruleIds(definition: string | undefined): string[] {
  return definition ? [...definition.matchAll(/<rule\s+id="([^"]*)"/g)].map((m) => m[1]) : [];
}
