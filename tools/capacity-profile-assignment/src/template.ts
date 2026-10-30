// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ColumnDef, emptyCsvFrom, exampleCsvFrom } from "../../shared/src/columns";

// One row per user. Drives the example file, validation and the in-app column reference.
export const COLUMNS: ColumnDef[] = [
  { header: "user", required: true, description: "Sign-in name or email of the user. The user must already be a bookable resource (set up with User Setup)." },
  { header: "capacity_profiles", required: true, list: true, description: "Capacity profiles to assign, by name or unique name, e.g. Default voice inbound|Default voice outbound. Profiles the user already has are left alone." }
];

const EXAMPLE_ROWS: Record<string, string>[] = [
  { user: "anna@contoso.com", capacity_profiles: "Escalation profile" },
  { user: "bram@contoso.com", capacity_profiles: "Default voice inbound|Default voice outbound" },
  { user: "dana.smit@contoso.com", capacity_profiles: "msdyn_voice_inbound_profile|Default voice outbound" }
];

export const EXAMPLE_FILE_NAME = "capacity-profiles-example.csv";
export const exampleCsv = (): string => exampleCsvFrom(COLUMNS, EXAMPLE_ROWS);
export const emptyCsv = (): string => emptyCsvFrom(COLUMNS);
