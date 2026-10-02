// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { AccessFailure, DataAccessError, DataSource, DescribeResult, LookupMetadata, ReadRequest, ReadResult } from "./dataSource";

declare const Xrm: any;

// The only file that talks to Dataverse. Every call is a read: Xrm.WebApi.retrieveMultipleRecords
// for data, and plain GET requests to the Web API's metadata endpoints for table/relationship
// definitions (Xrm.WebApi has no metadata helper). tests/readOnly.test.ts guards this statically.

// Same iframe/top-window resolution as the other tools — this page may run as the top-level
// sitemap page or embedded via IFRAME on a form/dashboard.
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

// A link to open a record in the model-driven app — used for the finding detail panel's related
// records. Opens a record form; never modifies anything by itself.
export function recordUrl(table: string, id: string): string | undefined {
  const base = clientUrl();
  return base ? `${base}/main.aspx?pagetype=entityrecord&etn=${encodeURIComponent(table)}&id=${encodeURIComponent(id)}` : undefined;
}

// `error instanceof Error` is unreliable here: Xrm is often reached via window.parent, so its
// errors belong to another realm.
function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

function missingPropertyName(message: string): string | undefined {
  return message.match(/property named '([^']+)'/i)?.[1];
}

export function classifyError(message: string): AccessFailure {
  if (/0x80040220|privilege|permission denied|access is denied|not have permission|forbidden/i.test(message)) return "noPermission";
  if (missingPropertyName(message)) return "error";
  if (/could not find|does not exist|invalid entity|resource not found|entitydefinition|not found for the segment/i.test(message)) return "notFound";
  return "error";
}

async function getJson(path: string): Promise<{ ok: true; body: any } | { ok: false; failure: AccessFailure; message: string } | undefined> {
  const base = clientUrl();
  if (!base || typeof fetch === "undefined") return undefined;
  try {
    const response = await fetch(`${base}/api/data/v9.2/${path}`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" }
    });
    if (response.ok) return { ok: true, body: await response.json() };
    const failure: AccessFailure = response.status === 404 ? "notFound" : response.status === 401 || response.status === 403 ? "noPermission" : "error";
    return { ok: false, failure, message: `HTTP ${response.status} reading ${path.split("?")[0]}` };
  } catch {
    return undefined;
  }
}

async function describeTable(logicalName: string): Promise<DescribeResult> {
  const result = await getJson(`EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName,PrimaryIdAttribute,PrimaryNameAttribute&$expand=ManyToOneRelationships($select=ReferencingAttribute,ReferencedEntity)`);
  if (!result) return { status: "ok", metadata: null };
  if (!result.ok) return { status: result.failure, message: result.message };
  const body = result.body ?? {};
  const relationships: any[] = Array.isArray(body.ManyToOneRelationships) ? body.ManyToOneRelationships : [];
  const lookups: LookupMetadata[] = relationships
    .filter((r) => typeof r?.ReferencingAttribute === "string" && typeof r?.ReferencedEntity === "string")
    .map((r) => ({ attribute: r.ReferencingAttribute.toLowerCase(), target: r.ReferencedEntity.toLowerCase() }));
  return {
    status: "ok",
    metadata: {
      primaryId: typeof body.PrimaryIdAttribute === "string" ? body.PrimaryIdAttribute : `${logicalName}id`,
      primaryName: typeof body.PrimaryNameAttribute === "string" && body.PrimaryNameAttribute ? body.PrimaryNameAttribute : undefined,
      lookups
    }
  };
}

// Follows @odata.nextLink until exhausted — Xrm.WebApi doesn't page automatically, and its nextLink
// is a full URL where retrieveMultipleRecords wants just the query string.
async function readAll(xrm: any, logicalName: string, initialQuery: string): Promise<Record<string, unknown>[]> {
  let query: string | undefined = initialQuery;
  const rows: Record<string, unknown>[] = [];
  for (;;) {
    const result: { entities: Record<string, unknown>[]; nextLink?: string } = await xrm.WebApi.retrieveMultipleRecords(logicalName, query);
    rows.push(...result.entities);
    if (!result.nextLink) return rows;
    const index = result.nextLink.indexOf("?");
    query = index >= 0 ? result.nextLink.slice(index) : undefined;
    if (!query) return rows;
  }
}

function buildQuery(select: string[], expand: ReadRequest["expand"], filter: string | undefined): string {
  const parts = [`$select=${select.join(",")}`];
  if (expand.length) parts.push(`$expand=${expand.map((e) => `${e.navigation}($select=${e.idField})`).join(",")}`);
  if (filter) parts.push(`$filter=${filter}`);
  return `?${parts.join("&")}`;
}

// Reads one table, dropping (and reporting) any requested column this environment doesn't have
// rather than failing the whole table, and retrying once without the filter if the filter itself is
// what the server rejected.
async function readTable(request: ReadRequest): Promise<ReadResult> {
  const xrm = resolveXrm();
  if (!xrm) throw new DataAccessError("error", "This app must run inside a Dataverse model-driven app (as a web resource on a sitemap page, form or dashboard).");
  let select = [...new Set(request.select)];
  let expand = [...request.expand];
  let filter = request.filter;
  const droppedColumns: string[] = [];
  for (;;) {
    try {
      const rows = await readAll(xrm, request.logicalName, buildQuery(select, expand, filter));
      expand.forEach((e) => rows.forEach((row) => {
        const nested = row[e.navigation] as Record<string, unknown> | null | undefined;
        row[`_${e.navigation}_value`] = nested?.[e.idField] ?? null;
        delete row[e.navigation];
      }));
      return { rows, droppedColumns, filterApplied: !!filter };
    } catch (error) {
      const message = errorMessage(error);
      const missing = missingPropertyName(message)?.toLowerCase();
      if (missing) {
        const token = select.find((s) => s.toLowerCase() === missing || s.toLowerCase() === `_${missing}_value`);
        const expandMatch = expand.find((e) => e.navigation.toLowerCase() === missing || `_${e.navigation}_value` === missing);
        if (token && select.length > 1) { select = select.filter((s) => s !== token); droppedColumns.push(token); continue; }
        if (expandMatch) { expand = expand.filter((e) => e !== expandMatch); droppedColumns.push(`_${expandMatch.navigation}_value`); continue; }
      }
      const kind = classifyError(message);
      if (kind === "error" && filter) { filter = undefined; continue; }
      throw new DataAccessError(kind, kind === "noPermission" ? `No permission to read "${request.logicalName}" (${message})` : kind === "notFound" ? `"${request.logicalName}" was not found in this environment (${message})` : `Unable to read "${request.logicalName}": ${message}`);
    }
  }
}

export const dataverseSource: DataSource = { mode: "live", describeTable, readTable };
