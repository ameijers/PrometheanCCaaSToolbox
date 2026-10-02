import { ToolSource } from "../../shared/src/ProvisioningApp";
import { TeamCatalog } from "./model";
import { TeamWriter } from "./plan";

// In-memory sample environment: business units (one disabled), users, each role copied per business
// unit (as Dataverse does), and one existing group team. Created teams and roles are remembered for the
// session, so running the example twice shows everything as "in place".

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const UNITS = [
  { id: id(1), name: "Contoso", disabled: false },
  { id: id(2), name: "Sales", parentId: id(1), disabled: false },
  { id: id(3), name: "Service", parentId: id(1), disabled: false },
  { id: id(4), name: "Legacy", parentId: id(1), disabled: true }
];
const ROLE_NAMES = ["Basic User", "Omnichannel agent", "Omnichannel supervisor", "System Administrator"];

const CATALOG: TeamCatalog = {
  businessUnits: UNITS,
  users: [
    { id: id(100), fullName: "Anna de Vries", signIn: "anna@contoso.com", email: "anna@contoso.com", disabled: false, interactive: true },
    { id: id(101), fullName: "Bram Jansen", signIn: "bram@contoso.com", email: "bram@contoso.com", disabled: false, interactive: true },
    { id: id(102), fullName: "Eva Mulder", signIn: "eva@contoso.com", email: "eva@contoso.com", disabled: true, interactive: true },
    { id: id(103), fullName: "Integration", signIn: "integration@contoso.com", disabled: false, interactive: false }
  ],
  roles: UNITS.flatMap((u, i) => ROLE_NAMES.map((name, j) => ({ id: id(200 + i * 10 + j), name, businessUnitId: u.id }))),
  teams: [{ id: id(300), name: "Sales Supervisors", teamType: 2, businessUnitId: id(2), groupId: "d65dcffa-60e8-4519-8e70-9cd95147ba20", roleIds: [id(210)] }],
  currentUserId: id(100)
};

let catalog: TeamCatalog = JSON.parse(JSON.stringify(CATALOG));
let counter = 1000;

export function resetDemo(): void {
  catalog = JSON.parse(JSON.stringify(CATALOG));
  counter = 1000;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 40));

export const demoWriter: TeamWriter = {
  async createTeam(payload) {
    await pause();
    const newId = id(counter++);
    const bound = (k: string) => String(payload[k] ?? "").match(/\(([^)]+)\)/)?.[1] ?? "";
    catalog.teams.push({ id: newId, name: String(payload.name), teamType: Number(payload.teamtype), businessUnitId: bound("businessunitid@odata.bind"), groupId: payload.azureactivedirectoryobjectid as string | undefined, roleIds: [] });
    return newId;
  },
  async addRole(teamId, roleId) {
    await pause();
    catalog.teams.find((t) => t.id === teamId)?.roleIds.push(roleId);
  }
};

export const demoSource: ToolSource<TeamCatalog> = {
  mode: "demo",
  environment: "the sample environment",
  async loadCatalog() { return JSON.parse(JSON.stringify(catalog)); },
  recordUrl: () => undefined,
  currentUser: () => "Sample user"
};
