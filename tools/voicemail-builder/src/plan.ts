// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { canEditIntake, readIntakeRules } from "./intake";
import { Catalog, Issue, ParsedPlan, QueuePlan, ResolvedPlan, RowSpec, Settings, StagePlan, UserRecord } from "./model";
import { CONDITIONS, Condition, OverflowWanted, Stage, canEdit, describe, readRules } from "./overflow";
import { QUEUE_TYPE_LABELS, RECORD_QUEUE, VOICE_QUEUE } from "./schema";
import { COLUMN_BY_HEADER, normalizeHeader } from "./template";

// Turns the CSV and the page's settings into a plan per queue, with every problem found. Pure:
// validateCsv looks only at the file; resolvePlan matches it to what the environment holds.

const key = (s: string) => s.trim().toLowerCase();

const NUMBER_COLUMNS: [string, Condition][] = [["calls_waiting", "callsWaiting"], ["estimated_wait_minutes", "estimatedWait"], ["wait_time_seconds", "waitTime"]];

export function validateCsv(csv: ParsedCsv): ParsedPlan {
  const issues: Issue[] = [];
  const headers = csv.headers.map(normalizeHeader);
  if (!headers.includes("queue_name")) {
    issues.push({ severity: "error", message: "The file has no queue_name column. Start from the example: its first line must be the column headers." });
    return { rows: [], issues, rowCount: csv.records.length };
  }
  const unknown = csv.headers.filter((h, i) => h && !COLUMN_BY_HEADER.has(headers[i]));
  if (unknown.length) issues.push({ severity: "warning", message: `Ignored column${unknown.length > 1 ? "s" : ""} not in the template: ${unknown.join(", ")}.` });
  const duplicated = headers.filter((h, i) => h && headers.indexOf(h) !== i);
  if (duplicated.length) issues.push({ severity: "error", message: `Column${duplicated.length > 1 ? "s" : ""} listed twice: ${[...new Set(duplicated)].join(", ")}.` });

  const seen = new Map<string, number>();
  const rows: RowSpec[] = [];
  csv.records.forEach(({ line, cells }) => {
    const cell = (h: string) => { const i = headers.indexOf(h); return i >= 0 ? (cells[i] ?? "").trim() : ""; };
    const queueName = cell("queue_name");
    const error = (column: string, message: string) => issues.push({ severity: "error", line, column, queue: queueName || undefined, message });
    if (!queueName) { error("queue_name", "queue_name is empty. Every row needs the voice queue to set up voicemail for."); return; }
    if (seen.has(key(queueName))) { error("queue_name", `"${queueName}" is also on line ${seen.get(key(queueName))}. Each queue needs one row.`); return; }
    seen.set(key(queueName), line);

    const overflow: OverflowWanted[] = [];
    NUMBER_COLUMNS.forEach(([column, condition]) => {
      const raw = cell(column);
      if (!raw) return;
      if (!/^\d+$/.test(raw) || Number(raw) < 1) error(column, `"${raw}" isn't valid for ${column}. Use a whole number of 1 or more.`);
      else overflow.push({ condition, value: Number(raw) });
    });
    const hours = cell("out_of_hours");
    if (hours && !/^(yes|no)$/i.test(hours)) error("out_of_hours", `"${hours}" isn't valid for out_of_hours. Use Yes or No.`);
    else if (/^yes$/i.test(hours)) overflow.push({ condition: "outOfHours" });
    if (!overflow.length && !issues.some((i) => i.line === line)) error("calls_waiting", "No overflow condition. Fill in at least one of calls_waiting, estimated_wait_minutes, out_of_hours (Yes) or wait_time_seconds.");

    rows.push({
      line, queueName, overflow: overflow.sort((a, b) => Object.keys(CONDITIONS).indexOf(a.condition) - Object.keys(CONDITIONS).indexOf(b.condition)),
      voicemailWorkstreamName: cell("voicemail_workstream_name") || `${queueName} Voicemail`,
      voicemailQueueName: cell("voicemail_queue_name") || `${queueName} Voicemail Queue`,
      members: [...new Set(cell("members").split(/[|;,]/).map((m) => m.trim()).filter(Boolean).map((m) => m.toLowerCase()))]
    });
  });
  if (!csv.records.length) issues.push({ severity: "error", message: "The file has a header line but no rows." });
  return { rows, issues, rowCount: csv.records.length };
}

