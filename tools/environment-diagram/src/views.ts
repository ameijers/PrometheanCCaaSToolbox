// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { browserStorage } from "../../environment-3d-explorer/src/views";
import { View } from "./Diagram";

// Saved views of the diagram (where you scrolled and how far you zoomed), kept in this browser per
// environment. A convenience: if the browser blocks storage they just aren't remembered.

export interface SavedView extends View { name: string }

interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const storageKey = (environment: string) => `pct.diagram2d.views.${environment}`;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function loadViews(environment: string, storage: Storage | undefined = browserStorage()): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(storageKey(environment)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is SavedView => !!v && typeof v.name === "string" && num(v.x) && num(v.y) && num(v.k) && v.k > 0) : [];
  } catch {
    return [];
  }
}

export function storeViews(environment: string, views: SavedView[], storage: Storage | undefined = browserStorage()): void {
  try { storage?.setItem(storageKey(environment), JSON.stringify(views)); } catch { /* not remembered */ }
}
