// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { GUID } from "../../shared/src/columns";
import { cleanId, clientUrl, currentUser, readAll, recordUrl, str } from "../../shared/src/xrm";
import { CopierSource } from "./dataSource";
import { Method, QueueRow, Ruleset } from "./model";
import { CREATE_COLUMNS, ENTITY_SETS, METHOD_TABLE, QUEUE_TABLE, RULESET_TABLE, STEP_TABLE, UPDATE_COLUMNS } from "./schema";

// The only file that writes to Dataverse. It creates rulesets, assignment methods and their steps, and
// updates two things: a method's active switch and a queue's assignment method. Tables and columns
// are limited to CREATE_COLUMNS and UPDATE_COLUMNS — checked here at runtime and statically by
// tests/writeScope.test.ts. It never deletes.
//
// Reads use Xrm.WebApi. Writes go straight to the Web API (POST and PATCH only): in the live
// environment Xrm.WebApi.createRecord refused these tables in the browser with "A required parameter is
// not valid or is missing", while the Web API accepted the same record.

// The platform's own queues (voicemail and the like) carry this name; they're left alone.
const SYSTEM_QUEUE_NAME = "<CDS System>";

const id = (value: unknown) => (typeof value === "string" && value ? cleanId(value) : undefined);

async function loadQueues(): Promise<QueueRow[]> {
  const [queues, methods] = await Promise.all([
    readAll(QUEUE_TABLE, "?$select=queueid,name,msdyn_queuetype,msdyn_assignmentstrategy,_msdyn_assignmentinputcontractid_value&$filter=msdyn_isomnichannelqueue eq true and statecode eq 0"),
    readAll(METHOD_TABLE, "?$select=msdyn_assignmentconfigurationid,msdyn_name,msdyn_isactiveconfiguration,_msdyn_queueid_value&$filter=statecode eq 0")
  ]);
  return queues.filter((q) => str(q.name) !== SYSTEM_QUEUE_NAME).map((q) => ({
    id: cleanId(str(q.queueid)),
    name: str(q.name) || "(unnamed queue)",
    type: q.msdyn_queuetype,
    strategy: q.msdyn_assignmentstrategy,
    inputContractId: id(q._msdyn_assignmentinputcontractid_value),
    methods: methods.filter((m) => id(m._msdyn_queueid_value) === cleanId(str(q.queueid)))
      .map((m) => ({ id: cleanId(str(m.msdyn_assignmentconfigurationid)), name: str(m.msdyn_name), active: m.msdyn_isactiveconfiguration === true }))
  }));
}

function ruleset(r: Record<string, any>): Ruleset {
  return {
    id: cleanId(str(r.msdyn_decisionrulesetid)),
    name: str(r.msdyn_name),
    description: str(r.msdyn_description) || undefined,
    definition: str(r.msdyn_rulesetdefinition),
    rulesetType: r.msdyn_rulesettype,
    authoringMode: r.msdyn_authoringmode ?? undefined,
    inputContractId: id(r._msdyn_inputcontractid_value),
    outputContractId: id(r._msdyn_outputcontractid_value),
    isInputCollection: r.msdyn_isinputcollection === true,
    persistOutputData: r.msdyn_persistoutputdata === true,
    refreshInputData: r.msdyn_refreshinputdata === true,
    disabledRules: str(r.msdyn_disabledrules) || undefined
  };
}

async function loadMethod(methodId: string): Promise<Method> {
  const [methods, steps] = await Promise.all([
    readAll(METHOD_TABLE, `?$select=msdyn_assignmentconfigurationid,msdyn_name,msdyn_description,msdyn_isactiveconfiguration,_msdyn_queueid_value&$filter=msdyn_assignmentconfigurationid eq ${methodId}`),
    readAll(STEP_TABLE, `?$select=msdyn_assignmentconfigurationstepid,msdyn_name,msdyn_type,msdyn_steporder,msdyn_isdefaultruleset,_msdyn_rulesetid_value&$filter=_msdyn_assignmentconfigurationid_value eq ${methodId} and statecode eq 0&$orderby=msdyn_steporder asc`)
  ]);
  if (!methods.length) throw new Error("The assignment method no longer exists.");
  const rulesetIds = steps.map((s) => id(s._msdyn_rulesetid_value)).filter((v): v is string => !!v);
  const rulesets = rulesetIds.length
    ? await readAll(RULESET_TABLE, `?$select=msdyn_decisionrulesetid,msdyn_name,msdyn_description,msdyn_rulesetdefinition,msdyn_rulesettype,msdyn_authoringmode,msdyn_isinputcollection,msdyn_persistoutputdata,msdyn_refreshinputdata,msdyn_disabledrules,_msdyn_inputcontractid_value,_msdyn_outputcontractid_value&$filter=${rulesetIds.map((r) => `msdyn_decisionrulesetid eq ${r}`).join(" or ")}`)
    : [];
  const m = methods[0];
  return {
    id: cleanId(str(m.msdyn_assignmentconfigurationid)),
    name: str(m.msdyn_name),
    description: str(m.msdyn_description) || undefined,
    active: m.msdyn_isactiveconfiguration === true,
    queueId: id(m._msdyn_queueid_value) ?? "",
    steps: steps.map((s) => {
      const found = rulesets.find((r) => cleanId(str(r.msdyn_decisionrulesetid)) === id(s._msdyn_rulesetid_value));
      return { id: cleanId(str(s.msdyn_assignmentconfigurationstepid)), name: str(s.msdyn_name), type: s.msdyn_type, order: s.msdyn_steporder ?? 0, isDefault: s.msdyn_isdefaultruleset === true, ruleset: found ? ruleset(found) : undefined };
    })
  };
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

export const dataverseSource: CopierSource = { mode: "live", loadQueues, loadMethod, create, update, recordUrl, currentUser };
