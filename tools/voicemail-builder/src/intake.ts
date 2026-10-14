// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Reads and writes the voicemail routing hub's intake rules (the "Voicemail decision ruleset"). The XML
// of a rule is exactly what the admin center wrote for "missed conversation's queue equals Contoso Flags
// Sales → workstream Contoso Flags Sales Voicemail" (see tests/intake.test.ts). Pure.

export const QUEUE_PATH = "msdyn_ocvoicemail.msdyn_missedconversationid_msdyn_ocvoicemail.msdyn_cdsqueueid_msdyn_ocliveworkitem.queueid";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function intakeRuleXml(id: string, name: string, queueId: string, workstreamId: string): string {
  return `    <rule id="${id}" name="${escapeXml(name)}">
      <logical operator="AND">
        <logical operator="AND">
          <condition operator="==">
            <lhs type="attribute">${QUEUE_PATH}</lhs>
            <rhs type="staticvalue">{${queueId}}</rhs>
          </condition>
        </logical>
      </logical>
      <action>
        <setattribute>
          <lhs type="attribute">action.unifiedrouting</lhs>
          <rhs type="staticvalue">{${workstreamId}}</rhs>
        </setattribute>
      </action>
    </rule>`;
}

export interface IntakeRule {
  id: string;
  name: string;
  queueId?: string;          // the missed conversation's queue it matches, when that's its condition
  workstreamId?: string;     // the workstream it sends voicemails to
  unconditional: boolean;    // a rule without any condition matches every voicemail
  xml: string;
}

const guid = (s: string | undefined) => s?.replace(/[{}]/g, "").toLowerCase();

export function readIntakeRules(definition: string | undefined): IntakeRule[] {
  if (!definition) return [];
  return [...definition.matchAll(/[ \t]*<rule\s+id="([^"]*)"(?:\s+name="([^"]*)")?[^>]*>[\s\S]*?<\/rule>/g)].map((m) => {
    const xml = m[0];
    const queue = new RegExp(`<lhs type="attribute">${QUEUE_PATH.replace(/\./g, "\\.")}</lhs>\\s*<rhs type="staticvalue">([^<]*)</rhs>`).exec(xml)?.[1];
    const workstream = /<lhs type="attribute">action\.unifiedrouting<\/lhs>\s*<rhs type="staticvalue">([^<]*)<\/rhs>/.exec(xml)?.[1];
    return { id: m[1], name: m[2] ?? "", queueId: guid(queue), workstreamId: guid(workstream), unconditional: !/<condition\b/.test(xml), xml };
  });
}

// The hub's ruleset is "first match": the first rule whose condition holds decides the workstream.
export function emptyIntakeDefinition(): string {
  return "<decision hit-policy=\"first\" version=\"1\">\n  <rules>\n  </rules>\n</decision>";
}

export function canEditIntake(definition: string | undefined): boolean {
  if (!definition || !definition.trim()) return true;
  return /<decision\b/.test(definition) && (/<\/rules>/.test(definition) || /<rules\s*\/>/.test(definition));
}

// Adds a rule at the end, or replaces an existing rule (keeping its id and name) when `replace` is given.
export function setIntakeRule(definition: string | undefined, rule: { id: string; name: string; queueId: string; workstreamId: string }, replace?: IntakeRule): string {
  if (!canEditIntake(definition)) throw new Error("The voicemail intake rules can't be read, so no rule can be added.");
  let result = definition && definition.trim() ? definition : emptyIntakeDefinition();
  if (replace) return result.replace(replace.xml, intakeRuleXml(replace.id, replace.name, rule.queueId, rule.workstreamId));
  if (!/<\/rules>/.test(result)) result = result.replace(/<rules\s*\/>/, "<rules>\n  </rules>");
  const at = result.lastIndexOf("</rules>");
  const before = result.slice(0, at).replace(/[ \t]*$/, "");
  return `${before}${before.endsWith("\n") ? "" : "\n"}${intakeRuleXml(rule.id, rule.name, rule.queueId, rule.workstreamId)}\n  ${result.slice(at)}`;
}
