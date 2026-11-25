// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ParsedCondition, ParsedGroup, ParsedRule, isParsedGroup, parseDecisionXml } from "../../visual-routing-tester/src/ruleXml";

// Rules in plain language, for the document. A ruleset's XML is read with Visual Routing Tester's
// parser (unchanged); this file only words the result. Record ids in a rule are replaced by the
// record's name when the snapshot has it.

export interface RuleLine {
  name: string;
  enabled: boolean;
  when: string;      // "Always", or the conditions
  then: string;      // what the rule does
}

export interface RulesetText {
  hitPolicy: "first" | "all";
  rules: RuleLine[];
}

const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
const GUID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPERATORS: Record<string, string> = {
  "==": "is", "=": "is", "eq": "is", "equals": "is", "!=": "is not", "<>": "is not", "ne": "is not",
  ">": "is more than", "<": "is less than", ">=": "is at least", "<=": "is at most",
  "contains": "contains", "not-contains": "doesn't contain", "doesnotcontain": "doesn't contain", "begins-with": "begins with", "ends-with": "ends with",
  "not-null": "has a value", "notnull": "has a value", "null": "has no value",
  "exact_match": "matches exactly", "closest_match": "matches closest", "in": "is one of", "not-in": "is not one of", "under": "is under", "above": "is above",
  "is_working": "is working", "custom_skill_match": "matches the custom skills of"
};

