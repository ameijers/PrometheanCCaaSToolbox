// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { cleanId, readAll, str } from "../../shared/src/xrm";
import { RawEnvironment, QUEUE_IDENTIFICATION, buildGraph } from "./graph";
import { Graph, Unread } from "./model";

// The only file that talks to Dataverse, and it only reads (Xrm.WebApi.retrieveMultipleRecords
// through shared/src/xrm.ts). tests/readOnly.test.ts fails on any write method in src/.

type Row = Record<string, any>;

async function readByIds(table: string, idColumn: string, select: string, ids: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    rows.push(...await readAll(table, `?${select}&$filter=${ids.slice(i, i + 40).map((x) => `${idColumn} eq ${x}`).join(" or ")}`));
  }
  return rows;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : typeof (error as any)?.message === "string" ? (error as any).message : String(error);
}

export async function loadRaw(): Promise<RawEnvironment> {
  const warnings: string[] = [];
  const unread: Unread[] = [];
  // Phone numbers, voice channels and skills are optional: without them the rest is still worth seeing.
  const optional = async (what: string, which: Unread, read: () => Promise<Row[]>): Promise<Row[]> => {
    try { return await read(); } catch (error) { warnings.push(`Couldn't read ${what}: ${message(error)}`); unread.push(which); return []; }
  };

  const [phoneNumbers, channels, workstreams, routingConfigurations, routingSteps, queues, memberships, users] = await Promise.all([
    optional("phone numbers", "phoneNumbers", () => readAll("msdyn_ocphonenumber", "?$select=msdyn_ocphonenumberid,msdyn_phonenumber,statecode,msdyn_phoneinboundenabled,msdyn_phoneoutboundenabled")),
    optional("voice channels", "channels", () => readAll("msdyn_ocvoicechannelsetting", "?$select=msdyn_ocvoicechannelsettingid,msdyn_name,_msdyn_phonenumberid_value,_msdyn_liveworkstreamid_value")),
    readAll("msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,msdyn_streamsource,_msdyn_defaultqueue_value&$filter=statecode eq 0"),
    readAll("msdyn_routingconfiguration", "?$select=msdyn_routingconfigurationid,msdyn_isactiveconfiguration,_msdyn_liveworkstreamid_value"),
    readAll("msdyn_routingconfigurationstep", "?$select=msdyn_type,_msdyn_routingconfigurationid_value,_msdyn_rulesetid_value"),
    readAll("queue", "?$select=queueid,name,msdyn_queuetype&$filter=msdyn_isomnichannelqueue eq true and statecode eq 0"),
    readAll("queuemembership", "?$select=queueid,systemuserid"),
    // Interactive users only (accessmode 0); application and non-interactive users can't take work.
    readAll("systemuser", "?$select=systemuserid,fullname,domainname,isdisabled&$filter=accessmode eq 0")
  ]);

  const rulesetIds = [...new Set(routingSteps
    .filter((s) => s.msdyn_type === QUEUE_IDENTIFICATION && s._msdyn_rulesetid_value)
    .map((s) => cleanId(str(s._msdyn_rulesetid_value))))];
  const rulesets = await readByIds("msdyn_decisionruleset", "msdyn_decisionrulesetid", "$select=msdyn_decisionrulesetid,msdyn_name,msdyn_rulesetdefinition,msdyn_disabledrules", rulesetIds);

  const queueIds = new Set(queues.map((q) => cleanId(str(q.queueid))));
  const agentIds = [...new Set(memberships.filter((m) => queueIds.has(cleanId(str(m.queueid)))).map((m) => cleanId(str(m.systemuserid))))];
  const resources = await optional("agents' bookable resources", "resources", () => readByIds("bookableresource", "_userid_value", "$select=bookableresourceid,_userid_value", agentIds));
  const resourceSkills = await optional("skills", "skills", () => readByIds(
    "bookableresourcecharacteristic", "_resource_value", "$select=_resource_value&$expand=Characteristic($select=name),RatingValue($select=name)",
    resources.map((r) => cleanId(str(r.bookableresourceid)))
  ));

  return { phoneNumbers, channels, workstreams, routingConfigurations, routingSteps, rulesets, queues, memberships, users, resources, resourceSkills, warnings, unread };
}

export async function loadGraph(): Promise<Graph> {
  return buildGraph(await loadRaw());
}
