// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Method, QueueRow } from "./model";

// What the copier needs from an environment. dataverse.ts implements it against the live org;
// demoData.ts in memory for the offline demo.
export interface CopierSource {
  mode: "live" | "demo";
  // Every advanced queue, with the custom assignment methods it holds.
  loadQueues(): Promise<QueueRow[]>;
  // One method with its steps and rulesets.
  loadMethod(methodId: string): Promise<Method>;
  // Creates a ruleset, a method or a step and returns its id. Any other table or column is refused.
  create(table: string, payload: Record<string, unknown>): Promise<string>;
  // Switches a method on or off, or sets a queue's assignment method. Anything else is refused.
  update(table: string, id: string, columns: Record<string, unknown>): Promise<void>;
  recordUrl(table: string, id: string): string | undefined;
  // Who is signed in, for the run log.
  currentUser(): string;
}
