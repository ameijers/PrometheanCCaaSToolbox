// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { RouteSource } from "./dataSource";
import { Catalog, WorkstreamRecord } from "./model";
import { CONFIG_TABLE, CREATE_COLUMNS, QUEUE_IDENTIFICATION, RULESET_TABLE, STEP_TABLE, UPDATE_COLUMNS, VARIABLE_TABLE } from "./schema";

// An in-memory sample environment: a workstream without routing, one with a route-to-queue ruleset that
// already has a rule and the context variable, one whose routing has only a classification step, one
// with the variable as a number, a messaging workstream, one without a routing contract and one whose
// ruleset is rejected — so the demo shows every path. The platform's background update of the routing
// contract is simulated: a new variable shows up in the contract one read later. Writes go through the
// same table and column limits as the live source.

const guid = (group: string, n: number) => `00000000-0000-4000-${group}-${String(n).padStart(12, "0")}`;
const VOICE = 192350002, MESSAGING = 192350000;
const OUTPUT_CONTRACT = guid("9000", 1);

const SUPPORT_RULES = `<decision hit-policy="all" version="1">
  <rules>
    <rule id="${guid("9100", 1)}" name="Route to billing questions">
      <logical operator="AND">
        <logical operator="AND">
          <condition operator="==">
            <lhs type="attribute">liveworkitemcontext.SelectedMenuItem</lhs>
            <rhs type="staticvalue">Billing</rhs>
          </condition>
        </logical>
      </logical>
      <action>
        <setattribute>
          <lhs type="attribute">assign_to.queue</lhs>
          <rhs type="staticvalue">${guid("8000", 5)}</rhs>
        </setattribute>
      </action>
    </rule>
  </rules>
</decision>`;

// The workstream whose new ruleset is rejected, to show how a failure is reported.
const LOCKED = "Escalations – Voice";

interface DemoState {
  catalog: Catalog;
  rulesets: Map<string, string | undefined>;
  contracts: Map<string, string>;
  pendingVariables: Map<string, string[]>; // contract id -> variables the "platform" hasn't added yet
  readOnce: Set<string>;                   // contracts read once since a variable was added
  next: number;
}

function contract(variables: string[]): string {
  return `<contract version="1">\n  <entity logical-name="msdyn_ocliveworkitem" key="msdyn_ocliveworkitem" />\n  <complex key="liveworkitemcontext">\n${variables.map((v) => `    <variable name="${v}" data-type="string" />\n`).join("")}  </complex>\n</contract>`;
}

function initialState(): DemoState {
  const ws = (n: number, name: string, extra: Partial<WorkstreamRecord> = {}): WorkstreamRecord =>
    ({ id: guid("8100", n), name, voice: true, routingContractId: guid("8200", n), variables: [], ...extra });
  const workstreams: WorkstreamRecord[] = [
    ws(1, "Sales – Voice"),
    ws(2, "Support – Voice", {
      variables: [{ id: guid("8300", 1), name: "SelectedMenuItem", dataType: 192350000 }, { id: guid("8300", 2), name: "CallReason", dataType: 192350000 }],
      routing: { configId: guid("8400", 2), configName: "Support routing", stepOrders: [1], queueRulesets: 1, queueRuleset: { id: guid("8500", 2), name: "Support routing", definition: SUPPORT_RULES } }
    }),
    ws(3, "Billing – Voice", { routing: { configId: guid("8400", 3), configName: "Billing classification", stepOrders: [1], queueRulesets: 0 } }),
    ws(4, "Claims – Voice", { variables: [{ id: guid("8300", 4), name: "SelectedMenuItem", dataType: 192350001 }] }),
    ws(5, "Chat – Web", { voice: false }),
    ws(6, "Legacy – Voice", { routingContractId: undefined }),
    ws(7, LOCKED)
  ];
  const q = (n: number, name: string, type = VOICE) => ({ id: guid("8000", n), name, type });
  return {
    catalog: {
      workstreams,
      queues: [q(1, "Sales – NL"), q(2, "Sales – Orders"), q(3, "Support – Returns"), q(4, "Support – Technical"), q(5, "Billing"), q(6, "Support – Chat", MESSAGING), q(7, "Callbacks"), q(8, "Callbacks"), q(9, "Escalations")],
      outputContractId: OUTPUT_CONTRACT
    },
    rulesets: new Map([[guid("8500", 2), SUPPORT_RULES]]),
    contracts: new Map(workstreams.filter((w) => w.routingContractId).map((w) => [w.routingContractId!, contract(w.variables.filter((v) => v.dataType === 192350000).map((v) => v.name))])),
    pendingVariables: new Map(),
    readOnce: new Set(),
    next: 100
  };
}

