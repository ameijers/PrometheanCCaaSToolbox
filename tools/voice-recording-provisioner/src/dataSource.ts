// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ChannelRow } from "./model";

// What the provisioner needs from an environment. dataverse.ts implements it against the live org;
// demoData.ts in memory for the offline demo.
export interface ProvisionerSource {
  mode: "live" | "demo";
  loadChannels(): Promise<ChannelRow[]>;
  // Updates recording/transcription columns on one voice channel. Any other column is refused.
  updateChannel(channelId: string, columns: Record<string, unknown>): Promise<void>;
  recordUrl(channelId: string): string | undefined;
  // Who is signed in, for the run log.
  currentUser(): string;
}
