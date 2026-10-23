// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Vec3 } from "./layout";

// Saved camera views, kept in this browser per environment. A convenience: if the browser
// blocks storage they just aren't remembered.

export interface SavedView {
  name: string;
  position: Vec3;
  target: Vec3;
}

interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const storageKey = (environment: string) => `pct.explorer3d.views.${environment}`;
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));

export function browserStorage(): Storage | undefined {
  try { return typeof window !== "undefined" ? window.localStorage : undefined; } catch { return undefined; }
}

export function loadViews(environment: string, storage = browserStorage()): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(storageKey(environment)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((v): v is SavedView => !!v && typeof v.name === "string" && isVec3(v.position) && isVec3(v.target))
      : [];
  } catch {
    return [];
  }
}

export function storeViews(environment: string, views: SavedView[], storage = browserStorage()): void {
  try { storage?.setItem(storageKey(environment), JSON.stringify(views)); } catch { /* not remembered */ }
}

// The next free "View n" name.
export function nextViewName(views: SavedView[]): string {
  let n = views.length + 1;
  while (views.some((v) => v.name === `View ${n}`)) n++;
  return `View ${n}`;
}