// "msdyn_ocliveworkitem.msdyn_customerlanguageid" -> "Customer language";
// "liveworkitemcontext.<workstream id>.IsIdentified" -> "IsIdentified".
export function attributeText(path: string, labels: Record<string, string> = {}): string {
  if (labels[path]) return labels[path];
  const parts = path.split(".").filter((p) => !GUID_PATH.test(p));
  const last = parts[parts.length - 1] ?? path;
  if (labels[last]) return labels[last];
  if (parts[0] === "liveworkitemcontext") return last;
  const plain = last.replace(/^msdyn_/, "").replace(/_msdyn_\w+$/, "").replace(/id$/, "");
  const known: Record<string, string> = {
    bookableresourcecharacteristic: "agent's skills", ocliveworkitemcharacteristic: "the conversation's required skills",
    availablecapacity: "available capacity", lastsessionassignedon: "last assignment time", lastsessionreleasedon: "time since last conversation",
    languages: "languages", customerlanguage: "customer language", capacityrequired: "required capacity", presencestatus: "presence",
    createdon: "creation time", modifiedon: "last change", priority: "priority", queueestimatedwaittime: "estimated wait time",
    estimatedwaittimeinminutes: "estimated wait time (minutes)", currentqueuesize: "queue size", lapsedwaittime: "time waited", allowedpresences: "allowed presences",
    basepresencestatus: "presence", priorityscore: "priority score"
  };
  return known[plain.toLowerCase()] ?? plain.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function valueText(raw: string | undefined, names: Map<string, string>): string {
  if (raw === undefined || raw === "") return "";
  const id = raw.replace(/[{}]/g, "").toLowerCase();
  // A record outside the snapshot (a specific account, say) is shown by its id.
  if (GUID.test(raw)) return names.has(id) ? `"${names.get(id)}"` : `record ${id}`;
  if (raw.startsWith("agent.") || raw.startsWith("msdyn_")) return attributeText(raw);
  return `"${raw}"`;
}

function conditionText(condition: ParsedCondition, names: Map<string, string>, labels: Record<string, string>): string {
  const subject = attributeText(condition.lhs, labels);
  const operator = OPERATORS[condition.operator.toLowerCase()] ?? condition.operator;
  const value = valueText(condition.rhs, names);
  return value ? `${subject} ${operator} ${value}${condition.unit ? ` ${condition.unit}` : ""}` : `${subject} ${operator}`;
}

// "overflow.waittimeoverflow" -> "wait time".
function overflowTrigger(lhs: string): string {
  const flag = lhs.replace(/^overflow\./i, "").replace(/overflow$/i, "");
  const known: Record<string, string> = {
    queuesize: "queue size", lapsedwaittime: "time waited",
    waittime: "wait time", estimatedwaittime: "estimated wait time", workitemlimit: "work item limit", workitemcount: "work item count",
    operatinghours: "operating hours", operatinghour: "operating hours", agentsunavailable: "no agents available", conversationlimit: "conversation limit"
  };
  return known[flag.toLowerCase()] ?? flag.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

// Conditions as they're nested: "A and (B or C)".
function groupText(group: ParsedGroup, names: Map<string, string>, labels: Record<string, string>, nested = false): string {
  const parts = group.items.map((item) => isParsedGroup(item) ? groupText(item, names, labels, true) : conditionText(item, names, labels)).filter(Boolean);
  const joined = parts.join(group.operator === "OR" ? " or " : " and ");
  return nested && parts.length > 1 ? `(${joined})` : joined;
}

function actionText(rule: ParsedRule, names: Map<string, string>, body: string): string {
  const name = (id: string) => names.get(id.replace(/[{}]/g, "").toLowerCase()) ?? id;
  if (rule.distributionRecords.length) {
    return `Share between ${rule.distributionRecords.map((record) => {
      const queue = record.find((s) => s.lhs === "queuedetails.queueid");
      const share = record.find((s) => s.lhs === "queuedetails.percentage");
      return `${queue ? `"${name(queue.rhs)}"` : "a queue"}${share ? ` (${share.rhs}%)` : ""}`;
    }).join(", ")}`;
  }
  const parts = rule.setAttributes.map((s) => {
    if (s.lhs === "assign_to.queue") return `Route to queue "${name(s.rhs)}"`;
    if (s.lhs === "assign_to.user" || s.lhs === "assign_to.agent") return `Route to agent "${name(s.rhs)}"`;
    if (/msdyn_overflowactionconfigid$/.test(s.lhs)) return `Overflow action "${name(s.rhs)}"`;
    if (/^overflow\.\w+overflow$/i.test(s.lhs)) return `When ${overflowTrigger(s.lhs)} overflows`;
    return `Set ${attributeText(s.lhs)} to ${valueText(s.rhs, names) || "nothing"}`;
  });
  // Assignment rules order the matching agents instead of setting values.
  const order = [...body.matchAll(/<orderby\b[^>]*?(descending="(true|false)")?[^>]*>([\s\S]*?)<\/orderby>/g)].map((m) => {
    const inner = m[3].replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean);
    const type = /type="([^"]+)"/.exec(m[0])?.[1];
    const what = type === "skill_match_count" ? "most matching skills" : inner.length ? attributeText(inner[0]) : type ?? "";
    return `${what}${m[2] === "true" && type !== "skill_match_count" ? " (highest first)" : ""}`;
  });
  if (order.length) parts.push(`Pick agents by ${order.join(", then ")}`);
  return parts.join("; ") || "No action";
}

function disabledIds(raw: string | undefined): Set<string> {
  if (!raw || !raw.trim()) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
  } catch { /* a plain list */ }
  return new Set(raw.split(/[,;\s]+/).filter(Boolean));
}

// A ruleset's rules in words. Null when the definition isn't a rule list this tool can read.
export function rulesetText(definition: string | undefined, disabledRules: string | undefined, names: Map<string, string>, labels: Record<string, string> = {}): RulesetText | null {
  const parsed = parseDecisionXml(definition ?? "");
  if (!parsed) return null;
  const disabled = disabledIds(disabledRules);
  const bodies = [...(definition ?? "").matchAll(/<rule\b[\s\S]*?<\/rule>/g)].map((m) => m[0]);
  return {
    hitPolicy: parsed.hitPolicy,
    rules: parsed.rules.map((rule, i) => ({
      name: rule.name,
      enabled: !disabled.has(rule.id),
      when: rule.conditions.length ? groupText(rule.group, names, labels) : "Always",
      then: actionText(rule, names, bodies[i] ?? "")
    }))
  };
}
