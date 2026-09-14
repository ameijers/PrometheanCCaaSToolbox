import { variableType, parseDisplayValue } from "./contextValues";
import { CapturedValue, ContextVariableDefinition, WorkItemSummary, Workstream } from "./model";

declare const Xrm: any;

// As a web resource, this control may run as the top-level page (Xrm on window) or embedded via
// IFRAME on a form/dashboard/sitemap page (Xrm only on the parent/top window) — check both.
function resolveXrm(): any {
  if (typeof Xrm !== "undefined" && Xrm?.WebApi) return Xrm;
  if (typeof window === "undefined") return undefined;
  const w = window as any;
  if (w.parent && w.parent !== w && w.parent.Xrm?.WebApi) return w.parent.Xrm;
  if (w.top && w.top !== w && w.top.Xrm?.WebApi) return w.top.Xrm;
  return undefined;
}

interface EntityDefinition {
  LogicalName: string;
  EntitySetName: string;
}

const definitions = [
  { logicalName: "msdyn_liveworkstream", setName: "msdyn_liveworkstreams" },
  { logicalName: "msdyn_ocliveworkstreamcontextvariable", setName: "msdyn_ocliveworkstreamcontextvariables" },
  { logicalName: "msdyn_ocliveworkitem", setName: "msdyn_ocliveworkitems" },
  { logicalName: "msdyn_ocliveworkitemcontextitemelastic", setName: "msdyn_ocliveworkitemcontextitemelastics" }
];

async function findDefinition(logicalName: string): Promise<EntityDefinition> {
  const xrm = resolveXrm();
  if (!xrm) throw new Error("This app must run inside a Dataverse model-driven app (as a web resource on a form, dashboard, or sitemap page).");
  const fallback = definitions.find((definition) => definition.logicalName === logicalName);
  try {
    const result = await xrm.WebApi.retrieveMultipleRecords("EntityDefinitions", `?$select=LogicalName,EntitySetName&$filter=LogicalName eq '${logicalName}'`);
    return result.entities[0] ?? { LogicalName: logicalName, EntitySetName: fallback?.setName ?? `${logicalName}s` };
  } catch {
    return { LogicalName: logicalName, EntitySetName: fallback?.setName ?? `${logicalName}s` };
  }
}

// `error instanceof Error` is unreliable here: Xrm is accessed via window.parent (iframe hosting),
// so errors it throws belong to the parent window's realm, where our Error constructor doesn't match.
function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

function classifyError(logicalName: string, error: unknown): Error {
  const message = errorMessage(error);
  if (/0x80040220|privilege|permission denied|access is denied/i.test(message)) {
    return new Error(`You don't have permission to read "${logicalName}" records. Ask your Dataverse administrator for read access to this table. (${message})`);
  }
  if (/could not find|does not exist|invalid entity|resource not found|entitydefinition/i.test(message)) {
    return new Error(`This environment does not appear to have Contact Center unified routing configured (the "${logicalName}" table was not found). (${message})`);
  }
  return new Error(`Unable to read "${logicalName}": ${message}`);
}

async function read(logicalName: string, query: string): Promise<any[]> {
  const definition = await findDefinition(logicalName);
  try {
    const result = await resolveXrm().WebApi.retrieveMultipleRecords(definition.LogicalName, query);
    return result.entities;
  } catch (error) {
    throw classifyError(logicalName, error);
  }
}

export async function loadWorkstreams(): Promise<Workstream[]> {
  const rows = await read("msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,statecode,msdyn_direction,msdyn_enablevoicev2");
  // msdyn_direction: 0 Inbound, 1 Outbound, 2 Direct Inbound, 3 Direct Outbound, 4 ProactiveOutbound
  // (confirmed against a live environment) — this tool watches inbound voice/IVR calls specifically.
  return rows
    .filter((row) => row.msdyn_enablevoicev2 === true && (row.msdyn_direction === 0 || row.msdyn_direction === undefined))
    .map((row) => ({ id: row.msdyn_liveworkstreamid, name: row.msdyn_name ?? row.msdyn_liveworkstreamid, active: row.statecode === 0 }));
}

export async function loadDefinitions(workstreamId: string): Promise<ContextVariableDefinition[]> {
  const rows = await read("msdyn_ocliveworkstreamcontextvariable", `?$select=msdyn_ocliveworkstreamcontextvariableid,msdyn_name,msdyn_displayname,msdyn_datatype&$filter=_msdyn_liveworkstreamid_value eq ${workstreamId}`);
  return rows.map((row) => ({
    id: row.msdyn_ocliveworkstreamcontextvariableid,
    name: row.msdyn_name ?? row.msdyn_ocliveworkstreamcontextvariableid,
    displayName: row.msdyn_displayname ?? row.msdyn_name,
    type: variableType(row.msdyn_datatype)
  }));
}

export async function loadRecentWorkItems(workstreamId: string, top = 10): Promise<WorkItemSummary[]> {
  const rows = await read("msdyn_ocliveworkitem", `?$select=msdyn_ocliveworkitemid,msdyn_title,createdon,statecode&$filter=_msdyn_liveworkstreamid_value eq ${workstreamId}&$orderby=createdon desc&$top=${top}`);
  return rows.map((row) => ({
    id: row.msdyn_ocliveworkitemid,
    title: row.msdyn_title ?? row.msdyn_ocliveworkitemid,
    createdOn: row.createdon,
    active: row.statecode === 0
  }));
}

export async function loadCapturedValues(workItemId: string): Promise<CapturedValue[]> {
  const rows = await read("msdyn_ocliveworkitemcontextitemelastic", `?$select=msdyn_name,msdyn_value,msdyn_datatype,createdon&$filter=_msdyn_ocliveworkitemid_value eq ${workItemId}`);
  return rows
    .filter((row) => row.msdyn_name && row.msdyn_value !== null && row.msdyn_value !== undefined)
    .map((row) => {
      const type = variableType(row.msdyn_datatype);
      return { name: row.msdyn_name, rawValue: row.msdyn_value, displayValue: parseDisplayValue(row.msdyn_value, type), type, capturedOn: row.createdon };
    });
}
