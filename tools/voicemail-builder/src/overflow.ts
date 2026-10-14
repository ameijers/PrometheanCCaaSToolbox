// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Reads and writes a queue's overflow rules (msdyn_rulesetdefinition of its queue_prequeue_ and
// queue_inqueue_ rulesets). The XML of each condition is exactly what the admin center wrote for
// "Contoso Parts Main" and "Contoso Sales Support Overflow" (see tests/overflow.test.ts). Pure.

export type Condition = "callsWaiting" | "estimatedWait" | "outOfHours" | "waitTime";
export type Stage = "prequeue" | "inqueue";

export interface ConditionDef {
  stage: Stage;
  flag: string;              // the overflow.<flag> the rule sets: which condition it is
  label: string;
  attribute?: string;        // queue_prequeue.<x> / queue_inqueue.<x>
}

export const CONDITIONS: Record<Condition, ConditionDef> = {
  estimatedWait: { stage: "prequeue", flag: "estimatedwaittimeoverflow", label: "Estimated wait time", attribute: "queue_prequeue.estimatedwaittimeinminutes" },
  callsWaiting: { stage: "prequeue", flag: "queuesizeoverflow", label: "Calls waiting", attribute: "queue_prequeue.currentqueuesize" },
  outOfHours: { stage: "prequeue", flag: "operatinghouroverflow", label: "Out of operating hours", attribute: "queue_prequeue.iswithinoperatinghour" },
  waitTime: { stage: "inqueue", flag: "lapsedwaittimeoverflow", label: "Wait time", attribute: "queue_inqueue.lapsedwaittime" }
};

export interface OverflowWanted {
  condition: Condition;
  value?: number;            // the threshold; none for out of hours
}

export function describe(w: OverflowWanted): string {
  if (w.condition === "outOfHours") return "Out of operating hours";
  if (w.condition === "callsWaiting") return `${w.value} or more calls waiting`;
  if (w.condition === "estimatedWait") return `Estimated wait ${w.value} min or more`;
  return `Waited ${w.value} s or more`;
}

function conditionXml(w: OverflowWanted, indent: string): string {
  const def = CONDITIONS[w.condition];
  if (w.condition === "waitTime") {
    // The admin center writes the in-queue conditions without a logical wrapper.
    return `${indent}<condition operator="not-null">
${indent}  <lhs type="attribute">${def.attribute}</lhs>
${indent}</condition>
${indent}<condition operator=">=">
${indent}  <lhs type="attribute">${def.attribute}</lhs>
${indent}  <rhs type="staticvalue" unit="seconds">${w.value}</rhs>
${indent}</condition>`;
  }
  const compare = w.condition === "outOfHours"
    ? `<condition operator="==">
${indent}    <lhs type="attribute">${def.attribute}</lhs>
${indent}    <rhs type="staticvalue">false</rhs>
${indent}  </condition>`
    : `<condition operator=">=">
${indent}    <lhs type="attribute">${def.attribute}</lhs>
${indent}    <rhs type="staticvalue">${w.value}</rhs>
${indent}  </condition>`;
  return `${indent}<logical operator="AND">
${indent}  <condition operator="not-null">
${indent}    <lhs type="attribute">${def.attribute}</lhs>
${indent}  </condition>
${indent}  ${compare}
${indent}</logical>`;
}

export function ruleXml(id: string, name: string, w: OverflowWanted, voicemailActionId: string): string {
  return `    <rule id="${id}" name="${name}">
      <action>
        <setattribute>
          <lhs type="attribute">overflow.${CONDITIONS[w.condition].flag}</lhs>
          <rhs type="staticvalue">true</rhs>
        </setattribute>
        <setattribute>
          <lhs type="attribute">overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs>
          <rhs type="staticvalue">{${voicemailActionId}}</rhs>
        </setattribute>
      </action>
${conditionXml(w, "      ")}
    </rule>`;
}

export interface ExistingOverflowRule {
  id: string;
  name: string;
  condition?: Condition;
  actionId?: string;          // the overflow action it points to
  value?: string;             // its threshold, as written
  xml: string;
}

export function readRules(definition: string | undefined): ExistingOverflowRule[] {
  if (!definition) return [];
  return [...definition.matchAll(/[ \t]*<rule\s+id="([^"]*)"(?:\s+name="([^"]*)")?[^>]*>[\s\S]*?<\/rule>/g)].map((m) => {
    const xml = m[0];
    const flag = /<lhs type="attribute">overflow\.([a-z]+)<\/lhs>/.exec(xml)?.[1];
    const condition = (Object.keys(CONDITIONS) as Condition[]).find((c) => CONDITIONS[c].flag === flag);
    const actionId = /msdyn_overflowactionconfigid<\/lhs>\s*<rhs type="staticvalue">\{?([0-9a-fA-F-]{36})\}?<\/rhs>/.exec(xml)?.[1]?.toLowerCase();
    const value = /<condition operator="(?:>=|==)">\s*<lhs type="attribute">[^<]*<\/lhs>\s*<rhs type="staticvalue"[^>]*>([^<]*)<\/rhs>/.exec(xml)?.[1];
    return { id: m[1], name: m[2] ?? "", condition, actionId, value, xml };
  });
}

export function emptyDefinition(): string {
  return "<decision hit-policy=\"all\" version=\"1\">\n  <rules>\n  </rules>\n</decision>";
}

export function canEdit(definition: string | undefined): boolean {
  if (!definition || !definition.trim()) return true;
  return /<decision\b/.test(definition) && (/<\/rules>/.test(definition) || /<rules\s*\/>/.test(definition));
}

export type RuleChange =
  | { kind: "add"; wanted: OverflowWanted }
  | { kind: "update"; wanted: OverflowWanted; rule: ExistingOverflowRule; overwrote: boolean };

// The next free "RuleN" name, as the admin center names overflow rules.
function nextName(taken: string[]): () => string {
  let n = Math.max(0, ...taken.map((t) => Number(/^Rule(\d+)$/.exec(t)?.[1] ?? 0)));
  return () => `Rule${++n}`;
}

// Applies the changes to a definition: updated rules keep their id and name, added rules go at the end.
export function applyChanges(definition: string | undefined, changes: RuleChange[], voicemailActionId: string, newId: () => string): { definition: string; ruleIds: string[] } {
  if (!canEdit(definition)) throw new Error("The overflow rules can't be read, so they can't be changed.");
  let result = definition && definition.trim() ? definition : emptyDefinition();
  if (!/<\/rules>/.test(result)) result = result.replace(/<rules\s*\/>/, "<rules>\n  </rules>");
  const ruleIds: string[] = [];
  const name = nextName(readRules(result).map((r) => r.name));
  const added: string[] = [];
  changes.forEach((c) => {
    if (c.kind === "update") {
      result = result.replace(c.rule.xml, ruleXml(c.rule.id, c.rule.name, c.wanted, voicemailActionId));
      ruleIds.push(c.rule.id);
    } else {
      const id = newId();
      added.push(ruleXml(id, name(), c.wanted, voicemailActionId));
      ruleIds.push(id);
    }
  });
  if (added.length) {
    const at = result.lastIndexOf("</rules>");
    const before = result.slice(0, at).replace(/[ \t]*$/, "");
    result = `${before}${before.endsWith("\n") ? "" : "\n"}${added.join("\n")}\n  ${result.slice(at)}`;
  }
  return { definition: result, ruleIds };
}
