// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { NumberSource } from "./dataSource";
import { ChannelRow, Kind, PhoneNumber } from "./model";

declare const Xrm: any;

// The only file that talks to Dataverse. Reads use Xrm.WebApi.retrieveMultipleRecords; the only write
// is Xrm.WebApi.updateRecord on msdyn_ocvoicechannelsetting, limited to its phone number and caller ID
// lookups (WRITABLE) — checked here at runtime and statically by tests/writeScope.test.ts. It never
// creates or deletes, and never writes to the phone number records themselves.
//
// The platform's own plug-in (PostOperationVoiceChannelSettingEventPlugin) runs on every update of a
// voice channel, the same as when the admin center changes the number.

const CHANNEL_TABLE = "msdyn_ocvoicechannelsetting";
const NUMBER_SET = "msdyn_ocphonenumbers";
// The lookups this tool writes, and their navigation properties (the same names here).
export const WRITABLE = { numberId: "msdyn_phonenumberid", callerIdId: "msdyn_calleridphonenumberid" } as const;

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

// msdyn_direction: 0 Inbound, 1 Outbound (an outbound profile's workstream), 2 Direct Inbound,
// 3 Direct Outbound, 4 ProactiveOutbound.
export function kindOf(direction: unknown): Kind {
  return direction === 0 ? "inbound" : direction === 1 ? "outbound" : direction === 4 ? "proactive" : "other";
}

async function load(): Promise<{ channels: ChannelRow[]; numbers: PhoneNumber[] }> {
  const [channels, workstreams, numbers] = await Promise.all([
    readAll(CHANNEL_TABLE, "?$select=msdyn_ocvoicechannelsettingid,msdyn_name,statecode,_msdyn_liveworkstreamid_value,_msdyn_phonenumberid_value,_msdyn_calleridphonenumberid_value"),
    readAll("msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,msdyn_direction"),
    readAll("msdyn_ocphonenumber", "?$select=msdyn_ocphonenumberid,msdyn_phonenumber,statecode,msdyn_phoneinboundenabled,msdyn_phoneoutboundenabled")
  ]);
  const workstreamById = new Map(workstreams.map((w) => [w.msdyn_liveworkstreamid, w]));
  return {
    channels: channels.map((c): ChannelRow => {
      const ws = workstreamById.get(c._msdyn_liveworkstreamid_value);
      return {
        id: c.msdyn_ocvoicechannelsettingid,
        name: c.msdyn_name ?? "(unnamed channel)",
        workstreamId: c._msdyn_liveworkstreamid_value ?? undefined,
        workstreamName: ws?.msdyn_name ?? "(no workstream)",
        kind: kindOf(ws?.msdyn_direction),
        active: c.statecode === 0,
        numberId: c._msdyn_phonenumberid_value ?? undefined,
        callerIdId: c._msdyn_calleridphonenumberid_value ?? undefined
      };
    }),
    numbers: numbers.map((n): PhoneNumber => ({
      id: n.msdyn_ocphonenumberid,
      number: n.msdyn_phonenumber ?? "(no number)",
      active: n.statecode === 0,
      inbound: n.msdyn_phoneinboundenabled === true,
      outbound: n.msdyn_phoneoutboundenabled === true
    }))
  };
}

// The update for one channel: a lookup is set by binding it to the number, and cleared by setting its
// navigation property to null.
export function columnsFor(set: { numberId?: string | null; callerIdId?: string | null }): Record<string, unknown> {
  const refused = Object.keys(set).filter((k) => !(k in WRITABLE));
  if (refused.length) throw new Error(`This tool only changes a voice channel's number and caller ID, not ${refused.join(", ")}.`);
  const columns: Record<string, unknown> = {};
  (Object.keys(WRITABLE) as (keyof typeof WRITABLE)[]).forEach((k) => {
    const value = set[k];
    if (value === undefined) return;
    if (value === null) columns[WRITABLE[k]] = null;
    else columns[`${WRITABLE[k]}@odata.bind`] = `/${NUMBER_SET}(${value})`;
  });
  return columns;
}

async function setNumbers(channelId: string, set: { numberId?: string | null; callerIdId?: string | null }): Promise<void> {
  const columns = columnsFor(set);
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

export const dataverseSource: NumberSource = { mode: "live", load, setNumbers, recordUrl, currentUser };
