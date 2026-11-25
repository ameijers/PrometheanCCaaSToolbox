// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { clientUrl, currentUser, environmentLabel, xrmOrThrow } from "../../shared/src/xrm";
import { AttributeMeta, Row, SnapshotSource, SourceError, TableMeta } from "./model";

// The only file that talks to Dataverse, and it only reads: table metadata through GET requests to the
// Web API (Xrm.WebApi has no metadata helper), rows through Xrm.WebApi.retrieveMultipleRecords, which
// also returns each value's readable label. tests/readOnly.test.ts fails on any write in src/.

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

function classify(message: string): SourceError {
  if (/0x80040220|privilege|permission|access is denied|forbidden/i.test(message)) return new SourceError("noPermission", `No permission to read this table (${message})`);
  if (/could not find|does not exist|not found|invalid entity/i.test(message)) return new SourceError("notFound", message);
  return new SourceError("error", message);
}

const label = (value: any): string | undefined => value?.UserLocalizedLabel?.Label ?? value?.LocalizedLabels?.[0]?.Label ?? undefined;

async function describe(logicalName: string): Promise<TableMeta | null> {
  const base = clientUrl();
  if (!base) throw new SourceError("error", "This page must run inside a Dataverse model-driven app.");
  const response = await fetch(`${base}/api/data/v9.2/EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName,PrimaryIdAttribute,PrimaryNameAttribute,DisplayCollectionName&$expand=Attributes($select=LogicalName,AttributeType,AttributeOf,IsValidForRead,DisplayName,AttributeTypeName)`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" }
  });
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) throw new SourceError("noPermission", `No permission to read the definition of ${logicalName} (HTTP ${response.status}).`);
  if (!response.ok) throw new SourceError("error", `Couldn't read the definition of ${logicalName} (HTTP ${response.status}).`);
  const body = await response.json();
  const attributes: AttributeMeta[] = (Array.isArray(body.Attributes) ? body.Attributes : []).map((a: any): AttributeMeta => ({
    logicalName: a.LogicalName, label: label(a.DisplayName), type: a.AttributeType, typeName: a.AttributeTypeName?.Value ?? undefined,
    attributeOf: a.AttributeOf ?? undefined, readable: a.IsValidForRead !== false
  }));
  return { logicalName, label: label(body.DisplayCollectionName) ?? logicalName, primaryId: body.PrimaryIdAttribute, primaryName: body.PrimaryNameAttribute ?? undefined, attributes };
}

// Follows @odata.nextLink until every row is read.
async function readAll(logicalName: string, query: string): Promise<Row[]> {
  const xrm = xrmOrThrow();
  const rows: Row[] = [];
  let next: string | undefined = query;
  while (next) {
    let result: { entities: Row[]; nextLink?: string };
    try {
      result = await xrm.WebApi.retrieveMultipleRecords(logicalName, next);
    } catch (error) {
      throw classify(errorMessage(error));
    }
    rows.push(...result.entities);
    const index = result.nextLink?.indexOf("?") ?? -1;
    next = result.nextLink && index >= 0 ? result.nextLink.slice(index) : undefined;
  }
  return rows;
}

// Every column is returned when none are selected; the columns to keep are chosen from the metadata.
async function rows(logicalName: string, filter?: string): Promise<Row[]> {
  return readAll(logicalName, filter ? `?$filter=${filter}` : "?$count=true");
}

async function rowsByIds(logicalName: string, idColumn: string, ids: string[], select: string[]): Promise<Row[]> {
  const result: Row[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const filter = ids.slice(i, i + 40).map((id) => `${idColumn} eq ${id}`).join(" or ");
    result.push(...await readAll(logicalName, `?$select=${select.join(",")}&$filter=${filter}`));
  }
  return result;
}

export const dataverseSource: SnapshotSource = {
  mode: "live",
  environment: environmentLabel,
  user: currentUser,
  describe,
  rows,
  rowsByIds
};
