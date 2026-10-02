// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Catalog } from "./model";
import { TableKey } from "./voiceSchema";

// What the builder needs from an environment. dataverse.ts implements it against the live org
// (Xrm.WebApi); demoData.ts implements it in memory for the offline demo.
export interface BuilderSource {
  mode: "live" | "demo";
  loadCatalog(): Promise<Catalog>;
  // Creates one record and returns its id. Only the tables in CREATABLE_TABLES are accepted.
  create(table: CreatableTable, payload: Record<string, unknown>): Promise<string>;
  // Routing configurations linked to a workstream, or undefined when they can't be read.
  countRoutingConfigurations(workstreamId: string): Promise<number | undefined>;
  recordUrl(table: TableKey, id: string): string | undefined;
  // Who is signed in, for the run log.
  currentUser(): string;
}

// The only tables this tool ever writes to, and it only ever creates. tests/writeScope.test.ts
// checks the code against this list.
export const CREATABLE_TABLES = ["workstream", "capacityLink", "channel", "ttsVoice", "languageSetting"] as const;
export type CreatableTable = typeof CREATABLE_TABLES[number];
