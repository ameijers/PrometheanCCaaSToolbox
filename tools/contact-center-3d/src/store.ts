// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Grouping } from "./centers";

// Where the customer centers are remembered. For now in this browser, per environment; a shared
// Dataverse table can take its place behind the same interface.

export interface CenterStore {
  // Shown on the page, so the viewer knows who else sees the grouping.
  where: string;
  load(environment: string): Promise<Grouping | undefined>;
  save(environment: string, grouping: Grouping): Promise<void>;
}

interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const key = (environment: string) => `pct.contactcenter3d.centers.${environment}`;

function storage(): Storage | undefined {
  try { return typeof window !== "undefined" ? window.localStorage : undefined; } catch { return undefined; }
}

export function browserStore(store: Storage | undefined = storage()): CenterStore {
  return {
    where: "Saved in this browser",
    async load(environment) {
      try {
        const raw = store?.getItem(key(environment));
        return raw ? (JSON.parse(raw) as Grouping) : undefined;
      } catch {
        return undefined;
      }
    },
    async save(environment, grouping) {
      try { store?.setItem(key(environment), JSON.stringify(grouping)); } catch { /* not remembered */ }
    }
  };
}
