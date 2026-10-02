import { ColumnDef, emptyCsvFrom, exampleCsvFrom } from "../../shared/src/columns";

// One row per user. Drives the example file, validation and the in-app column reference.
export const COLUMNS: ColumnDef[] = [
  { header: "user", required: true, description: "Sign-in name or email of the user. The user must already be in this environment: licensed and in the environment's security group, then synced from Microsoft Entra ID." },
  { header: "security_roles", list: true, empty: "no roles assigned directly", description: "Security roles to assign to the user directly, by name. Each must exist in the user's own business unit. Roles the user already has are left alone." },
  { header: "teams", list: true, empty: "not added to a team", description: "Owner teams to add the user to, by name. The user gets the team's security roles. (Members of an Entra ID security group team come from the group in Entra ID, not from here.)" },
  { header: "capacity_profiles", list: true, empty: "Default voice inbound and Default voice outbound", description: "Capacity profiles for the user as an agent, by name or unique name. Write none to link no capacity profile." },
  { header: "time_zone", empty: "the user's own time zone", description: "Time zone of the user's bookable resource: its code (e.g. 110) or name (e.g. W. Europe Standard Time). Only used when the bookable resource is created." }
];

const EXAMPLE_ROWS: Record<string, string>[] = [
  { user: "anna@contoso.com", security_roles: "Basic User|Omnichannel agent" },
  { user: "bram@contoso.com", teams: "Sales Agents", capacity_profiles: "Default voice inbound" },
  { user: "chris@contoso.com", security_roles: "Basic User", teams: "Sales Agents", time_zone: "W. Europe Standard Time" },
  { user: "dana.smit@contoso.com", teams: "Service Agents", capacity_profiles: "Default voice inbound|Escalation profile", time_zone: "110" }
];

export const EXAMPLE_FILE_NAME = "users-example.csv";
export const exampleCsv = (): string => exampleCsvFrom(COLUMNS, EXAMPLE_ROWS);
export const emptyCsv = (): string => emptyCsvFrom(COLUMNS);
