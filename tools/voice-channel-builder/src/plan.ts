// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { BuilderSource } from "../../voice-workstream-builder/src/dataSource";
import { ExecuteProgress, executePlan } from "../../voice-workstream-builder/src/execute";
import { Catalog, Issue, ParsedPlan, ResolvedPlan, ResolvedWorkstream, WorkstreamResult, WorkstreamSpec } from "../../voice-workstream-builder/src/model";
import { resolveChannels } from "../../voice-workstream-builder/src/resolve";
import { Row, readChannel } from "../../voice-workstream-builder/src/validate";
import { CHANNEL_COLUMNS, COLUMN_BY_HEADER, normalizeHeader } from "./template";

// Adds voice channels to workstreams that already exist. Each channel is read, checked and created
// exactly as Voice Workstream Builder does it (its verified row reader, resolution, payloads and create
// engine); this file only adds what's specific: the workstream must already exist and be an active
// inbound voice workstream, and nothing but channels (with their language setting and voice) is created.

const PHONE_HEADER = "phone_number";

// The workstream settings a WorkstreamSpec carries aren't used: the workstream exists, so the create
// engine skips it (existingId) and only creates the channels.
function placeholder(name: string): Omit<WorkstreamSpec, "channels" | "lines" | "key"> {
  return {
    name, direction: "Inbound", workDistribution: "Push", capacityFormat: "Profile", capacityUnits: 30, presences: [],
    notification: "Screen pop with timeout", agentAffinity: false, restrictRecordingDownload: false, restrictTranscriptDownload: false
  };
}

export function validateChannels(csv: ParsedCsv): ParsedPlan {
  const issues: Issue[] = [];
  const headers = csv.headers.map(normalizeHeader);
  for (const required of ["workstream_name", "channel_name"]) {
    if (!headers.includes(required)) {
      issues.push({ severity: "error", message: `The file has no ${required} column. Start from the example: its first line must be the column headers.` });
      return { workstreams: [], issues, rowCount: csv.records.length };
    }
  }
  const unknown = csv.headers.filter((h, i) => h && !COLUMN_BY_HEADER.has(headers[i]));
  if (unknown.length) issues.push({ severity: "warning", message: `Ignored column${unknown.length > 1 ? "s" : ""} not in the template: ${unknown.join(", ")}.` });
  const duplicated = headers.filter((h, i) => h && headers.indexOf(h) !== i);
  if (duplicated.length) issues.push({ severity: "error", message: `Column${duplicated.length > 1 ? "s" : ""} listed twice: ${[...new Set(duplicated)].join(", ")}.` });

  const byKey = new Map<string, WorkstreamSpec>();
  const channelNames = new Map<string, number>();
  const numbers = new Map<string, number>();

  csv.records.forEach((record) => {
    const values = new Map<string, string>();
    headers.forEach((h, i) => { if (COLUMN_BY_HEADER.has(h)) values.set(h, (record.cells[i] ?? "").trim()); });
    const row: Row = { line: record.line, values };
    const line = record.line;
    const name = values.get("workstream_name") ?? "";
    if (!name) {
      issues.push({ severity: "error", line, column: "workstream_name", message: "workstream_name is empty. Every row needs the existing workstream the channel is added to." });
      return;
    }
    const missing = CHANNEL_COLUMNS.filter((c) => c.required && !(values.get(c.header) ?? "")).map((c) => c.header);
    if (missing.length) {
      missing.forEach((h) => issues.push({ severity: "error", line, column: h, workstream: name, message: `${h} is required: every row adds one voice channel.` }));
      return;
    }
    const channel = readChannel(row, issues, name, "Inbound");
    if (!channel) return;

    const key = name.toLowerCase();
    const spec = byKey.get(key) ?? { key, lines: [], channels: [], ...placeholder(name) };
    byKey.set(key, spec);
    spec.lines.push(line);

    const channelKey = channel.name.toLowerCase();
    if (channelNames.has(channelKey)) issues.push({ severity: "error", line, column: "channel_name", workstream: name, message: `Channel "${channel.name}" is also on line ${channelNames.get(channelKey)}. Channel names must be unique.` });
    else channelNames.set(channelKey, line);
    if (channel.phoneNumber) {
      if (numbers.has(channel.phoneNumber)) issues.push({ severity: "warning", line, column: PHONE_HEADER, workstream: name, message: `${channel.phoneNumber} is also used on line ${numbers.get(channel.phoneNumber)}. Check it's intended: calls to one number reach one channel.` });
      else numbers.set(channel.phoneNumber, line);
    }
    spec.channels.push(channel);
  });

  if (!csv.records.length) issues.push({ severity: "error", message: "The file has a header line but no rows." });
  return { workstreams: [...byKey.values()], issues, rowCount: csv.records.length };
}

// msdyn_direction, as Visual Routing Tester and Phone Number Changer read it live.
const DIRECTION_LABELS: Record<number, string> = { 1: "an outbound profile", 2: "a direct inbound workstream", 3: "a direct outbound workstream", 4: "a proactive outbound workstream" };

export function resolveChannelPlan(parsed: ParsedPlan, catalog: Catalog): ResolvedPlan {
  const issues: Issue[] = [...parsed.issues];
  const workstreams: ResolvedWorkstream[] = parsed.workstreams.map((ws) => {
    const error = (message: string) => issues.push({ severity: "error", line: ws.lines[0], column: "workstream_name", workstream: ws.name, message });
    const matches = catalog.workstreams.filter((w) => w.name.trim().toLowerCase() === ws.key);
    let existingId: string | undefined;
    if (!matches.length) error(`No workstream named "${ws.name}" exists in this environment. This tool adds channels to existing workstreams; create new ones with Voice Workstream Builder.`);
    else if (matches.length > 1) error(`${matches.length} workstreams are named "${ws.name}", so it's not clear which one is meant. Rename one of them first.`);
    else {
      const w = matches[0];
      if (w.voice === false) error(`"${ws.name}" isn't a voice workstream, so it can't have voice channels.`);
      else if (w.active === false) error(`"${ws.name}" is deactivated. Activate it first, or pick another workstream.`);
      else if (w.direction !== undefined && w.direction !== 0) error(`"${ws.name}" is ${DIRECTION_LABELS[w.direction] ?? "not an inbound workstream"}. This tool only adds channels to inbound voice workstreams.`);
      else existingId = w.id;
    }
    return { ...ws, existingId, refs: {}, channels: resolveChannels(ws, catalog, issues) };
  });
  return { workstreams, issues, rowCount: parsed.rowCount };
}

// The only way this tool creates anything: every workstream must be an existing one, so the shared create
// engine never makes a workstream or capacity link, only channels, their language settings and voices.
export async function addChannels(plan: ResolvedPlan, source: BuilderSource, onProgress?: (p: ExecuteProgress) => void): Promise<WorkstreamResult[]> {
  const unknown = plan.workstreams.filter((w) => !w.existingId).map((w) => w.name);
  if (unknown.length) throw new Error(`Not an existing workstream: ${unknown.join(", ")}. Nothing was created.`);
  return executePlan(plan, source, onProgress);
}

// Channels each workstream already has, for the review.
export function existingChannelCount(catalog: Catalog, workstream: string): number {
  return catalog.channels.filter((c) => c.workstreamName?.trim().toLowerCase() === workstream.trim().toLowerCase()).length;
}
