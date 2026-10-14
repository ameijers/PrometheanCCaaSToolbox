// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { VoicemailSource } from "./dataSource";
import { Catalog, QueueRecord } from "./model";
import { CREATE_COLUMNS, INQUEUE_NAV, PREQUEUE_NAV, QUEUE_TABLE, RULESET_TABLE, UPDATE_COLUMNS, WORKSTREAM_TABLE } from "./schema";

// An in-memory sample environment: a voice queue without overflow, one with an overflow rule that
// calls back (to show Overwrite and Skip) and a voicemail rule, one without operating hours, an
// existing record queue to reuse, a messaging queue, and a queue whose overflow rules are rejected — so
// the demo shows every path. Writes go through the same table and column limits as the live source.

const guid = (group: string, n: number) => `00000000-0000-4000-${group}-${String(n).padStart(12, "0")}`;
const VOICE = 192350002, MESSAGING = 192350000, RECORD = 192350001;
const VOICEMAIL_ACTION = guid("9100", 1), CALLBACK_ACTION = guid("9100", 2);
const HUB = guid("9200", 1), HUB_RULESET = guid("9300", 1);

const SUPPORT_PREQUEUE = `<decision hit-policy="all" version="1">
  <rules>
    <rule id="${guid("9400", 1)}" name="Rule1">
      <action>
        <setattribute>
          <lhs type="attribute">overflow.estimatedwaittimeoverflow</lhs>
          <rhs type="staticvalue">true</rhs>
        </setattribute>
        <setattribute>
          <lhs type="attribute">overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs>
          <rhs type="staticvalue">{${CALLBACK_ACTION}}</rhs>
        </setattribute>
      </action>
      <logical operator="AND">
        <condition operator="not-null">
          <lhs type="attribute">queue_prequeue.estimatedwaittimeinminutes</lhs>
        </condition>
        <condition operator=">=">
          <lhs type="attribute">queue_prequeue.estimatedwaittimeinminutes</lhs>
          <rhs type="staticvalue">10</rhs>
        </condition>
      </logical>
    </rule>
  </rules>
</decision>`;

const SUPPORT_INQUEUE = `<decision hit-policy="all" version="1">
  <rules>
    <rule id="${guid("9400", 2)}" name="Rule1">
      <action>
        <setattribute>
          <lhs type="attribute">overflow.lapsedwaittimeoverflow</lhs>
          <rhs type="staticvalue">true</rhs>
        </setattribute>
        <setattribute>
          <lhs type="attribute">overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs>
          <rhs type="staticvalue">{${VOICEMAIL_ACTION}}</rhs>
        </setattribute>
      </action>
      <condition operator="not-null">
        <lhs type="attribute">queue_inqueue.lapsedwaittime</lhs>
      </condition>
      <condition operator=">=">
        <lhs type="attribute">queue_inqueue.lapsedwaittime</lhs>
        <rhs type="staticvalue" unit="seconds">60</rhs>
      </condition>
    </rule>
  </rules>
</decision>`;

// The queue whose new overflow rules are rejected, to show how a failure is reported.
const LOCKED = "Escalations – Voice";

interface DemoState { catalog: Catalog; definitions: Map<string, string | undefined>; next: number; }

