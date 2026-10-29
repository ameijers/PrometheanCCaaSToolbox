// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ChannelRow, PhoneNumber } from "./model";

// What the tool needs from an environment. dataverse.ts implements it against the live org;
// demoData.ts in memory for the sample.
export interface NumberSource {
  mode: "live" | "demo";
  load(): Promise<{ channels: ChannelRow[]; numbers: PhoneNumber[] }>;
  // Sets one voice channel's number and/or caller ID number: an id sets it, null clears it, a missing
  // key isn't written. Nothing else is ever written.
  setNumbers(channelId: string, set: { numberId?: string | null; callerIdId?: string | null }): Promise<void>;
  recordUrl(channelId: string): string | undefined;
  currentUser(): string;
}
