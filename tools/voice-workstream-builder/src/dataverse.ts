import { BuilderSource, CREATABLE_TABLES, CreatableTable } from "./dataSource";
import { normalizePhoneNumber } from "./validate";
import { Catalog } from "./model";
import { TABLES, TableKey } from "./voiceSchema";

declare const Xrm: any;

// The only file that talks to Dataverse. Reads use Xrm.WebApi.retrieveMultipleRecords; the only write
// is Xrm.WebApi.createRecord, and only for the tables in CREATABLE_TABLES — checked here at runtime
// and statically by tests/writeScope.test.ts. It never updates or deletes.

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

// Follows @odata.nextLink until exhausted.
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

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function loadCatalog(): Promise<Catalog> {
  const [queues, profiles, hours, numbers, languages, music, workstreams, channels] = await Promise.all([
    readAll("queue", "?$select=queueid,name&$filter=msdyn_isomnichannelqueue eq true and statecode eq 0"),
    readAll("msdyn_capacityprofile", "?$select=msdyn_capacityprofileid,msdyn_name,msdyn_uniquename&$filter=statecode eq 0"),
    readAll("msdyn_operatinghour", "?$select=msdyn_operatinghourid,msdyn_name&$filter=statecode eq 0"),
    readAll("msdyn_ocphonenumber", "?$select=msdyn_ocphonenumberid,msdyn_phonenumber,statecode,msdyn_phoneinboundenabled,msdyn_phoneoutboundenabled"),
    readAll("msdyn_oclanguage", "?$select=msdyn_oclanguageid,msdyn_languagename,msdyn_localecode"),
    readAll("msdyn_ocphonemusic", "?$select=msdyn_ocphonemusicid,msdyn_name"),
    // Every workstream, any channel or state: a new name must not collide with any of them.
    readAll("msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name"),
    readAll("msdyn_ocvoicechannelsetting", "?$select=msdyn_ocvoicechannelsettingid,msdyn_name,_msdyn_phonenumberid_value,_msdyn_liveworkstreamid_value")
  ]);
  const workstreamNames = new Map(workstreams.map((w) => [str(w.msdyn_liveworkstreamid), str(w.msdyn_name)]));
  return {
    queues: queues.map((q) => ({ id: str(q.queueid), name: str(q.name) })),
    capacityProfiles: profiles.map((p) => ({ id: str(p.msdyn_capacityprofileid), name: str(p.msdyn_name), uniqueName: str(p.msdyn_uniquename) || undefined })),
    operatingHours: hours.map((h) => ({ id: str(h.msdyn_operatinghourid), name: str(h.msdyn_name) })),
    phoneNumbers: numbers.map((n) => ({
      id: str(n.msdyn_ocphonenumberid),
      number: normalizePhoneNumber(str(n.msdyn_phonenumber)),
      active: n.statecode === 0,
      inbound: n.msdyn_phoneinboundenabled === true,
      outbound: n.msdyn_phoneoutboundenabled === true
    })),
    languages: languages.map((l) => ({ id: str(l.msdyn_oclanguageid), name: str(l.msdyn_languagename), localeCode: str(l.msdyn_localecode) })),
    music: music.map((m) => ({ id: str(m.msdyn_ocphonemusicid), name: str(m.msdyn_name) })),
    workstreams: workstreams.map((w) => ({ id: str(w.msdyn_liveworkstreamid), name: str(w.msdyn_name) })),
    channels: channels.map((c) => ({
      id: str(c.msdyn_ocvoicechannelsettingid),
      name: str(c.msdyn_name),
      phoneNumberId: str(c._msdyn_phonenumberid_value) || undefined,
      workstreamName: workstreamNames.get(str(c._msdyn_liveworkstreamid_value))
    }))
  };
}

async function create(table: CreatableTable, payload: Record<string, unknown>): Promise<string> {
  if (!(CREATABLE_TABLES as readonly string[]).includes(table)) throw new Error(`This tool doesn't create ${table} records.`);
  const result: { id?: string } = await xrmOrThrow().WebApi.createRecord(TABLES[table].logicalName, payload);
  if (!result?.id) throw new Error(`Dataverse didn't return an id for the new ${TABLES[table].logicalName} record.`);
  return result.id.replace(/[{}]/g, "").toLowerCase();
}

async function countRoutingConfigurations(workstreamId: string): Promise<number | undefined> {
  const rows = await readAll("msdyn_routingconfiguration", `?$select=msdyn_routingconfigurationid&$filter=_msdyn_liveworkstreamid_value eq ${workstreamId}`);
  return rows.length;
}

export function recordUrl(table: TableKey, id: string): string | undefined {
  const base = clientUrl();
  return base ? `${base}/main.aspx?pagetype=entityrecord&etn=${encodeURIComponent(TABLES[table].logicalName)}&id=${encodeURIComponent(id)}` : undefined;
}

export function currentUser(): string {
  const settings = resolveXrm()?.Utility?.getGlobalContext?.()?.userSettings;
  return settings?.userName ?? settings?.userId?.replace(/[{}]/g, "") ?? "unknown user";
}

export const dataverseSource: BuilderSource = { mode: "live", loadCatalog, create, countRoutingConfigurations, recordUrl, currentUser };
