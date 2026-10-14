// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { GUID } from "../../shared/src/columns";
import { cleanId, clientUrl, currentUser, readAll, recordUrl, str } from "../../shared/src/xrm";
import { RouteSource } from "./dataSource";
import { Catalog, RoutingRecord, WorkstreamRecord } from "./model";
import {
  CONFIG_TABLE, CONTRACT_TABLE, CREATE_COLUMNS, ENTITY_SETS, QUEUE_IDENTIFICATION, QUEUE_OUTPUT_CONTRACT_NAME, QUEUE_TABLE, RULESET_TABLE, STEP_TABLE, UPDATE_COLUMNS,
  VARIABLE_TABLE, VOICE_STREAM, WORKSTREAM_TABLE
} from "./schema";

// The only file that writes to Dataverse. It creates context variables, routing configurations,
// rulesets and route-to-queue steps, and updates one thing: a ruleset's rules. Tables and columns are
// limited to CREATE_COLUMNS and UPDATE_COLUMNS — checked here at runtime and statically by
// tests/writeScope.test.ts. It never deletes.
//
// Reads use Xrm.WebApi. Writes go straight to the Web API (POST and PATCH only): Xrm.WebApi.createRecord
// refuses the routing tables in the browser (found with Assignment Method Copier, same environment).

// The platform's own queues carry this name; they're never offered.
const SYSTEM_QUEUE_NAME = "<CDS System>";

const id = (value: unknown) => (typeof value === "string" && value ? cleanId(value) : undefined);

async function readByIds(table: string, idColumn: string, select: string, ids: string[]): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    rows.push(...await readAll(table, `?$select=${select}&$filter=${chunk.map((x) => `${idColumn} eq ${x}`).join(" or ")}`));
  }
  return rows;
}

async function loadCatalog(): Promise<Catalog> {
  const [workstreams, variables, configs, steps, queues, contracts] = await Promise.all([
    readAll(WORKSTREAM_TABLE, "?$select=msdyn_liveworkstreamid,msdyn_name,msdyn_streamsource,_msdyn_routingcontractid_value&$filter=statecode eq 0"),
    readAll(VARIABLE_TABLE, "?$select=msdyn_ocliveworkstreamcontextvariableid,msdyn_name,msdyn_datatype,_msdyn_liveworkstreamid_value"),
    readAll(CONFIG_TABLE, "?$select=msdyn_routingconfigurationid,msdyn_name,msdyn_isactiveconfiguration,_msdyn_liveworkstreamid_value"),
    readAll(STEP_TABLE, "?$select=msdyn_type,msdyn_steporder,_msdyn_routingconfigurationid_value,_msdyn_rulesetid_value"),
    readAll(QUEUE_TABLE, "?$select=queueid,name,msdyn_queuetype&$filter=msdyn_isomnichannelqueue eq true and statecode eq 0"),
    readAll(CONTRACT_TABLE, `?$select=msdyn_decisioncontractid&$filter=msdyn_name eq '${QUEUE_OUTPUT_CONTRACT_NAME}'`)
  ]);

  const queueRulesetIds = steps.filter((s) => s.msdyn_type === QUEUE_IDENTIFICATION).map((s) => id(s._msdyn_rulesetid_value)).filter((v): v is string => !!v);
  const rulesets = queueRulesetIds.length ? await readByIds(RULESET_TABLE, "msdyn_decisionrulesetid", "msdyn_decisionrulesetid,msdyn_name,msdyn_rulesetdefinition", [...new Set(queueRulesetIds)]) : [];

  return {
    workstreams: workstreams.map((w): WorkstreamRecord => {
      const wsId = cleanId(str(w.msdyn_liveworkstreamid));
      const own = configs.filter((c) => id(c._msdyn_liveworkstreamid_value) === wsId);
      const active = own.find((c) => c.msdyn_isactiveconfiguration === true);
      let routing: RoutingRecord | undefined;
      if (active) {
        const configId = cleanId(str(active.msdyn_routingconfigurationid));
        const configSteps = steps.filter((s) => id(s._msdyn_routingconfigurationid_value) === configId);
        const queueSteps = configSteps.filter((s) => s.msdyn_type === QUEUE_IDENTIFICATION);
        const ruleset = queueSteps.length ? rulesets.find((r) => cleanId(str(r.msdyn_decisionrulesetid)) === id(queueSteps[0]._msdyn_rulesetid_value)) : undefined;
        routing = {
          configId, configName: str(active.msdyn_name), stepOrders: configSteps.map((s) => Number(s.msdyn_steporder) || 0), queueRulesets: queueSteps.length,
          queueRuleset: ruleset ? { id: cleanId(str(ruleset.msdyn_decisionrulesetid)), name: str(ruleset.msdyn_name), definition: str(ruleset.msdyn_rulesetdefinition) || undefined } : undefined
        };
      }
      return {
        id: wsId,
        name: str(w.msdyn_name),
        voice: w.msdyn_streamsource === VOICE_STREAM,
        routingContractId: id(w._msdyn_routingcontractid_value),
        variables: variables.filter((v) => id(v._msdyn_liveworkstreamid_value) === wsId).map((v) => ({ id: cleanId(str(v.msdyn_ocliveworkstreamcontextvariableid)), name: str(v.msdyn_name), dataType: v.msdyn_datatype })),
        routing,
        routingInactive: own.length > 0 && !active
      };
    }),
    queues: queues.filter((q) => str(q.name) !== SYSTEM_QUEUE_NAME).map((q) => ({ id: cleanId(str(q.queueid)), name: str(q.name), type: q.msdyn_queuetype })),
    outputContractId: contracts.length === 1 ? cleanId(str(contracts[0].msdyn_decisioncontractid)) : undefined
  };
}

async function loadRulesetDefinition(rulesetId: string): Promise<string | undefined> {
  const rows = await readAll(RULESET_TABLE, `?$select=msdyn_rulesetdefinition&$filter=msdyn_decisionrulesetid eq ${rulesetId}`);
  if (!rows.length) throw new Error("The ruleset no longer exists.");
  return str(rows[0].msdyn_rulesetdefinition) || undefined;
}

async function loadContractDefinition(contractId: string): Promise<string | undefined> {
  const rows = await readAll(CONTRACT_TABLE, `?$select=msdyn_contractdefinition&$filter=msdyn_decisioncontractid eq ${contractId}`);
  return rows.length ? str(rows[0].msdyn_contractdefinition) || undefined : undefined;
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

export const dataverseSource: RouteSource = {
  mode: "live", loadCatalog, loadRulesetDefinition, loadContractDefinition, create, update,
  recordUrl: (table, recordId) => recordUrl(table, recordId), currentUser
};
