import { ToolSource } from "../../shared/src/ProvisioningApp";
import { UserCatalog } from "./model";
import { UserWriter } from "./plan";

// In-memory sample environment: users in two business units (one already an agent, one disabled, one
// not an interactive user), roles copied per business unit, owner, access and group teams, capacity
// profiles and a few time zones. Changes are remembered for the session, so running the example twice
// shows everything as "in place".

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const SALES = id(2);
const SERVICE = id(3);
const ROLE = (unit: number, n: number) => id(200 + unit * 10 + n); // n: 0 Basic User, 1 agent, 2 supervisor

const CATALOG: UserCatalog = {
  users: [
    { id: id(100), fullName: "Anna de Vries", signIn: "anna@contoso.com", email: "anna@contoso.com", disabled: false, interactive: true, businessUnitId: SALES, businessUnitName: "Sales", roleIds: [ROLE(2, 0)], timeZone: 110 },
    { id: id(101), fullName: "Bram Jansen", signIn: "bram@contoso.com", email: "bram@contoso.com", disabled: false, interactive: true, businessUnitId: SALES, businessUnitName: "Sales", roleIds: [], timeZone: 110 },
    { id: id(102), fullName: "Chris Peters", signIn: "chris@contoso.com", email: "chris@contoso.com", disabled: false, interactive: true, businessUnitId: SALES, businessUnitName: "Sales", roleIds: [] },
    { id: id(103), fullName: "Dana Smit", signIn: "dana@contoso.com", email: "dana.smit@contoso.com", disabled: false, interactive: true, businessUnitId: SERVICE, businessUnitName: "Service", roleIds: [ROLE(3, 0)], timeZone: 105 },
    { id: id(104), fullName: "Eva Mulder", signIn: "eva@contoso.com", email: "eva@contoso.com", disabled: true, interactive: true, businessUnitId: SALES, businessUnitName: "Sales", roleIds: [] },
    { id: id(105), fullName: "Integration", signIn: "integration@contoso.com", disabled: false, interactive: false, businessUnitId: SALES, businessUnitName: "Sales", roleIds: [] }
  ],
  roles: [2, 3].flatMap((unit) => ["Basic User", "Omnichannel agent", "Omnichannel supervisor"].map((name, n) => ({ id: ROLE(unit, n), name, businessUnitId: id(unit) }))),
  teams: [
    { id: id(300), name: "Sales Agents", teamType: 0, businessUnitName: "Sales", memberIds: [] },
    { id: id(301), name: "Service Agents", teamType: 0, businessUnitName: "Service", memberIds: [id(103)] },
    { id: id(302), name: "Sales Supervisors", teamType: 2, businessUnitName: "Sales", memberIds: [] },
    { id: id(303), name: "Case access", teamType: 1, businessUnitName: "Sales", memberIds: [] }
  ],
  resources: [{ id: id(400), userId: id(103), active: true, profileIds: [id(500)] }],
  capacityProfiles: [
    { id: id(500), name: "Default voice inbound", uniqueName: "msdyn_voice_inbound_profile" },
    { id: id(501), name: "Default voice outbound", uniqueName: "msdyn_voice_default_outbound_profile" },
    { id: id(502), name: "Escalation profile", uniqueName: "msdyn_escalationprofile" }
  ],
  timeZones: [
    { code: 92, standardName: "UTC", displayName: "(GMT) Coordinated Universal Time" },
    { code: 105, standardName: "Romance Standard Time", displayName: "(GMT+01:00) Brussels, Copenhagen, Madrid, Paris" },
    { code: 110, standardName: "W. Europe Standard Time", displayName: "(GMT+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna" }
  ]
};

let catalog: UserCatalog = JSON.parse(JSON.stringify(CATALOG));
let counter = 1000;

export function resetDemo(): void {
  catalog = JSON.parse(JSON.stringify(CATALOG));
  counter = 1000;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 40));
const bound = (payload: Record<string, unknown>, key: string) => String(payload[key] ?? "").match(/\(([^)]+)\)/)?.[1] ?? "";

export const demoWriter: UserWriter = {
  async addRole(userId, roleId) { await pause(); catalog.users.find((u) => u.id === userId)?.roleIds.push(roleId); },
  async addToTeam(teamId, userId) { await pause(); catalog.teams.find((t) => t.id === teamId)?.memberIds.push(userId); },
  async createResource(payload) {
    await pause();
    const newId = id(counter++);
    catalog.resources.push({ id: newId, userId: bound(payload, "UserId@odata.bind"), active: true, profileIds: [] });
    return newId;
  },
  async linkCapacityProfile(payload) {
    await pause();
    catalog.resources.find((r) => r.id === bound(payload, "msdyn_bookableresourceid@odata.bind"))?.profileIds.push(bound(payload, "msdyn_capacityprofileid@odata.bind"));
    return id(counter++);
  }
};

export const demoSource: ToolSource<UserCatalog> = {
  mode: "demo",
  environment: "the sample environment",
  async loadCatalog() { return JSON.parse(JSON.stringify(catalog)); },
  recordUrl: () => undefined,
  currentUser: () => "Sample user"
};
