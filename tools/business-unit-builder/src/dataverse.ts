// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Catalog } from "./model";
import { UNIT_TABLE, UnitSource } from "./dataSource";

declare const Xrm: any;

// The only file that talks to Dataverse. Reads use Xrm.WebApi.retrieveMultipleRecords; the only write
// is Xrm.WebApi.createRecord on businessunit. It never updates, disables or deletes anything.
// tests/writeScope.test.ts checks this statically.

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

async function loadCatalog(): Promise<Catalog> {
  const rows = await readAll(UNIT_TABLE, "?$select=businessunitid,name,isdisabled,_parentbusinessunitid_value");
  return {
    units: rows.map((r) => ({
      id: String(r.businessunitid),
      name: typeof r.name === "string" ? r.name : "",
      parentId: r._parentbusinessunitid_value ? String(r._parentbusinessunitid_value) : undefined,
      disabled: r.isdisabled === true
    }))
  };
}

async function createUnit(payload: Record<string, unknown>): Promise<string> {
  const result: { id?: string } = await xrmOrThrow().WebApi.createRecord(UNIT_TABLE, payload);
  if (!result?.id) throw new Error("Dataverse didn't return an id for the new business unit.");
  return result.id.replace(/[{}]/g, "").toLowerCase();
}

async function hasDefaultTeam(unitId: string): Promise<boolean | undefined> {
  const rows = await readAll("team", `?$select=teamid&$filter=isdefault eq true and _businessunitid_value eq ${unitId}`);
  return rows.length > 0;
}

export function recordUrl(unitId: string): string | undefined {
  const base = clientUrl();
  return base ? `${base}/main.aspx?pagetype=entityrecord&etn=${UNIT_TABLE}&id=${encodeURIComponent(unitId)}` : undefined;
}

export function currentUser(): string {
  const settings = resolveXrm()?.Utility?.getGlobalContext?.()?.userSettings;
  return settings?.userName ?? settings?.userId?.replace(/[{}]/g, "") ?? "unknown user";
}

export const dataverseSource: UnitSource = { mode: "live", loadCatalog, createUnit, hasDefaultTeam, recordUrl, currentUser };