export function resolvePlan(parsed: ParsedPlan, catalog: Catalog, settings: Settings): ResolvedPlan {
  const issues: Issue[] = [...parsed.issues];
  if (!catalog.hub) issues.push({ severity: "error", message: "The platform's voicemail record routing (the \"Voicemail routing hub\") wasn't found, so voicemails can't be routed to new workstreams in this environment." });
  else if (!catalog.hub.rulesetId) issues.push({ severity: "error", message: "The voicemail record routing has no intake ruleset, so no intake rule can be added. Open Voicemail under record routing in the admin center once, then upload again." });
  else if (!canEditIntake(catalog.hub.definition)) issues.push({ severity: "error", message: "The voicemail intake rules can't be read, so no intake rule can be added." });
  if (!catalog.voicemailActionId) issues.push({ severity: "error", message: "This environment has no Voicemail overflow action yet. Set Voicemail as the overflow action on one queue in the admin center once, then upload again." });

  const intakeRules = readIntakeRules(catalog.hub?.definition);
  const catchAll = intakeRules.find((r) => r.unconditional);
  const usedNames = new Map<string, number>();

  const queues: QueuePlan[] = parsed.rows.map((row) => {
    const before = issues.length;
    const error = (column: string | undefined, message: string) => issues.push({ severity: "error", line: row.line, column, queue: row.queueName, message });
    const warning = (column: string | undefined, message: string) => issues.push({ severity: "warning", line: row.line, column, queue: row.queueName, message });
    const byName = (name: string) => catalog.queues.filter((q) => key(q.name) === key(name));

    // The voice queue.
    const matches = byName(row.queueName);
    const queue = matches.length === 1 ? matches[0] : undefined;
    if (!matches.length) error("queue_name", `No active advanced queue named "${row.queueName}" exists in this environment.`);
    else if (matches.length > 1) error("queue_name", `${matches.length} queues are named "${row.queueName}", so it's not clear which one is meant.`);
    else if (queue!.type !== VOICE_QUEUE) error("queue_name", `"${row.queueName}" is a ${QUEUE_TYPE_LABELS[queue!.type] ?? "non-voice"} queue. Voicemail overflow is for voice queues.`);

    // The voicemail queue and workstream: reused if they exist, but never shared between rows.
    [["voicemail_queue_name", row.voicemailQueueName], ["voicemail_workstream_name", row.voicemailWorkstreamName]].forEach(([column, name]) => {
      const k = `${column}:${key(name)}`;
      if (usedNames.has(k)) error(column, `"${name}" is also used on line ${usedNames.get(k)}. Each queue gets its own voicemail queue and workstream.`);
      else usedNames.set(k, row.line);
    });
    if (key(row.voicemailQueueName) === key(row.queueName)) error("voicemail_queue_name", "The voicemail queue must be another queue than the voice queue.");
    const vmQueues = byName(row.voicemailQueueName);
    const voicemailQueue = vmQueues.length === 1 ? vmQueues[0] : undefined;
    if (vmQueues.length > 1) error("voicemail_queue_name", `${vmQueues.length} queues are named "${row.voicemailQueueName}", so it's not clear which one to use.`);
    else if (voicemailQueue && voicemailQueue.type !== RECORD_QUEUE && key(row.voicemailQueueName) !== key(row.queueName)) error("voicemail_queue_name", `"${row.voicemailQueueName}" exists, but it's a ${QUEUE_TYPE_LABELS[voicemailQueue.type] ?? "non-record"} queue. Voicemails can only go to a Record queue.`);

    const vmWorkstreams = catalog.workstreams.filter((w) => key(w.name) === key(row.voicemailWorkstreamName));
    const voicemailWorkstream = vmWorkstreams.length === 1 ? vmWorkstreams[0] : undefined;
    if (vmWorkstreams.length > 1) error("voicemail_workstream_name", `${vmWorkstreams.length} workstreams are named "${row.voicemailWorkstreamName}", so it's not clear which one to use.`);
    else if (voicemailWorkstream && (!voicemailWorkstream.record || voicemailWorkstream.hubId !== catalog.hub?.id)) error("voicemail_workstream_name", `"${row.voicemailWorkstreamName}" exists, but it isn't a voicemail record workstream. Use another name.`);
    else if (voicemailWorkstream && voicemailQueue && voicemailWorkstream.defaultQueueId !== voicemailQueue.id) warning("voicemail_workstream_name", `"${row.voicemailWorkstreamName}" already exists with another fallback queue. It's reused as it is, so voicemails land in its own fallback queue, not "${row.voicemailQueueName}".`);
    else if (voicemailWorkstream && !voicemailQueue) warning("voicemail_workstream_name", `"${row.voicemailWorkstreamName}" already exists and is reused as it is, so the new queue "${row.voicemailQueueName}" won't be its fallback queue.`);

    // Members.
    const members: UserRecord[] = [];
    row.members.forEach((m) => {
      const bySignIn = catalog.users.filter((u) => u.signIn.toLowerCase() === m);
      const found = bySignIn.length ? bySignIn : catalog.users.filter((u) => u.email?.toLowerCase() === m);
      if (!found.length) error("members", `No user with sign-in name or email "${m}" exists in this environment.`);
      else if (found.length > 1) error("members", `${found.length} users match "${m}". Use their sign-in name.`);
      else if (found[0].disabled) error("members", `${m} (${found[0].fullName}) is a disabled user.`);
      else if (!voicemailQueue?.memberIds.includes(found[0].id)) members.push(found[0]);
    });
    if (!row.members.length && !voicemailQueue) warning("members", `"${row.voicemailQueueName}" gets no members, so nobody receives the voicemails until agents are added.`);

    // The intake rule.
    let intake: QueuePlan["intake"] = "add";
    const intakeRule = queue ? intakeRules.find((r) => r.queueId === queue.id) : undefined;
    if (intakeRule) {
      if (voicemailWorkstream && intakeRule.workstreamId === voicemailWorkstream.id) intake = "keep";
      else if (settings.existingRules === "overwrite") { intake = "update"; warning(undefined, `The intake rule "${intakeRule.name}" sends this queue's voicemails to another workstream. It's changed to "${row.voicemailWorkstreamName}".`); }
      else { intake = "keep"; warning(undefined, `The intake rule "${intakeRule.name}" already sends this queue's voicemails to another workstream. It's left as it is (Skip), so the new workstream gets none of them.`); }
    } else if (catchAll) {
      error(undefined, `The voicemail intake rule "${catchAll.name}" has no condition and comes first, so a rule for this queue after it would never apply. Check the voicemail intake rules in the admin center.`);
    }

    // The overflow rules, per stage.
    const stages: StagePlan[] = (["prequeue", "inqueue"] as Stage[]).map((stage) => {
      const wanted = row.overflow.filter((w) => CONDITIONS[w.condition].stage === stage);
      const ruleset = queue ? queue[stage] : undefined;
      const plan: StagePlan = { stage, ruleset, changes: [], skipped: [] };
      if (!wanted.length || !queue) return plan;
      if (ruleset && !canEdit(ruleset.definition)) { error(undefined, `The overflow rules of "${ruleset.name}" can't be read, so they can't be changed.`); return plan; }
      const contracts = stage === "prequeue" ? [catalog.contracts.prequeueInput, catalog.contracts.prequeueOutput] : [catalog.contracts.inqueueInput, catalog.contracts.inqueueOutput];
      if (!ruleset && contracts.some((c) => !c)) { error(undefined, `The platform's ${stage === "prequeue" ? "queue" : "in-queue"} overflow contracts weren't found, so no overflow rules can be created.`); return plan; }
      const existing = readRules(ruleset?.definition);
      wanted.forEach((w) => {
        const rule = existing.find((r) => r.condition === w.condition);
        if (!rule) { plan.changes.push({ kind: "add", wanted: w }); return; }
        const isVoicemail = rule.actionId === catalog.voicemailActionId;
        if (isVoicemail && (w.value === undefined || String(w.value) === rule.value)) return; // already as wanted
        if (isVoicemail) { plan.changes.push({ kind: "update", wanted: w, rule, overwrote: false }); return; }
        if (settings.existingRules === "overwrite") {
          plan.changes.push({ kind: "update", wanted: w, rule, overwrote: true });
          warning(undefined, `The overflow rule "${rule.name}" (${CONDITIONS[w.condition].label}) has another action. It's changed to voicemail: ${describe(w)}.`);
        } else {
          plan.skipped.push(CONDITIONS[w.condition].label);
          warning(undefined, `The overflow rule "${rule.name}" (${CONDITIONS[w.condition].label}) has another action. It's left as it is (Skip).`);
        }
      });
      return plan;
    });
    if (queue && row.overflow.some((w) => w.condition === "outOfHours") && !queue.hasOperatingHours) warning("out_of_hours", `"${row.queueName}" has no operating hours, so it's never out of hours and this rule never applies.`);

    const blocked = issues.slice(before).some((i) => i.severity === "error") || issues.some((i) => i.severity === "error" && i.line === undefined);
    return { line: row.line, row, queue, voicemailQueue, voicemailWorkstream, members, intake, intakeRule, stages, blocked };
  });

  return { settings, queues, issues, rowCount: parsed.rowCount, catalog };
}

// Whether a planned queue changes anything at all.
export function hasWork(q: QueuePlan): boolean {
  return !q.voicemailQueue || !q.voicemailWorkstream || q.members.length > 0 || q.intake !== "keep" || q.stages.some((s) => s.changes.length > 0);
}

export function memberLabel(u: UserRecord): string {
  return `${u.fullName} (${u.signIn})`;
}

