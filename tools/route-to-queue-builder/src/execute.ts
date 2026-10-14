// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { RouteSource } from "./dataSource";
import { ResolvedPlan, StepResult, WorkstreamOutcome, WorkstreamPlan, WorkstreamResult } from "./model";
import { RuleToWrite, appendRules, ruleIds } from "./rules";
import {
  CONFIG_TABLE, DECISION_LIST, DECLARATIVE_RULESET, ENTITY_SETS, QUEUE_IDENTIFICATION, RULESET_TABLE, STEP_TABLE, TEXT_VARIABLE, VARIABLE_TABLE, WORKSTREAM_TABLE,
  CONTRACT_TABLE
} from "./schema";

// Works through the plan one workstream at a time:
//   1. the context variable, if the workstream doesn't have it, and then a wait until the platform has
//      added it to the workstream's routing contract (it does so in the background, ~20 s in Step 0);
//   2. the rules: added to the existing route-to-queue ruleset, or in a new ruleset (with a new
//      routing configuration if the workstream has none), in the order of the CSV;
//   3. a read-back of the ruleset to confirm every new rule is there.
// A workstream that fails doesn't stop the others. Nothing is ever deleted.

export interface ExecuteProgress {
  done: number;
  total: number;
  message: string;
}

export interface ExecuteOptions {
  newId: () => string;
  // How long to wait for the platform to add a new context variable to the routing contract.
  contractTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

const bind = (table: string, id: string) => `/${ENTITY_SETS[table]}(${id})`;

export function hasVariable(contract: string | undefined, variable: string): boolean {
  return !!contract && contract.includes(`<variable name="${variable}"`);
}

async function runWorkstream(plan: WorkstreamPlan, resolved: ResolvedPlan, source: RouteSource, options: Required<ExecuteOptions>): Promise<WorkstreamResult> {
  const ws = plan.workstream!;
  const variable = resolved.settings.variable.trim();
  const steps: StepResult[] = [];
  const notes: string[] = [];
  const now = () => new Date().toISOString();
  const uniqueName = () => `new_${options.newId().replace(/-/g, "")}`;
  const result = (outcome: WorkstreamOutcome, rulesAdded = 0): WorkstreamResult => ({ name: plan.name, workstreamId: ws.id, outcome, steps, notes, rulesAdded });
  const fail = (label: string, name: string, error: unknown) => steps.push({ label, name, status: "failed", error: errorMessage(error), at: now() });

  // 1. The context variable.
  if (plan.createVariable) {
    try {
      const id = await source.create(VARIABLE_TABLE, {
        msdyn_name: variable, msdyn_displayname: variable, msdyn_datatype: TEXT_VARIABLE, msdyn_isdisplayable: true, msdyn_islist: false,
        msdyn_ismodifiable: true, msdyn_issystemdefined: false, "msdyn_liveworkstreamid@odata.bind": bind(WORKSTREAM_TABLE, ws.id)
      });
      steps.push({ label: "Context variable", name: variable, status: "created", id, at: now() });
    } catch (error) {
      fail("Context variable", variable, error);
      steps.push({ label: "Rules", name: `${plan.rules.length} rule${plan.rules.length === 1 ? "" : "s"}`, status: "skipped" });
      return result("failed");
    }
    let ready = false;
    for (let waited = 0; ; waited += options.pollMs) {
      ready = hasVariable(await source.loadContractDefinition(ws.routingContractId!).catch(() => undefined), variable);
      if (ready || waited >= options.contractTimeoutMs) break;
      await options.sleep(options.pollMs);
    }
    if (!ready) {
      steps.push({ label: "Routing contract", name: `${variable} added by the platform`, status: "failed", error: `The platform hadn't added the variable to the workstream's routing contract after ${Math.round(options.contractTimeoutMs / 1000)} seconds.`, at: now() });
      steps.push({ label: "Rules", name: `${plan.rules.length} rule${plan.rules.length === 1 ? "" : "s"}`, status: "skipped" });
      notes.push(`The context variable "${variable}" was created, but no rules were added. Upload the file again in a minute: the variable is then used as it is.`);
      return result("partial");
    }
  }

  // 2. The rules.
  const rules: RuleToWrite[] = plan.rules.map((r) => ({ id: options.newId(), name: r.ruleName, variable, value: r.menuValue, queueId: r.queueId! }));
  const rulesLabel = `${rules.length} rule${rules.length === 1 ? "" : "s"}`;
  let rulesetId: string | undefined;
  try {
    if (plan.mode === "append") {
      rulesetId = ws.routing!.queueRuleset!.id;
      // Read the rules again right before writing, so rules added since the upload aren't lost.
      const current = await source.loadRulesetDefinition(rulesetId);
      await source.update(RULESET_TABLE, rulesetId, { msdyn_rulesetdefinition: appendRules(current, rules) });
      steps.push({ label: "Rules", name: `${rulesLabel} added to "${plan.rulesetName}"`, status: "updated", id: rulesetId, at: now() });
    } else {
      let configId = ws.routing?.configId;
      if (plan.mode === "newConfig") {
        configId = await source.create(CONFIG_TABLE, { msdyn_name: plan.rulesetName, msdyn_uniquename: uniqueName(), msdyn_isactiveconfiguration: true, "msdyn_liveworkstreamid@odata.bind": bind(WORKSTREAM_TABLE, ws.id) });
        steps.push({ label: "Routing configuration", name: plan.rulesetName, status: "created", id: configId, at: now() });
      }
      rulesetId = await source.create(RULESET_TABLE, {
        msdyn_name: plan.rulesetName, msdyn_uniquename: uniqueName(), msdyn_rulesetdefinition: appendRules(undefined, rules),
        msdyn_rulesettype: DECLARATIVE_RULESET, msdyn_authoringmode: DECISION_LIST, msdyn_isinputcollection: false, msdyn_persistoutputdata: false, msdyn_refreshinputdata: false,
        "msdyn_inputcontractid@odata.bind": bind(CONTRACT_TABLE, ws.routingContractId!), "msdyn_outputcontractid@odata.bind": bind(CONTRACT_TABLE, resolved.outputContractId!)
      });
      steps.push({ label: "Ruleset", name: `"${plan.rulesetName}" with ${rulesLabel}`, status: "created", id: rulesetId, at: now() });
      const order = Math.max(0, ...(ws.routing?.stepOrders ?? [])) + 1;
      const stepId = await source.create(STEP_TABLE, {
        msdyn_name: plan.rulesetName, msdyn_uniquename: uniqueName(), msdyn_type: QUEUE_IDENTIFICATION, msdyn_steporder: order,
        "msdyn_routingconfigurationid@odata.bind": bind(CONFIG_TABLE, configId!), "msdyn_rulesetid@odata.bind": bind(RULESET_TABLE, rulesetId)
      });
      steps.push({ label: "Route-to-queue step", name: plan.rulesetName, status: "created", id: stepId, at: now() });
    }
  } catch (error) {
    fail(plan.mode === "append" ? "Rules" : "Route to queue", plan.mode === "append" ? `${rulesLabel} for "${plan.rulesetName}"` : plan.rulesetName, error);
    if (steps.some((s) => s.status === "created")) notes.push("Stopped part-way. What was created is listed above; check the workstream's routing in the admin center before uploading again.");
    return result(steps.some((s) => s.status === "created") ? "partial" : "failed");
  }

  // 3. Read back.
  const after = await source.loadRulesetDefinition(rulesetId).catch(() => undefined);
  const ids = ruleIds(after);
  const missing = rules.filter((r) => !ids.includes(r.id));
  if (after === undefined) notes.push("Couldn't read the ruleset back to confirm the rules. Check it in the admin center.");
  else if (missing.length) {
    notes.push(`Saved, but ${missing.length} rule${missing.length === 1 ? " doesn't" : "s don't"} read back: ${missing.map((r) => `"${r.name}"`).join(", ")}. Check the ruleset in the admin center.`);
    return result("partial", rules.length - missing.length);
  }
  return result("done", rules.length);
}

export async function executePlan(plan: ResolvedPlan, source: RouteSource, options: ExecuteOptions, onProgress?: (p: ExecuteProgress) => void): Promise<WorkstreamResult[]> {
  const settings: Required<ExecuteOptions> = {
    contractTimeoutMs: 120000, pollMs: 3000, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), ...options
  } as Required<ExecuteOptions>;
  const todo = plan.workstreams.filter((w) => !w.blocked && w.workstream);
  const results: WorkstreamResult[] = [];
  for (let i = 0; i < todo.length; i++) {
    const w = todo[i];
    onProgress?.({ done: i, total: todo.length, message: w.createVariable ? `${w.name}: creating the context variable and waiting for the platform` : `${w.name}: adding ${w.rules.length} rule${w.rules.length === 1 ? "" : "s"}` });
    results.push(await runWorkstream(w, plan, source, settings));
  }
  onProgress?.({ done: todo.length, total: todo.length, message: "Done" });
  return results;
}
