import { ColumnDef, emptyCsvFrom, exampleCsvFrom } from "../../shared/src/columns";
import { MEMBERSHIP_TYPES, TEAM_TYPES } from "./model";

// One row per Dataverse team. Drives the example file, validation and the in-app column reference.
export const COLUMNS: ColumnDef[] = [
  { header: "team_name", required: true, description: "Name of the team. If a team with this name already exists in the business unit (same type, same group), only its missing security roles are added." },
  { header: "team_type", choices: Object.keys(TEAM_TYPES), defaultValue: "Owner", description: "Owner: members are added in Dataverse and get the team's security roles. Entra ID security group: membership comes from the Microsoft Entra ID group." },
  { header: "business_unit", empty: "the root business unit", description: "Business unit the team belongs to. Must exist and be enabled. Security roles are taken from this business unit." },
  { header: "administrator", empty: "you (the person running the tool)", description: "Sign-in name or email of the team's administrator: an enabled user in this environment." },
  { header: "description", description: "Free text." },
  { header: "entra_group_object_id", description: "Entra ID security group teams only, and required for them: the group's Object ID (a GUID), from the group's overview page in the Microsoft Entra admin center." },
  { header: "membership_type", choices: Object.keys(MEMBERSHIP_TYPES), defaultValue: "Members and guests", description: "Entra ID security group teams only: which members of the group become team members." },
  { header: "security_roles", list: true, empty: "no security roles", description: "Security roles for the team, by name, e.g. Basic User|Omnichannel agent. Each must exist in the team's business unit." }
];

const EXAMPLE_ROWS: Record<string, string>[] = [
  { team_name: "Sales Agents", team_type: "Owner", business_unit: "Sales", administrator: "anna@contoso.com", description: "All sales contact center agents", security_roles: "Basic User|Omnichannel agent" },
  { team_name: "Sales Supervisors", team_type: "Entra ID security group", business_unit: "Sales", administrator: "anna@contoso.com", entra_group_object_id: "d65dcffa-60e8-4519-8e70-9cd95147ba20", membership_type: "Members", security_roles: "Basic User|Omnichannel supervisor" },
  { team_name: "Service Agents", business_unit: "Service", security_roles: "Basic User|Omnichannel agent" },
  { team_name: "All Agents (Entra)", team_type: "Entra ID security group", entra_group_object_id: "0b6f4e1a-2c3d-4e5f-8a9b-1c2d3e4f5a6b", security_roles: "Omnichannel agent" }
];

export const EXAMPLE_FILE_NAME = "teams-example.csv";
export const exampleCsv = (): string => exampleCsvFrom(COLUMNS, EXAMPLE_ROWS);
export const emptyCsv = (): string => emptyCsvFrom(COLUMNS);
