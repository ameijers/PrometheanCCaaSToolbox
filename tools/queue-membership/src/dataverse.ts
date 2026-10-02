// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ToolSource } from "../../shared/src/ProvisioningApp";
import { GUID } from "../../shared/src/columns";
import { clientUrl, currentUser, environmentLabel, readAll, recordUrl, str } from "../../shared/src/xrm";
import { MembershipCatalog } from "./model";
import { MembershipWriter } from "./plan";

// The only file in Queue Membership that writes, and it writes one thing: a POST to a queue's
// queuemembership_association/$ref to add a member (the same write Queue Builder uses). It never
// removes members, updates or deletes. tests/writeScope.test.ts checks this statically.

async function loadCatalog(): Promise<MembershipCatalog> {
  const [users, resources, links, queues, members] = await Promise.all([
    readAll("systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled,accessmode"),
    readAll("bookableresource", "?$select=bookableresourceid,_userid_value,statecode&$filter=resourcetype eq 3"),
    readAll("msdyn_bookableresourcecapacityprofile", "?$select=_msdyn_bookableresourceid_value"),
    readAll("queue", "?$select=queueid,name,msdyn_isomnichannelqueue,statecode"),
    readAll("queuemembership", "?$select=queueid,systemuserid")
  ]);
  return {
    users: users.map((u) => ({ id: str(u.systemuserid), fullName: str(u.fullname), signIn: str(u.domainname), email: str(u.internalemailaddress) || undefined, disabled: u.isdisabled === true, interactive: u.accessmode === 0 })),
    resources: resources.map((r) => ({ userId: str(r._userid_value), active: r.statecode === 0, profileCount: links.filter((l) => l._msdyn_bookableresourceid_value === r.bookableresourceid).length })),
    queues: queues.map((q) => ({ id: str(q.queueid), name: str(q.name), advanced: q.msdyn_isomnichannelqueue === true, active: q.statecode === 0, memberIds: members.filter((m) => m.queueid === q.queueid).map((m) => str(m.systemuserid)) }))
  };
}

async function addToQueue(queueId: string, userId: string): Promise<void> {
  const base = clientUrl();
  if (!base || typeof fetch === "undefined") throw new Error("Can't reach the Dataverse Web API from this page.");
  if (!GUID.test(queueId) || !GUID.test(userId)) throw new Error("Invalid queue or user id.");
  const response = await fetch(`${base}/api/data/v9.2/queues(${queueId})/queuemembership_association/$ref`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" },
    body: JSON.stringify({ "@odata.id": `${base}/api/data/v9.2/systemusers(${userId})` })
  });
  if (!response.ok) {
    let body: any;
    try { body = await response.json(); } catch { body = undefined; }
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
}

export const writer: MembershipWriter = { addToQueue };

export const source: ToolSource<MembershipCatalog> = {
  mode: "live",
  get environment() { return environmentLabel(); },
  loadCatalog,
  recordUrl,
  currentUser
};
