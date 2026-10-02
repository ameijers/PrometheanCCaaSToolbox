// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { RECORDING_COLUMNS, readRecordingSettings } from "../../voice-workstream-builder/src/recordingSettings";
import { ProvisionerSource } from "./dataSource";
import { ChannelRow, Direction } from "./model";

declare const Xrm: any;

// The only file that talks to Dataverse. Reads use Xrm.WebApi.retrieveMultipleRecords; the only write
// is Xrm.WebApi.updateRecord on msdyn_ocvoicechannelsetting, limited to the recording/transcription
// columns in RECORDING_COLUMNS — checked here at runtime and statically by tests/writeScope.test.ts.
// It never creates or deletes.

const CHANNEL_TABLE = "msdyn_ocvoicechannelsetting";

function resolveXrm(): any {
  if (typeof Xrm !== "undefined" && Xrm?.WebApi) return Xrm;
  if (typeof window === "undefined") return undefined;
  const w = window as any;
  if (w.parent && w.parent !== w && w.parent.Xrm?.WebApi) return w.parent.Xrm;
  if (w.top && w.top !== w && w.top.Xrm?.WebApi) return w.top.Xrm;
  return undefined;
}

export function isDataverseAvailable(): boolean {
  return !!resolveXrm();
}

export function clientUrl(): string | undefined {
  return resolveXrm()?.Utility?.getGlobalContext?.()?.getClientUrl?.();
}

function xrmOrThrow(): any {
  const xrm = resolveXrm();
  if (!xrm) throw new Error("This app must run inside a Dataverse model-driven app (as a web resource on a sitemap page).");
  return xrm;
}

async function readAll(logicalName: string, query: string): Promise<Record<string, any>[]> {
  const xrm = xrmOrThrow();
  let next: string | undefined = query;
  const rows: Record<string, any>[] = [];
  while (next) {
    const result: { entities: Record<string, any>[]; nextLink?: string } = await xrm.WebApi.retrieveMultipleRecords(logicalName, next);
    rows.push(...result.entities);
    const index = result.nextLink?.indexOf("?") ?? -1;
    next = result.nextLink && index >= 0 ? result.nextLink.slice(index) : undefined;
  }
  return rows;
}

// msdyn_direction: 0 Inbound, 1 Outbound, 2 Direct Inbound, 3 Direct Outbound, 4 ProactiveOutbound.
function direction(value: unknown): Direction {
  return value === 0 ? "Inbound" : value === 1 ? "Outbound" : "Other";
}

async function loadChannels(): Promise<ChannelRow[]> {
  const [channels, workstreams, numbers] = await Promise.all([
    readAll(CHANNEL_TABLE, `?$select=msdyn_ocvoicechannelsettingid,msdyn_name,statecode,_msdyn_liveworkstreamid_value,_msdyn_phonenumberid_value,${RECORDING_COLUMNS.join(",")}`),
    readAll("msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,msdyn_direction"),
    readAll("msdyn_ocphonenumber", "?$select=msdyn_ocphonenumberid,msdyn_phonenumber")
  ]);
  const workstreamById = new Map(workstreams.map((w) => [w.msdyn_liveworkstreamid, w]));
  const numberById = new Map(numbers.map((n) => [n.msdyn_ocphonenumberid, n.msdyn_phonenumber]));
  return channels.map((c) => {
    const ws = workstreamById.get(c._msdyn_liveworkstreamid_value);
    return {
      id: c.msdyn_ocvoicechannelsettingid,
      name: c.msdyn_name ?? "(unnamed channel)",
      workstreamId: c._msdyn_liveworkstreamid_value ?? undefined,
      workstreamName: ws?.msdyn_name ?? "(no workstream)",
      direction: direction(ws?.msdyn_direction),
      phoneNumber: numberById.get(c._msdyn_phonenumberid_value) ?? undefined,
      active: c.statecode === 0,
      settings: readRecordingSettings(c)
    };
  });
}

async function updateChannel(channelId: string, columns: Record<string, unknown>): Promise<void> {
  const refused = Object.keys(columns).filter((k) => !RECORDING_COLUMNS.includes(k));
  if (refused.length) throw new Error(`This tool only changes recording and transcription settings, not ${refused.join(", ")}.`);
  if (!Object.keys(columns).length) return;
  await xrmOrThrow().WebApi.updateRecord(CHANNEL_TABLE, channelId, columns);
}

export function recordUrl(channelId: string): string | undefined {
  const base = clientUrl();
  return base ? `${base}/main.aspx?pagetype=entityrecord&etn=${CHANNEL_TABLE}&id=${encodeURIComponent(channelId)}` : undefined;
}

export function currentUser(): string {
  const settings = resolveXrm()?.Utility?.getGlobalContext?.()?.userSettings;
  return settings?.userName ?? settings?.userId?.replace(/[{}]/g, "") ?? "unknown user";
}

export const dataverseSource: ProvisionerSource = { mode: "live", loadChannels, updateChannel, recordUrl, currentUser };