function initialState(): DemoState {
  const queue = (n: number, name: string, type: number, extra: Partial<QueueRecord> = {}): QueueRecord =>
    ({ id: guid("8000", n), name, type, hasOperatingHours: true, memberIds: [], ...extra });
  return {
    catalog: {
      queues: [
        queue(1, "Sales – Voice", VOICE),
        queue(2, "Support – Voice", VOICE, { prequeue: { id: guid("9500", 1), name: "queue_prequeue_Support – Voice", definition: SUPPORT_PREQUEUE }, inqueue: { id: guid("9500", 2), name: "queue_inqueue_Support – Voice", definition: SUPPORT_INQUEUE } }),
        queue(3, "Billing – Voice", VOICE, { hasOperatingHours: false }),
        queue(4, "Billing voicemail", RECORD, { memberIds: [guid("8100", 4)] }),
        queue(5, "Support – Chat", MESSAGING),
        queue(6, LOCKED, VOICE),
        queue(7, "Default group voicemail queue", RECORD)
      ],
      workstreams: [
        { id: guid("8200", 1), name: "Default Group Voicemail Workstream", record: true, hubId: HUB, defaultQueueId: guid("8000", 7) },
        { id: guid("8200", 2), name: "Sales – Voice", record: false }
      ],
      users: [
        { id: guid("8100", 1), fullName: "Anna de Vries", signIn: "anna@contoso.com", email: "anna@contoso.com", disabled: false },
        { id: guid("8100", 2), fullName: "Bram Jansen", signIn: "bram@contoso.com", email: "bram@contoso.com", disabled: false },
        { id: guid("8100", 3), fullName: "Chris Peters", signIn: "chris@contoso.com", email: "chris@contoso.com", disabled: false },
        { id: guid("8100", 4), fullName: "Dana Smit", signIn: "dana@contoso.com", email: "dana.smit@contoso.com", disabled: false }
      ],
      hub: { id: HUB, rulesetId: HUB_RULESET, definition: undefined },
      voicemailActionId: VOICEMAIL_ACTION,
      contracts: { prequeueInput: guid("9600", 1), prequeueOutput: guid("9600", 2), inqueueInput: guid("9600", 3), inqueueOutput: guid("9600", 4) }
    },
    definitions: new Map<string, string | undefined>([[guid("9500", 1), SUPPORT_PREQUEUE], [guid("9500", 2), SUPPORT_INQUEUE], [HUB_RULESET, undefined]]),
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

const bound = (value: unknown) => String(value ?? "").replace(/^.*\(/, "").replace(/\)$/, "");
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

// The catalog as the live source would read it: ruleset definitions as they are now.
function snapshot(): Catalog {
  const c: Catalog = JSON.parse(JSON.stringify(state.catalog));
  c.queues.forEach((q) => { if (q.prequeue) q.prequeue.definition = state.definitions.get(q.prequeue.id); if (q.inqueue) q.inqueue.definition = state.definitions.get(q.inqueue.id); });
  if (c.hub) c.hub.definition = state.definitions.get(c.hub.rulesetId!);
  return c;
}

export const demoSource: VoicemailSource = {
  mode: "demo",
  async loadCatalog() {
    return snapshot();
  },
  async loadDefinition(rulesetId) {
    if (!state.definitions.has(rulesetId)) throw new Error("The ruleset no longer exists.");
    return state.definitions.get(rulesetId);
  },
  async create(table, payload) {
    guard("create", CREATE_COLUMNS, table, payload);
    await pause();
    const id = guid("8900", state.next++);
    if (table === QUEUE_TABLE) state.catalog.queues.push({ id, name: String(payload.name), type: payload.msdyn_queuetype as number, hasOperatingHours: false, memberIds: [] });
    else if (table === WORKSTREAM_TABLE) state.catalog.workstreams.push({ id, name: String(payload.msdyn_name), record: true, hubId: bound(payload["msdyn_masterentityroutingconfigurationId@odata.bind"]), defaultQueueId: bound(payload["msdyn_defaultqueue@odata.bind"]) });
    else if (table === RULESET_TABLE) {
      if (String(payload.msdyn_name).endsWith(LOCKED)) throw new Error("Simulated failure (sample environment): the overflow rules were rejected.");
      state.definitions.set(id, payload.msdyn_rulesetdefinition as string);
    }
    return id;
  },
  async update(table, id, columns) {
    guard("update", UPDATE_COLUMNS, table, columns);
    await pause();
    if (table === RULESET_TABLE) {
      if (!state.definitions.has(id)) throw new Error("Record not found.");
      state.definitions.set(id, columns.msdyn_rulesetdefinition as string);
      return;
    }
    const queue = state.catalog.queues.find((q) => q.id === id);
    if (!queue) throw new Error("Record not found.");
    const pre = columns[`${PREQUEUE_NAV}@odata.bind`], inq = columns[`${INQUEUE_NAV}@odata.bind`];
    if (pre) queue.prequeue = { id: bound(pre), name: `queue_prequeue_${queue.name}` };
    if (inq) queue.inqueue = { id: bound(inq), name: `queue_inqueue_${queue.name}` };
  },
  async addMember(queueId, userId) {
    await pause();
    const queue = state.catalog.queues.find((q) => q.id === queueId);
    if (!queue) throw new Error("Record not found.");
    if (!queue.memberIds.includes(userId)) queue.memberIds.push(userId);
  },
  recordUrl() {
    return undefined;
  },
  currentUser() {
    return "Sample user";
  }
};
