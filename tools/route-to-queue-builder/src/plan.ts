// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { Catalog, Issue, ParsedPlan, ResolvedPlan, ResolvedRule, RuleSpec, Settings, WorkstreamPlan } from "./model";
import { canAppend, existingRules } from "./rules";
import { QUEUE_TYPE_LABELS, TEXT_VARIABLE, VARIABLE_TYPE_LABELS, VOICE_QUEUE } from "./schema";
import { COLUMNS, COLUMN_BY_HEADER, normalizeHeader } from "./template";

// Turns the CSV and the page's settings into a plan per workstream, with every problem found. Pure:
// validateCsv looks only at the file; resolvePlan matches it to what the environment holds.

// Letters, digits and underscores, starting with a letter, like the context variables the admin
// center and Copilot Studio create.
export const VARIABLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const key = (s: string) => s.trim().toLowerCase();

export function validateCsv(csv: ParsedCsv): ParsedPlan {
  const issues: Issue[] = [];
  const headers = csv.headers.map(normalizeHeader);
  const missing = COLUMNS.filter((c) => !headers.includes(c.header)).map((c) => c.header);
  if (missing.length) {
    issues.push({ severity: "error", message: `The file has no ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}. Start from the example: its first line must be the column headers.` });
    return { rules: [], issues, rowCount: csv.records.length };
  }
  const unknown = csv.headers.filter((h, i) => h && !COLUMN_BY_HEADER.has(headers[i]));
  if (unknown.length) issues.push({ severity: "warning", message: `Ignored column${unknown.length > 1 ? "s" : ""} not in the template: ${unknown.join(", ")}.` });
  const duplicated = headers.filter((h, i) => h && headers.indexOf(h) !== i);
  if (duplicated.length) issues.push({ severity: "error", message: `Column${duplicated.length > 1 ? "s" : ""} listed twice: ${[...new Set(duplicated)].join(", ")}.` });

  const rules: RuleSpec[] = [];
  csv.records.forEach(({ line, cells }) => {
    const cell = (h: string) => { const i = headers.indexOf(h); return i >= 0 ? (cells[i] ?? "").trim() : ""; };
    const workstream = cell("workstream_name");
    let complete = true;
    COLUMNS.forEach((c) => {
      if (!cell(c.header)) { issues.push({ severity: "error", line, column: c.header, workstream: workstream || undefined, message: `${c.header} is empty. Every row needs a workstream, a rule name, a menu value and a queue.` }); complete = false; }
    });
    if (complete) rules.push({ line, workstream, ruleName: cell("rule_name"), menuValue: cell("menu_value"), queueName: cell("queue_name") });
  });
  if (!csv.records.length) issues.push({ severity: "error", message: "The file has a header line but no rows." });
  return { rules, issues, rowCount: csv.records.length };
}

// Problems with what's entered on the page, independent of the file.
export function settingsIssues(settings: Settings): Issue[] {
  const variable = settings.variable.trim();
  if (!variable) return [{ severity: "error", column: "context variable", message: "Enter the name of the context variable the rules compare, e.g. SelectedMenuItem." }];
  if (!VARIABLE_PATTERN.test(variable)) return [{ severity: "error", column: "context variable", message: `"${variable}" isn't a valid context variable name. Use letters, digits and underscores, starting with a letter.` }];
  return [];
}

