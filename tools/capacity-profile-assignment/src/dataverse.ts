// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ToolSource } from "../../shared/src/ProvisioningApp";
import { cleanId, currentUser, environmentLabel, readAll, recordUrl, str, xrmOrThrow } from "../../shared/src/xrm";
import { CapacityCatalog } from "./model";
import { CapacityWriter } from "./plan";

// The only file in Capacity Profile Assignment that writes. One write: createRecord on
// msdyn_bookableresourcecapacityprofile (link a capacity profile to a user's bookable resource). It never
// updates, deletes or deactivates a link, and never touches any other table. tools/shared/tests/
// writeScopes.test.ts checks this statically.

const LINK_TABLE = "msdyn_bookableresourcecapacityprofile";

async function loadCatalog(): Promise<CapacityCatalog> {
  const [users, units, resources, links, profiles] = await Promise.all([
    readAll("systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled,accessmode,_businessunitid_value"),
    readAll("businessunit", "?$select=businessunitid,name"),
    readAll("bookableresource", "?$select=bookableresourceid,_userid_value,statecode&$filter=resourcetype eq 3"),
    readAll(LINK_TABLE, "?$select=_msdyn_bookableresourceid_value,_msdyn_capacityprofileid_value&$filter=statecode eq 0"),
    readAll("msdyn_capacityprofile", "?$select=msdyn_capacityprofileid,msdyn_name,msdyn_uniquename,msdyn_defaultmaxunits,statecode")
  ]);
  const unitName = new Map(units.map((u) => [str(u.businessunitid), str(u.name)]));
  return {
    users: users.map((u) => ({ id: str(u.systemuserid), fullName: str(u.fullname), signIn: str(u.domainname), email: str(u.internalemailaddress) || undefined, disabled: u.isdisabled === true, interactive: u.accessmode === 0, businessUnitName: unitName.get(str(u._businessunitid_value)) ?? "" })),
    resources: resources.map((r) => ({
      id: str(r.bookableresourceid), userId: str(r._userid_value), active: r.statecode === 0,
      profileIds: links.filter((l) => l._msdyn_bookableresourceid_value === r.bookableresourceid).map((l) => str(l._msdyn_capacityprofileid_value))
    })),
    profiles: profiles.map((p) => ({
      id: str(p.msdyn_capacityprofileid), name: str(p.msdyn_name), uniqueName: str(p.msdyn_uniquename) || undefined, active: p.statecode === 0,
      defaultMaxUnits: typeof p.msdyn_defaultmaxunits === "number" ? p.msdyn_defaultmaxunits : undefined
    }))
  };
}

async function link(payload: Record<string, unknown>): Promise<string> {
  const result: { id?: string } = await xrmOrThrow().WebApi.createRecord(LINK_TABLE, payload);
  if (!result?.id) throw new Error("Dataverse didn't return an id for the capacity profile link.");
  return cleanId(result.id);
}

export const writer: CapacityWriter = { link };

export const source: ToolSource<CapacityCatalog> = {
  mode: "live",
  get environment() { return environmentLabel(); },
  loadCatalog,
  recordUrl,
  currentUser
};
