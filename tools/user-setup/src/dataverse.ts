// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ToolSource } from "../../shared/src/ProvisioningApp";
import { GUID } from "../../shared/src/columns";
import { cleanId, clientUrl, currentUser, environmentLabel, readAll, recordUrl, str, xrmOrThrow } from "../../shared/src/xrm";
import { UserCatalog } from "./model";
import { UserWriter } from "./plan";

// The only file in User Setup that writes. Four writes, nothing else:
//   - a POST to a user's systemuserroles_association/$ref (assign a security role),
//   - the AddMembersTeam action on an owner team (add a member),
//   - Xrm.WebApi.createRecord on bookableresource,
//   - Xrm.WebApi.createRecord on msdyn_bookableresourcecapacityprofile.
// It never creates users, never updates or deletes, never removes roles or memberships.
// tests/writeScope.test.ts checks this statically.

const RESOURCE_TABLE = "bookableresource";
const CAPACITY_LINK_TABLE = "msdyn_bookableresourcecapacityprofile";

async function loadCatalog(): Promise<UserCatalog> {
  const [users, units, roles, userRoles, teams, members, resources, links, profiles, zones, settings] = await Promise.all([
    readAll("systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled,accessmode,_businessunitid_value"),
    readAll("businessunit", "?$select=businessunitid,name"),
    readAll("role", "?$select=roleid,name,_businessunitid_value"),
    readAll("systemuserroles", "?$select=systemuserid,roleid"),
    readAll("team", "?$select=teamid,name,teamtype,_businessunitid_value&$filter=isdefault eq false"),
    readAll("teammembership", "?$select=teamid,systemuserid"),
    readAll("bookableresource", "?$select=bookableresourceid,_userid_value,statecode&$filter=resourcetype eq 3"),
    readAll("msdyn_bookableresourcecapacityprofile", "?$select=_msdyn_bookableresourceid_value,_msdyn_capacityprofileid_value"),
    readAll("msdyn_capacityprofile", "?$select=msdyn_capacityprofileid,msdyn_name,msdyn_uniquename&$filter=statecode eq 0"),
    readAll("timezonedefinition", "?$select=timezonecode,standardname,userinterfacename"),
    readAll("usersettings", "?$select=systemuserid,timezonecode")
  ]);
  const unitName = new Map(units.map((u) => [str(u.businessunitid), str(u.name)]));
  const zoneOf = new Map(settings.map((s) => [str(s.systemuserid), typeof s.timezonecode === "number" ? s.timezonecode : undefined]));
  return {
    users: users.map((u) => ({
      id: str(u.systemuserid), fullName: str(u.fullname), signIn: str(u.domainname), email: str(u.internalemailaddress) || undefined,
      disabled: u.isdisabled === true, interactive: u.accessmode === 0,
      businessUnitId: str(u._businessunitid_value), businessUnitName: unitName.get(str(u._businessunitid_value)) ?? "",
      roleIds: userRoles.filter((r) => r.systemuserid === u.systemuserid).map((r) => str(r.roleid)),
      timeZone: zoneOf.get(str(u.systemuserid))
    })),
    roles: roles.map((r) => ({ id: str(r.roleid), name: str(r.name), businessUnitId: str(r._businessunitid_value) })),
    teams: teams.map((t) => ({
      id: str(t.teamid), name: str(t.name), teamType: Number(t.teamtype), businessUnitName: unitName.get(str(t._businessunitid_value)) ?? "",
      memberIds: members.filter((m) => m.teamid === t.teamid).map((m) => str(m.systemuserid))
    })),
    resources: resources.map((r) => ({
      id: str(r.bookableresourceid), userId: str(r._userid_value), active: r.statecode === 0,
      profileIds: links.filter((l) => l._msdyn_bookableresourceid_value === r.bookableresourceid).map((l) => str(l._msdyn_capacityprofileid_value))
    })),
    capacityProfiles: profiles.map((p) => ({ id: str(p.msdyn_capacityprofileid), name: str(p.msdyn_name), uniqueName: str(p.msdyn_uniquename) || undefined })),
    timeZones: zones.map((z) => ({ code: Number(z.timezonecode), standardName: str(z.standardname), displayName: str(z.userinterfacename) }))
  };
}

async function post(path: string, body: unknown): Promise<void> {
  const base = clientUrl();
  if (!base || typeof fetch === "undefined") throw new Error("Can't reach the Dataverse Web API from this page.");
  const response = await fetch(`${base}/api/data/v9.2/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    let parsed: any;
    try { parsed = await response.json(); } catch { parsed = undefined; }
    throw new Error(parsed?.error?.message ?? `HTTP ${response.status}`);
  }
}

async function addRole(userId: string, roleId: string): Promise<void> {
  if (!GUID.test(userId) || !GUID.test(roleId)) throw new Error("Invalid user or role id.");
  await post(`systemusers(${userId})/systemuserroles_association/$ref`, { "@odata.id": `${clientUrl()}/api/data/v9.2/roles(${roleId})` });
}

async function addToTeam(teamId: string, userId: string): Promise<void> {
  if (!GUID.test(teamId) || !GUID.test(userId)) throw new Error("Invalid team or user id.");
  await post(`teams(${teamId})/Microsoft.Dynamics.CRM.AddMembersTeam`, { Members: [{ "@odata.type": "Microsoft.Dynamics.CRM.systemuser", systemuserid: userId }] });
}

async function createResource(payload: Record<string, unknown>): Promise<string> {
  const result: { id?: string } = await xrmOrThrow().WebApi.createRecord(RESOURCE_TABLE, payload);
  if (!result?.id) throw new Error("Dataverse didn't return an id for the new bookable resource.");
  return cleanId(result.id);
}

async function linkCapacityProfile(payload: Record<string, unknown>): Promise<string> {
  const result: { id?: string } = await xrmOrThrow().WebApi.createRecord(CAPACITY_LINK_TABLE, payload);
  if (!result?.id) throw new Error("Dataverse didn't return an id for the capacity profile link.");
  return cleanId(result.id);
}

export const writer: UserWriter = { addRole, addToTeam, createResource, linkCapacityProfile };

export const source: ToolSource<UserCatalog> = {
  mode: "live",
  get environment() { return environmentLabel(); },
  loadCatalog,
  recordUrl,
  currentUser
};