export function resolvePlan(parsed: ParsedPlan, catalog: Catalog, settings: Settings): ResolvedPlan {
  const issues: Issue[] = [...settingsIssues(settings), ...parsed.issues];
  const variable = settings.variable.trim();
  const defaultName = settings.defaultRulesetName.trim();
  if (!catalog.outputContractId) issues.push({ severity: "error", message: "The platform's \"Demand queue identification output contract\" wasn't found, so no route-to-queue ruleset can be created in this environment." });

  const groups = new Map<string, RuleSpec[]>();
  parsed.rules.forEach((r) => groups.set(key(r.workstream), [...(groups.get(key(r.workstream)) ?? []), r]));

  const workstreams: WorkstreamPlan[] = [...groups.values()].map((rows) => {
    const name = rows[0].workstream;
    const lines = rows.map((r) => r.line);
    const before = issues.length;
    const error = (line: number | undefined, column: string | undefined, message: string) => issues.push({ severity: "error", line, column, workstream: name, message });
    const warning = (line: number | undefined, column: string | undefined, message: string) => issues.push({ severity: "warning", line, column, workstream: name, message });

    const matches = catalog.workstreams.filter((w) => key(w.name) === key(name));
    const workstream = matches.length === 1 ? matches[0] : undefined;
    if (!matches.length) error(lines[0], "workstream_name", `No active workstream named "${name}" exists in this environment.`);
    if (matches.length > 1) error(lines[0], "workstream_name", `${matches.length} workstreams are named "${name}", so it's not clear which one is meant.`);
    if (workstream && !workstream.routingContractId) error(lines[0], "workstream_name", `"${name}" has no routing contract, so it can't have routing rules. Open and save it in the admin center, then upload again.`);

    // The context variable: used if it's there, created if it isn't.
    let createVariable = false;
    if (workstream && variable) {
      const exact = workstream.variables.find((v) => v.name === variable);
      const otherCase = workstream.variables.find((v) => v.name !== variable && key(v.name) === key(variable));
      if (exact && exact.dataType !== TEXT_VARIABLE) error(lines[0], "workstream_name", `"${name}" has a context variable "${variable}" of type ${VARIABLE_TYPE_LABELS[exact.dataType] ?? "other than text"}. The rules compare text, so it must be a text variable.`);
      else if (!exact && otherCase) error(lines[0], "workstream_name", `"${name}" has a context variable "${otherCase.name}". Names are case-sensitive in rules: enter it exactly like that, or use another name.`);
      else if (!exact) createVariable = true;
    }

    // The route-to-queue ruleset: added to if there is one, created otherwise.
    const routing = workstream?.routing;
    const ruleset = routing?.queueRuleset;
    const mode = ruleset ? "append" : routing ? "newRuleset" : "newConfig";
    const rulesetName = ruleset?.name ?? defaultName;
    if (workstream?.routingInactive) error(lines[0], "workstream_name", `"${name}" has routing configurations, but none is active. Activate one in the admin center, then upload again.`);
    if (routing && routing.queueRulesets > 1) error(lines[0], "workstream_name", `"${name}" has ${routing.queueRulesets} route-to-queue rulesets, which this tool doesn't expect. Check its routing in the admin center.`);
    if (workstream && !ruleset && !defaultName) error(lines[0], "workstream_name", `"${name}" has no route-to-queue ruleset yet. Enter a default ruleset name on the Upload step to create one.`);
    if (ruleset && !canAppend(ruleset.definition)) error(lines[0], "workstream_name", `The rules of "${ruleset.name}" on "${name}" can't be read, so no rules can be added to it.`);

    const existing = ruleset ? existingRules(ruleset.definition, variable) : [];
    const ruleNames = new Map(existing.map((r) => [key(r.name), "the existing ruleset"]));
    const values = new Map<string, string>();
    existing.forEach((r) => r.values.forEach((v) => values.set(v, `the existing rule "${r.name}"`)));

    const rules: ResolvedRule[] = rows.map((row) => {
      const where = ruleNames.get(key(row.ruleName));
      if (where) error(row.line, "rule_name", `A rule named "${row.ruleName}" is already in ${where} of "${name}". Rule names must be unique within the ruleset.`);
      else ruleNames.set(key(row.ruleName), `line ${row.line}`);
      const sameValue = values.get(row.menuValue);
      if (sameValue) warning(row.line, "menu_value", `"${row.menuValue}" is also the value of ${sameValue}. Both rules match the same conversations.`);
      else values.set(row.menuValue, `the rule on line ${row.line}`);
      if (row.menuValue !== row.menuValue.trim() || /\s{2,}/.test(row.menuValue)) warning(row.line, "menu_value", "The value has extra spaces. It's compared exactly as written.");

      const queues = catalog.queues.filter((q) => key(q.name) === key(row.queueName));
      let queueId: string | undefined;
      if (!queues.length) error(row.line, "queue_name", `No active advanced queue named "${row.queueName}" exists in this environment.`);
      else if (queues.length > 1) error(row.line, "queue_name", `${queues.length} advanced queues are named "${row.queueName}", so it's not clear which one is meant.`);
      else if (workstream && workstream.voice !== (queues[0].type === VOICE_QUEUE)) error(row.line, "queue_name", `"${row.queueName}" is a ${QUEUE_TYPE_LABELS[queues[0].type] ?? "different"} queue, which doesn't take work from ${workstream.voice ? "a voice" : "this"} workstream.`);
      else queueId = queues[0].id;
      return { ...row, queueId };
    });

    const blocked = issues.slice(before).some((i) => i.severity === "error");
    return { name: workstream?.name ?? name, lines, workstream, createVariable, mode, rulesetName, rules, blocked };
  });

  return { settings, workstreams, issues, rowCount: parsed.rowCount, outputContractId: catalog.outputContractId };
}
