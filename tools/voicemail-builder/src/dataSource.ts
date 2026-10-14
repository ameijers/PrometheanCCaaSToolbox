// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Catalog } from "./model";

// What the builder needs from an environment. dataverse.ts implements it against the live org;
// demoData.ts in memory for the offline demo.
export interface VoicemailSource {
  mode: "live" | "demo";
  loadCatalog(): Promise<Catalog>;
  // A ruleset's current rules (msdyn_rulesetdefinition), read again just before changing them.
  loadDefinition(rulesetId: string): Promise<string | undefined>;
  // Creates a queue, a workstream or a ruleset and returns its id. Any other table or column is refused.
  create(table: string, payload: Record<string, unknown>): Promise<string>;
  // Changes a ruleset's rules or links a queue to its overflow ruleset. Anything else is refused.
  update(table: string, id: string, columns: Record<string, unknown>): Promise<void>;
  // Adds a user to a queue's members.
  addMember(queueId: string, userId: string): Promise<void>;
  recordUrl(table: string, id: string): string | undefined;
  currentUser(): string;
}
