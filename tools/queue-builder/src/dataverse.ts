import { Catalog } from "./model";
import { QueueSource } from "./dataSource";
import { MEMBERSHIP_RELATIONSHIP, QUEUE_ENTITY_SET, QUEUE_TABLE } from "./queueSchema";

declare const Xrm: any;

// The only file that talks to Dataverse. Reads use Xrm.WebApi.retrieveMultipleRecords. It writes in
// exactly two ways: Xrm.WebApi.createRecord on queue, and a POST to a queue's
// queuemembership_association/$ref to add a member (Xrm.WebApi has no associate helper). It never
// updates or deletes. tests/writeScope.test.ts checks this statically.

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

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadCatalog(): Promise<Catalog> {
  const [queues, hours, users] = await Promise.all([
    readAll(QUEUE_TABLE, "?$select=name"),
    readAll("msdyn_operatinghour", "?$select=msdyn_operatinghourid,msdyn_name&$filter=statecode eq 0"),
    // Interactive users only (accessmode 0 = read-write); application and non-interactive users can't take work.
    readAll("systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled&$filter=accessmode eq 0")
  ]);
  return {
    queueNames: queues.map((q) => str(q.name)),
    operatingHours: hours.map((h) => ({ id: str(h.msdyn_operatinghourid), name: str(h.msdyn_name) })),
    users: users.map((u) => ({ id: str(u.systemuserid), fullName: str(u.fullname), signIn: str(u.domainname), email: str(u.internalemailaddress) || undefined, disabled: u.isdisabled === true }))
  };
}

async function createQueue(payload: Record<string, unknown>): Promise<string> {
  const result: { id?: string } = await xrmOrThrow().WebApi.createRecord(QUEUE_TABLE, payload);
  if (!result?.id) throw new Error("Dataverse didn't return an id for the new queue.");
  return result.id.replace(/[{}]/g, "").toLowerCase();
}

function errorFromBody(body: any, status: number): string {
  return body?.error?.message ?? `HTTP ${status}`;
}

async function addMember(queueId: string, userId: string): Promise<void> {
  const base = clientUrl();
  if (!base || typeof fetch === "undefined") throw new Error("Can't reach the Dataverse Web API from this page.");
  if (!GUID.test(queueId) || !GUID.test(userId)) throw new Error("Invalid queue or user id.");
  const response = await fetch(`${base}/api/data/v9.2/${QUEUE_ENTITY_SET}(${queueId})/${MEMBERSHIP_RELATIONSHIP}/$ref`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" },
    body: JSON.stringify({ "@odata.id": `${base}/api/data/v9.2/systemusers(${userId})` })
  });
  if (!response.ok) {
    let body: any;
    try { body = await response.json(); } catch { body = undefined; }
    throw new Error(errorFromBody(body, response.status));
  }
}

async function hasAssignmentContract(queueId: string): Promise<boolean | undefined> {
  const rows = await readAll(QUEUE_TABLE, `?$select=queueid,_msdyn_assignmentinputcontractid_value&$filter=queueid eq ${queueId}`);
  return rows.length ? !!rows[0]._msdyn_assignmentinputcontractid_value : undefined;
}

export function recordUrl(queueId: string): string | undefined {
  const base = clientUrl();
  return base ? `${base}/main.aspx?pagetype=entityrecord&etn=${QUEUE_TABLE}&id=${encodeURIComponent(queueId)}` : undefined;
}

export function currentUser(): string {
  const settings = resolveXrm()?.Utility?.getGlobalContext?.()?.userSettings;
  return settings?.userName ?? settings?.userId?.replace(/[{}]/g, "") ?? "unknown user";
}

export const dataverseSource: QueueSource = { mode: "live", loadCatalog, createQueue, addMember, hasAssignmentContract, recordUrl, currentUser };
