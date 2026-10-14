// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Catalog } from "./model";

// What the builder needs from an environment. dataverse.ts implements it against the live org;
// demoData.ts in memory for the offline demo.
export interface RouteSource {
  mode: "live" | "demo";
  loadCatalog(): Promise<Catalog>;
  // The current rules of a ruleset (msdyn_rulesetdefinition), read again just before adding to them.
  loadRulesetDefinition(rulesetId: string): Promise<string | undefined>;
  // The routing contract's definition, to see whether the platform has added a new context variable.
  loadContractDefinition(contractId: string): Promise<string | undefined>;
  // Creates a context variable, routing configuration, ruleset or step and returns its id. Any other
  // table or column is refused.
  create(table: string, payload: Record<string, unknown>): Promise<string>;
  // Changes a ruleset's rules. Anything else is refused.
  update(table: string, id: string, columns: Record<string, unknown>): Promise<void>;
  recordUrl(table: string, id: string): string | undefined;
  currentUser(): string;
}
