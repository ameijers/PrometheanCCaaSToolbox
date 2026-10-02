// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Catalog } from "./model";

// What the queue builder needs from an environment. dataverse.ts implements it against the live org;
// demoData.ts in memory for the offline demo.
export interface QueueSource {
  mode: "live" | "demo";
  loadCatalog(): Promise<Catalog>;
  // Creates one advanced queue and returns its id.
  createQueue(payload: Record<string, unknown>): Promise<string>;
  // Adds one user to a queue's members (queuemembership_association).
  addMember(queueId: string, userId: string): Promise<void>;
  // Whether the platform gave the new queue its assignment input decision contract; undefined when it
  // can't be read.
  hasAssignmentContract(queueId: string): Promise<boolean | undefined>;
  recordUrl(queueId: string): string | undefined;
  currentUser(): string;
}
