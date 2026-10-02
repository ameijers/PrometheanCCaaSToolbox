// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ToolSource } from "../../shared/src/ProvisioningApp";
import { GUID } from "../../shared/src/columns";
import { cleanId, currentUser, environmentLabel, readAll, recordUrl, str, xrmOrThrow } from "../../shared/src/xrm";
import { SkillCatalog } from "./model";
import { SkillWriter } from "./plan";

// The only file in Skill Assignment that writes. Two writes, both on bookableresourcecharacteristic:
// createRecord (assign a skill to a user's bookable resource) and updateRecord of its rating only (change
// the rating of an existing assignment). It never deletes or deactivates an assignment, and never
// touches any other column or table. tests/writeScope.test.ts checks this statically.

const ASSIGNMENT_TABLE = "bookableresourcecharacteristic";
const RATING_BIND = "RatingValue@odata.bind";

async function loadCatalog(): Promise<SkillCatalog> {
  const [users, units, resources, assignments, skills, ratings, models] = await Promise.all([
    readAll("systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled,accessmode,_businessunitid_value"),
    readAll("businessunit", "?$select=businessunitid,name"),
    readAll("bookableresource", "?$select=bookableresourceid,_userid_value,statecode&$filter=resourcetype eq 3"),
    readAll(ASSIGNMENT_TABLE, "?$select=bookableresourcecharacteristicid,_resource_value,_characteristic_value,_ratingvalue_value&$filter=statecode eq 0"),
    readAll("characteristic", "?$select=characteristicid,name,characteristictype,statecode"),
    readAll("ratingvalue", "?$select=ratingvalueid,name,value,_ratingmodel_value"),
    readAll("ratingmodel", "?$select=ratingmodelid,name&$filter=statecode eq 0")
  ]);
  const unitName = new Map(units.map((u) => [str(u.businessunitid), str(u.name)]));
  const modelName = new Map(models.map((m) => [str(m.ratingmodelid), str(m.name)]));
  return {
    users: users.map((u) => ({ id: str(u.systemuserid), fullName: str(u.fullname), signIn: str(u.domainname), email: str(u.internalemailaddress) || undefined, disabled: u.isdisabled === true, interactive: u.accessmode === 0, businessUnitName: unitName.get(str(u._businessunitid_value)) ?? "" })),
    resources: resources.map((r) => ({
      id: str(r.bookableresourceid), userId: str(r._userid_value), active: r.statecode === 0,
      assignments: assignments.filter((a) => a._resource_value === r.bookableresourceid).map((a) => ({ id: str(a.bookableresourcecharacteristicid), skillId: str(a._characteristic_value), ratingId: a._ratingvalue_value || undefined }))
    })),
    skills: skills.map((s) => ({ id: str(s.characteristicid), name: str(s.name), active: s.statecode === 0, type: Number(s.characteristictype) })),
    // Only values of active rating models.
    ratings: ratings.filter((r) => modelName.has(str(r._ratingmodel_value))).map((r) => ({ id: str(r.ratingvalueid), name: str(r.name), value: Number(r.value), modelName: modelName.get(str(r._ratingmodel_value))! }))
  };
}

async function assign(payload: Record<string, unknown>): Promise<string> {
  const result: { id?: string } = await xrmOrThrow().WebApi.createRecord(ASSIGNMENT_TABLE, payload);
  if (!result?.id) throw new Error("Dataverse didn't return an id for the skill assignment.");
  return cleanId(result.id);
}

async function changeRating(assignmentId: string, ratingId: string): Promise<void> {
  if (!GUID.test(assignmentId) || !GUID.test(ratingId)) throw new Error("Invalid assignment or rating id.");
  await xrmOrThrow().WebApi.updateRecord(ASSIGNMENT_TABLE, assignmentId, { [RATING_BIND]: `/ratingvalues(${ratingId})` });
}

export const writer: SkillWriter = { assign, changeRating };

export const source: ToolSource<SkillCatalog> = {
  mode: "live",
  get environment() { return environmentLabel(); },
  loadCatalog,
  recordUrl,
  currentUser
};
