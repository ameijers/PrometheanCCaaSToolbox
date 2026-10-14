// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { GUID } from "../../shared/src/columns";
import { cleanId, clientUrl, currentUser, readAll, recordUrl, str } from "../../shared/src/xrm";
import { VoicemailSource } from "./dataSource";
import { Catalog, RulesetRecord } from "./model";
import {
  CONTRACT_TABLE, CREATE_COLUMNS, ENTITY_SETS, HUB_TABLE, INQUEUE_CONTRACTS, MEMBERSHIP_RELATIONSHIP, OVERFLOW_ACTION_TABLE, PREQUEUE_CONTRACTS, QUEUE_TABLE, RECORD_STREAM,
  RULESET_TABLE, UPDATE_COLUMNS, USER_TABLE, VOICEMAIL_ACTION, VOICEMAIL_TABLE, WORKSTREAM_TABLE
} from "./schema";

// The only file that writes to Dataverse. It creates queues, voicemail workstreams and overflow
// rulesets, adds members to queues, and updates two things: a ruleset's rules (overflow rules and the
// voicemail intake rules) and a queue's links to its overflow rulesets. Tables and columns are limited to
// CREATE_COLUMNS and UPDATE_COLUMNS — checked here at runtime and statically by tests/writeScope.test.ts.
// It never deletes.
//
// Reads use Xrm.WebApi. Writes go straight to the Web API (POST and PATCH only): Xrm.WebApi.createRecord
// refuses the routing tables in the browser (found with Assignment Method Copier, same environment).

// The platform's own queues carry this name; they're never offered.
const SYSTEM_QUEUE_NAME = "<CDS System>";

const id = (value: unknown) => (typeof value === "string" && value ? cleanId(value) : undefined);

async function readByIds(table: string, idColumn: string, select: string, ids: string[]): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    rows.push(...await readAll(table, `?$select=${select}&$filter=${ids.slice(i, i + 40).map((x) => `${idColumn} eq ${x}`).join(" or ")}`));
  }
  return rows;
}

async function loadCatalog(): Promise<Catalog> {
  const contractNames = [PREQUEUE_CONTRACTS.input, PREQUEUE_CONTRACTS.output, INQUEUE_CONTRACTS.input, INQUEUE_CONTRACTS.output];
  const [queues, memberships, workstreams, users, hubs, actions, contracts] = await Promise.all([
    readAll(QUEUE_TABLE, "?$select=queueid,name,msdyn_queuetype,_msdyn_operatinghourid_value,_msdyn_prequeueoverflowrulesetid_value,_msdyn_inqueueoverflowrulesetid_value&$filter=msdyn_isomnichannelqueue eq true and statecode eq 0"),
    readAll("queuemembership", "?$select=queueid,systemuserid"),
    readAll(WORKSTREAM_TABLE, "?$select=msdyn_liveworkstreamid,msdyn_name,msdyn_streamsource,_msdyn_masterentityroutingconfigurationid_value,_msdyn_defaultqueue_value&$filter=statecode eq 0"),
    // Interactive users only (accessmode 0); application and non-interactive users can't take work.
    readAll(USER_TABLE, "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled&$filter=accessmode eq 0"),
    readAll(HUB_TABLE, `?$select=msdyn_masterentityroutingconfigurationid,_msdyn_rulesetid_value&$filter=msdyn_entitylogicalname eq '${VOICEMAIL_TABLE}'`),
    readAll(OVERFLOW_ACTION_TABLE, `?$select=msdyn_overflowactionconfigid,msdyn_name&$filter=msdyn_overflowactiontype eq ${VOICEMAIL_ACTION}`),
    readAll(CONTRACT_TABLE, `?$select=msdyn_decisioncontractid,msdyn_name&$filter=${contractNames.map((n) => `msdyn_name eq '${n}'`).join(" or ")}`)
  ]);

  const hub = hubs.length === 1 ? hubs[0] : undefined;
  const rulesetIds = [
    ...queues.flatMap((q) => [id(q._msdyn_prequeueoverflowrulesetid_value), id(q._msdyn_inqueueoverflowrulesetid_value)]),
    id(hub?._msdyn_rulesetid_value)
  ].filter((v): v is string => !!v);
  const rulesets = rulesetIds.length ? await readByIds(RULESET_TABLE, "msdyn_decisionrulesetid", "msdyn_decisionrulesetid,msdyn_name,msdyn_rulesetdefinition", [...new Set(rulesetIds)]) : [];
  const ruleset = (rulesetId: string | undefined): RulesetRecord | undefined => {
    const r = rulesetId ? rulesets.find((x) => cleanId(str(x.msdyn_decisionrulesetid)) === rulesetId) : undefined;
    return r ? { id: rulesetId!, name: str(r.msdyn_name), definition: str(r.msdyn_rulesetdefinition) || undefined } : undefined;
  };
  const contract = (name: string) => { const found = contracts.filter((c) => str(c.msdyn_name) === name); return found.length === 1 ? cleanId(str(found[0].msdyn_decisioncontractid)) : undefined; };
  const voicemail = actions.find((a) => str(a.msdyn_name) === "Voicemail") ?? actions[0];
  const hubRulesetId = id(hub?._msdyn_rulesetid_value);

  return {
    queues: queues.filter((q) => str(q.name) !== SYSTEM_QUEUE_NAME).map((q) => {
      const queueId = cleanId(str(q.queueid));
      return {
        id: queueId, name: str(q.name), type: q.msdyn_queuetype, hasOperatingHours: !!q._msdyn_operatinghourid_value,
        prequeue: ruleset(id(q._msdyn_prequeueoverflowrulesetid_value)), inqueue: ruleset(id(q._msdyn_inqueueoverflowrulesetid_value)),
        memberIds: memberships.filter((m) => id(m.queueid) === queueId).map((m) => cleanId(str(m.systemuserid)))
      };
    }),
    workstreams: workstreams.map((w) => ({
      id: cleanId(str(w.msdyn_liveworkstreamid)), name: str(w.msdyn_name), record: w.msdyn_streamsource === RECORD_STREAM,
      hubId: id(w._msdyn_masterentityroutingconfigurationid_value), defaultQueueId: id(w._msdyn_defaultqueue_value)
    })),
    users: users.map((u) => ({ id: cleanId(str(u.systemuserid)), fullName: str(u.fullname), signIn: str(u.domainname), email: str(u.internalemailaddress) || undefined, disabled: u.isdisabled === true })),
    hub: hub ? { id: cleanId(str(hub.msdyn_masterentityroutingconfigurationid)), rulesetId: hubRulesetId, definition: ruleset(hubRulesetId)?.definition } : undefined,
    voicemailActionId: voicemail ? cleanId(str(voicemail.msdyn_overflowactionconfigid)) : undefined,
    contracts: {
      prequeueInput: contract(PREQUEUE_CONTRACTS.input), prequeueOutput: contract(PREQUEUE_CONTRACTS.output),
      inqueueInput: contract(INQUEUE_CONTRACTS.input), inqueueOutput: contract(INQUEUE_CONTRACTS.output)
    }
  };
}