let state = initialState();

export function resetDemo(): void {
  state = initialState();
}

function guard(action: string, allowed: Record<string, string[]>, table: string, columns: Record<string, unknown>): void {
  if (!allowed[table]) throw new Error(`This tool doesn't ${action} ${table} records.`);
  const refused = Object.keys(columns).filter((k) => !allowed[table].includes(k));
  if (refused.length) throw new Error(`This tool doesn't write ${refused.join(", ")} on ${table}.`);
}

// "/msdyn_liveworkstreams(<id>)" -> "<id>"
const bound = (value: unknown) => String(value ?? "").replace(/^.*\(/, "").replace(/\)$/, "");
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));

export const demoSource: RouteSource = {
  mode: "demo",
  async loadCatalog() {
    return JSON.parse(JSON.stringify(state.catalog));
  },
  async loadRulesetDefinition(rulesetId) {
    if (!state.rulesets.has(rulesetId)) throw new Error("The ruleset no longer exists.");
    return state.rulesets.get(rulesetId);
  },
  async loadContractDefinition(contractId) {
    // The first read after a new variable doesn't show it yet; the next one does.
    const current = state.contracts.get(contractId);
    const pending = state.pendingVariables.get(contractId);
    if (pending === undefined) return current;
    if (!state.readOnce.has(contractId)) { state.readOnce.add(contractId); return current; }
    state.readOnce.delete(contractId);
    state.pendingVariables.delete(contractId);
    const names = [...(current ?? "").matchAll(/<variable name="([^"]+)"/g)].map((m) => m[1]);
    state.contracts.set(contractId, contract([...names, ...pending]));
    return state.contracts.get(contractId);
  },
  async create(table, payload) {
    guard("create", CREATE_COLUMNS, table, payload);
    await pause();
    const id = guid("8900", state.next++);
    const workstream = (wsId: string) => state.catalog.workstreams.find((w) => w.id === wsId)!;
    if (table === VARIABLE_TABLE) {
      const ws = workstream(bound(payload["msdyn_liveworkstreamid@odata.bind"]));
      ws.variables.push({ id, name: String(payload.msdyn_name), dataType: payload.msdyn_datatype as number });
      state.pendingVariables.set(ws.routingContractId!, [...(state.pendingVariables.get(ws.routingContractId!) ?? []), String(payload.msdyn_name)]);
    } else if (table === CONFIG_TABLE) {
      workstream(bound(payload["msdyn_liveworkstreamid@odata.bind"])).routing = { configId: id, configName: String(payload.msdyn_name), stepOrders: [], queueRulesets: 0 };
    } else if (table === RULESET_TABLE) {
      const owner = state.catalog.workstreams.find((w) => w.routingContractId === bound(payload["msdyn_inputcontractid@odata.bind"]));
      if (owner?.name === LOCKED) throw new Error("Simulated failure (sample environment): the ruleset was rejected.");
      state.rulesets.set(id, payload.msdyn_rulesetdefinition as string);
    } else if (table === STEP_TABLE) {
      const ws = state.catalog.workstreams.find((w) => w.routing?.configId === bound(payload["msdyn_routingconfigurationid@odata.bind"]))!;
      const rulesetId = bound(payload["msdyn_rulesetid@odata.bind"]);
      ws.routing!.stepOrders.push(payload.msdyn_steporder as number);
      if (payload.msdyn_type === QUEUE_IDENTIFICATION) {
        ws.routing!.queueRulesets++;
        ws.routing!.queueRuleset = { id: rulesetId, name: String(payload.msdyn_name), definition: state.rulesets.get(rulesetId) };
      }
    }
    return id;
  },
  async update(table, id, columns) {
    guard("update", UPDATE_COLUMNS, table, columns);
    await pause();
    if (!state.rulesets.has(id)) throw new Error("Record not found.");
    state.rulesets.set(id, columns.msdyn_rulesetdefinition as string);
    state.catalog.workstreams.forEach((w) => { if (w.routing?.queueRuleset?.id === id) w.routing.queueRuleset.definition = columns.msdyn_rulesetdefinition as string; });
  },
  recordUrl() {
    return undefined;
  },
  currentUser() {
    return "Sample user";
  }
};
