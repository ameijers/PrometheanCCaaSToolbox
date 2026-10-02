import { ToolSource } from "../../shared/src/ProvisioningApp";
import { GUID } from "../../shared/src/columns";
import { cleanId, clientUrl, currentUser, currentUserId, environmentLabel, readAll, recordUrl, str, xrmOrThrow } from "../../shared/src/xrm";
import { TeamCatalog } from "./model";
import { TeamWriter } from "./plan";

// The only file in Team Builder that writes. Two writes, nothing else: Xrm.WebApi.createRecord on team,
// and a POST to a team's teamroles_association/$ref to assign a security role. It never updates or
// deletes. tests/writeScope.test.ts checks this statically.

const TEAM_TABLE = "team";

async function loadCatalog(): Promise<TeamCatalog> {
  const [units, users, roles, teams, teamRoles] = await Promise.all([
    readAll("businessunit", "?$select=businessunitid,name,isdisabled,_parentbusinessunitid_value"),
    readAll("systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled,accessmode"),
    readAll("role", "?$select=roleid,name,_businessunitid_value"),
    readAll("team", "?$select=teamid,name,teamtype,_businessunitid_value,azureactivedirectoryobjectid&$filter=isdefault eq false"),
    readAll("teamroles", "?$select=teamid,roleid")
  ]);
  return {
    businessUnits: units.map((u) => ({ id: str(u.businessunitid), name: str(u.name), parentId: u._parentbusinessunitid_value || undefined, disabled: u.isdisabled === true })),
    users: users.map((u) => ({ id: str(u.systemuserid), fullName: str(u.fullname), signIn: str(u.domainname), email: str(u.internalemailaddress) || undefined, disabled: u.isdisabled === true, interactive: u.accessmode === 0 })),
    roles: roles.map((r) => ({ id: str(r.roleid), name: str(r.name), businessUnitId: str(r._businessunitid_value) })),
    teams: teams.map((t) => ({
      id: str(t.teamid), name: str(t.name), teamType: Number(t.teamtype), businessUnitId: str(t._businessunitid_value),
      groupId: t.azureactivedirectoryobjectid || undefined,
      roleIds: teamRoles.filter((tr) => tr.teamid === t.teamid).map((tr) => str(tr.roleid))
    })),
    currentUserId: currentUserId()
  };
}

async function createTeam(payload: Record<string, unknown>): Promise<string> {
  const result: { id?: string } = await xrmOrThrow().WebApi.createRecord(TEAM_TABLE, payload);
  if (!result?.id) throw new Error("Dataverse didn't return an id for the new team.");
  return cleanId(result.id);
}

async function addRole(teamId: string, roleId: string): Promise<void> {
  const base = clientUrl();
  if (!base || typeof fetch === "undefined") throw new Error("Can't reach the Dataverse Web API from this page.");
  if (!GUID.test(teamId) || !GUID.test(roleId)) throw new Error("Invalid team or role id.");
  const response = await fetch(`${base}/api/data/v9.2/teams(${teamId})/teamroles_association/$ref`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" },
    body: JSON.stringify({ "@odata.id": `${base}/api/data/v9.2/roles(${roleId})` })
  });
  if (!response.ok) {
    let body: any;
    try { body = await response.json(); } catch { body = undefined; }
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
}

export const writer: TeamWriter = { createTeam, addRole };

export const source: ToolSource<TeamCatalog> = {
  mode: "live",
  get environment() { return environmentLabel(); },
  loadCatalog,
  recordUrl,
  currentUser
};