async function loadDefinition(rulesetId: string): Promise<string | undefined> {
  const rows = await readAll(RULESET_TABLE, `?$select=msdyn_rulesetdefinition&$filter=msdyn_decisionrulesetid eq ${rulesetId}`);
  if (!rows.length) throw new Error("The ruleset no longer exists.");
  return str(rows[0].msdyn_rulesetdefinition) || undefined;
}

function guard(action: string, allowed: Record<string, string[]>, table: string, columns: Record<string, unknown>): void {
  if (!allowed[table]) throw new Error(`This tool doesn't ${action} ${table} records.`);
  const refused = Object.keys(columns).filter((k) => !allowed[table].includes(k));
  if (refused.length) throw new Error(`This tool doesn't write ${refused.join(", ")} on ${table}.`);
}

async function send(method: "POST" | "PATCH", path: string, body: Record<string, unknown>): Promise<Response> {
  const base = clientUrl();
  if (!base || typeof fetch === "undefined") throw new Error("Can't reach the Dataverse Web API from this page.");
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" };
  // Update only: a PATCH must never create a record that isn't there.
  if (method === "PATCH") headers["If-Match"] = "*";
  const response = await fetch(`${base}/api/data/v9.2/${path}`, { method, credentials: "include", headers, body: JSON.stringify(body) });
  if (!response.ok) {
    let failure: any;
    try { failure = await response.json(); } catch { failure = undefined; }
    const code = failure?.error?.code;
    throw new Error(`${failure?.error?.message ?? `HTTP ${response.status}`}${code ? ` (error ${code})` : ""}`);
  }
  return response;
}

async function create(table: string, payload: Record<string, unknown>): Promise<string> {
  guard("create", CREATE_COLUMNS, table, payload);
  const response = await send("POST", ENTITY_SETS[table], payload);
  const created = /\(([0-9a-f-]{36})\)\s*$/i.exec(response.headers.get("OData-EntityId") ?? "");
  if (!created) throw new Error("The record was created, but its id wasn't returned.");
  return cleanId(created[1]);
}

async function update(table: string, recordId: string, columns: Record<string, unknown>): Promise<void> {
  guard("update", UPDATE_COLUMNS, table, columns);
  if (!GUID.test(recordId)) throw new Error("Invalid record id.");
  if (!Object.keys(columns).length) return;
  await send("PATCH", `${ENTITY_SETS[table]}(${recordId})`, columns);
}

async function addMember(queueId: string, userId: string): Promise<void> {
  if (!GUID.test(queueId) || !GUID.test(userId)) throw new Error("Invalid queue or user id.");
  await send("POST", `${ENTITY_SETS[QUEUE_TABLE]}(${queueId})/${MEMBERSHIP_RELATIONSHIP}/$ref`, { "@odata.id": `${clientUrl()}/api/data/v9.2/${ENTITY_SETS[USER_TABLE]}(${userId})` });
}

export const dataverseSource: VoicemailSource = {
  mode: "live", loadCatalog, loadDefinition, create, update, addMember,
  recordUrl: (table, recordId) => recordUrl(table, recordId), currentUser
};
