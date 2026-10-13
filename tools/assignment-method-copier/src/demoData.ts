// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { CopierSource } from "./dataSource";
import { Method, MethodStep, QueueRow, Ruleset } from "./model";
import { CREATE_COLUMNS, METHOD_TABLE, QUEUE_TABLE, RULESET_TABLE, UPDATE_COLUMNS } from "./schema";

// An in-memory sample environment: two queues that hold a custom method (one with a prioritization and
// an assignment ruleset, one with assignment only), voice queues on built-in methods, a messaging
// queue (blocked: other type), a queue without an assignment contract (blocked) and one whose rulesets
// can't be created — so the demo shows the preview, blocked queues, a part-way failure and the switch
// back. Writes go through the same table and column limits as the live source.

const VOICE = 192350002, MESSAGING = 192350000;
const LEAST_ACTIVE = 192350003, HIGHEST_CAPACITY = 192350000, ROUND_ROBIN = 192350001, CUSTOM = 192350002;
const PRIORITIZATION = 192350000, ASSIGNMENT = 192350002;
const ASSIGNMENT_OUTPUT_CONTRACT = "00000000-0000-4000-9000-000000000001";

const guid = (group: string, n: number) => `00000000-0000-4000-${group}-${String(n).padStart(12, "0")}`;
const queueId = (n: number) => guid("8000", n);
const contractId = (n: number) => guid("8100", n);

interface DemoQueue { id: string; name: string; type: number; strategy: number; inputContractId?: string; }
interface DemoMethod { id: string; name: string; description?: string; active: boolean; queueId: string; }
interface DemoStep extends Omit<MethodStep, "ruleset"> { methodId: string; rulesetId: string; }

const PRIORITIZATION_RULES = `<decision hit-policy="first" version="1">
  <rules>
    <rule id="52fe09f7-30e6-4266-956c-8b947cc768b6" name="Identified customers first">
      <logical operator="AND">
        <condition operator="==">
          <lhs type="attribute">liveworkitemcontext.574cf69d-e275-39b7-d902-e0d633b63a63.IsIdentified</lhs>
          <rhs type="staticvalue">1</rhs>
        </condition>
      </logical>
      <action>
        <orderby type="attribute" descending="false">msdyn_ocliveworkitem.createdon</orderby>
      </action>
    </rule>
  </rules>
</decision>`;

const ASSIGNMENT_RULES = `<decision hit-policy="first" version="1">
  <rules>
    <rule id="85e6eff4-92a2-4215-ad53-ee2a6d78c430" name="Exact skill match">
      <logical operator="AND">
        <condition operator="exact_match">
          <lhs type="attribute">agent.bookableresourcecharacteristic</lhs>
          <rhs type="attribute">msdyn_ocliveworkitemcharacteristic</rhs>
        </condition>
        <condition operator="&gt;">
          <lhs type="attribute">agent.availableCapacity</lhs>
          <rhs type="attribute">msdyn_ocliveworkitem.msdyn_liveworkstreamid_msdyn_ocliveworkitem.msdyn_capacityrequired</rhs>
        </condition>
      </logical>
      <action>
        <orderby type="attribute" descending="false">agent.lastSessionAssignedOn</orderby>
      </action>
    </rule>
    <rule id="26873219-2093-41dc-bbe0-7ab65436df92" name="Closest skill match">
      <logical operator="AND">
        <condition operator="contains">
          <lhs type="attribute">agent.languages</lhs>
          <rhs type="attribute">msdyn_ocliveworkitem.msdyn_languageid_msdyn_ocliveworkitem.msdyn_languageid</rhs>
        </condition>
      </logical>
      <action>
        <orderby type="skill_match_count" descending="true">
          <parameters>
            <parameter type="attribute">agent.bookableresourcecharacteristic</parameter>
            <parameter type="attribute">msdyn_ocliveworkitemcharacteristic</parameter>
          </parameters>
        </orderby>
      </action>
    </rule>
  </rules>
</decision>`;

const SIMPLE_RULES = `<decision hit-policy="first" version="1">
  <rules>
    <rule id="a8d80cd2-9de3-4f23-a02a-8df2decec10b" name="Longest idle with capacity">
      <logical operator="AND">
        <condition operator="&gt;">
          <lhs type="attribute">agent.availableCapacity</lhs>
          <rhs type="staticvalue">0</rhs>
        </condition>
      </logical>
      <action>
        <orderby type="attribute" descending="false">agent.lastSessionReleasedOn</orderby>
      </action>
    </rule>
  </rules>
</decision>`;

// The queue whose rulesets can't be created, to show how a part-way failure is reported.
const LOCKED = "Legacy callbacks";

interface DemoState { queues: DemoQueue[]; methods: DemoMethod[]; steps: DemoStep[]; rulesets: Ruleset[]; next: number; }

