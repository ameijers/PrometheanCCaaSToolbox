// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

declare const Xrm: any;

// Read-only Dataverse helpers shared by the provisioning tools: finding Xrm (the page may run as a
// sitemap page or inside a frame), paged reads, and links. Writes are never made from here: each tool
// keeps its own writes in its own dataverse.ts, guarded by its own writeScope test.

export function resolveXrm(): any {
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

export function xrmOrThrow(): any {
  const xrm = resolveXrm();
  if (!xrm) throw new Error("This app must run inside a Dataverse model-driven app (as a web resource on a sitemap page).");
  return xrm;
}

// Follows @odata.nextLink until exhausted.
export async function readAll(logicalName: string, query: string): Promise<Record<string, any>[]> {
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

export function recordUrl(table: string, id: string): string | undefined {
  const base = clientUrl();
  return base ? `${base}/main.aspx?pagetype=entityrecord&etn=${encodeURIComponent(table)}&id=${encodeURIComponent(id)}` : undefined;
}

export function currentUser(): string {
  const settings = resolveXrm()?.Utility?.getGlobalContext?.()?.userSettings;
  return settings?.userName ?? settings?.userId?.replace(/[{}]/g, "") ?? "unknown user";
}

export function currentUserId(): string | undefined {
  return resolveXrm()?.Utility?.getGlobalContext?.()?.userSettings?.userId?.replace(/[{}]/g, "").toLowerCase();
}

export function environmentLabel(): string {
  return clientUrl()?.replace(/^https:\/\//, "") ?? "this environment";
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function cleanId(id: string): string {
  return id.replace(/[{}]/g, "").toLowerCase();
}