function initialState(): DemoState {
  const queue = (n: number, name: string, type: number, strategy: number, contract = true): DemoQueue => ({ id: queueId(n), name, type, strategy, inputContractId: contract ? contractId(n) : undefined });
  const ruleset = (n: number, name: string, definition: string, input: string, output: string): Ruleset => ({
    id: guid("8300", n), name, definition, rulesetType: 192350000, authoringMode: 192350000, inputContractId: input, outputContractId: output,
    isInputCollection: false, persistOutputData: false, refreshInputData: false
  });
  return {
    queues: [
      queue(1, "Sales – NL", VOICE, CUSTOM), queue(2, "Sales – EN", VOICE, LEAST_ACTIVE), queue(3, "Sales – DE", VOICE, LEAST_ACTIVE),
      queue(4, "Sales – Priority customers", VOICE, HIGHEST_CAPACITY), queue(5, "Support – Voice", VOICE, CUSTOM), queue(6, "Support – Overflow", VOICE, ROUND_ROBIN),
      queue(7, "Billing", VOICE, LEAST_ACTIVE), queue(8, "Claims", VOICE, LEAST_ACTIVE), queue(9, "Claims – after hours", VOICE, LEAST_ACTIVE),
      queue(10, LOCKED, VOICE, LEAST_ACTIVE), queue(11, "Imported voice queue", VOICE, LEAST_ACTIVE, false), queue(12, "Support – Chat", MESSAGING, HIGHEST_CAPACITY)
    ],
    methods: [
      { id: guid("8200", 1), name: "Skills first", description: "Identified customers first, then the best skill match.", active: true, queueId: queueId(1) },
      { id: guid("8200", 2), name: "Longest idle with capacity", active: true, queueId: queueId(5) }
    ],
    steps: [
      { id: guid("8400", 1), name: "Prioritization", type: PRIORITIZATION, order: 1, isDefault: true, methodId: guid("8200", 1), rulesetId: guid("8300", 1) },
      { id: guid("8400", 2), name: "Assignment", type: ASSIGNMENT, order: 2, isDefault: true, methodId: guid("8200", 1), rulesetId: guid("8300", 2) },
      { id: guid("8400", 3), name: "Assignment", type: ASSIGNMENT, order: 1, isDefault: true, methodId: guid("8200", 2), rulesetId: guid("8300", 3) }
    ],
    rulesets: [
      ruleset(1, "Prioritization", PRIORITIZATION_RULES, contractId(1), contractId(1)),
      ruleset(2, "Assignment", ASSIGNMENT_RULES, contractId(1), ASSIGNMENT_OUTPUT_CONTRACT),
      ruleset(3, "Assignment", SIMPLE_RULES, contractId(5), ASSIGNMENT_OUTPUT_CONTRACT)
    ],
    next: 100
  };
}

let state = initialState();

export function resetDemo(): void {
  state = initialState();
}

// "/queues(<id>)" -> "<id>"
const bound = (value: unknown) => String(value ?? "").replace(/^.*\(/, "").replace(/\)$/, "");

function guard(action: string, allowed: Record<string, string[]>, table: string, columns: Record<string, unknown>): void {
  if (!allowed[table]) throw new Error(`This tool doesn't ${action} ${table} records.`);
  const refused = Object.keys(columns).filter((k) => !allowed[table].includes(k));
  if (refused.length) throw new Error(`This tool doesn't write ${refused.join(", ")} on ${table}.`);
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 30));

export const demoSource: CopierSource = {
  mode: "demo",
  async loadQueues(): Promise<QueueRow[]> {
    return state.queues.map((q) => ({ ...q, methods: state.methods.filter((m) => m.queueId === q.id).map((m) => ({ id: m.id, name: m.name, active: m.active })) }));
  },
  async loadMethod(methodId): Promise<Method> {
    const method = state.methods.find((m) => m.id === methodId);
    if (!method) throw new Error("The assignment method no longer exists.");
    const steps = state.steps.filter((s) => s.methodId === methodId).sort((a, b) => a.order - b.order)
      .map(({ methodId: _method, rulesetId, ...step }) => ({ ...step, ruleset: state.rulesets.find((r) => r.id === rulesetId) }));
    return JSON.parse(JSON.stringify({ ...method, steps }));
  },
  async create(table, payload) {
    guard("create", CREATE_COLUMNS, table, payload);
    await pause();
    const id = guid("8900", state.next++);
    if (table === METHOD_TABLE) {
      state.methods.push({ id, name: String(payload.msdyn_name), description: payload.msdyn_description as string | undefined, active: payload.msdyn_isactiveconfiguration === true, queueId: bound(payload["msdyn_queueid@odata.bind"]) });
    } else if (table === RULESET_TABLE) {
      const input = bound(payload["msdyn_inputcontractid@odata.bind"]);
      if (state.queues.find((q) => q.inputContractId === input)?.name === LOCKED) throw new Error("Simulated failure (sample environment): the ruleset was rejected.");
      state.rulesets.push({
        id, name: String(payload.msdyn_name), description: payload.msdyn_description as string | undefined, definition: String(payload.msdyn_rulesetdefinition),
        rulesetType: payload.msdyn_rulesettype as number, authoringMode: payload.msdyn_authoringmode as number | undefined, inputContractId: input,
        outputContractId: bound(payload["msdyn_outputcontractid@odata.bind"]) || undefined, isInputCollection: payload.msdyn_isinputcollection === true,
        persistOutputData: payload.msdyn_persistoutputdata === true, refreshInputData: payload.msdyn_refreshinputdata === true, disabledRules: payload.msdyn_disabledrules as string | undefined
      });
    } else {
      state.steps.push({
        id, name: String(payload.msdyn_name), type: payload.msdyn_type as number, order: payload.msdyn_steporder as number, isDefault: payload.msdyn_isdefaultruleset === true,
        methodId: bound(payload["msdyn_assignmentconfigurationid@odata.bind"]), rulesetId: bound(payload["msdyn_rulesetid@odata.bind"])
      });
    }
    return id;
  },
  async update(table, id, columns) {
    guard("update", UPDATE_COLUMNS, table, columns);
    await pause();
    if (table === QUEUE_TABLE) {
      const queue = state.queues.find((q) => q.id === id);
      if (!queue) throw new Error("Record not found.");
      queue.strategy = columns.msdyn_assignmentstrategy as number;
    } else if (table === METHOD_TABLE) {
      const method = state.methods.find((m) => m.id === id);
      if (!method) throw new Error("Record not found.");
      method.active = columns.msdyn_isactiveconfiguration === true;
    }
  },
  recordUrl() {
    return undefined;
  },
  currentUser() {
    return "Sample user";
  }
};

