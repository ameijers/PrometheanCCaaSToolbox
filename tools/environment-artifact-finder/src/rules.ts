// Reuses Visual Routing Tester's live-verified decision-XML parser (a read-only import of a pure
// function, same as Agent Readiness Checker does) rather than re-deriving the rule format.
import { parseDecisionXml } from "../../visual-routing-tester/src/ruleXml";
import { SCAN_SETTINGS } from "./config";
import { REVIEW_STEP, ReferenceGraph, relatedRecords } from "./engine";
import { CHECKS, CheckId, Confidence, EdgeSpec, Finding, RecordRow, Snapshot, extractIds, lookupValueKey, normalizeId, recordKey } from "./model";
import { tableLabel } from "./referenceMap";

// Entity-specific rules layered on top of the generic engine. Every function here is pure: it reads
// the Snapshot and the ReferenceGraph and returns findings, never touching Dataverse.

export interface RuleResult {
  findings: Finding[];
  // Checks that were skipped because the data they need couldn't be read — shown on the Coverage tab.
  notes: string[];
}

// Routing-configuration-step type code confirmed live (see Visual Routing Tester's dataverse.ts).
const STEP_TYPE_QUEUE_IDENTIFICATION = 192350002;

// How rule conditions refer to context variables (confirmed live by Visual Routing Tester).
const WORKITEM_PREFIXES = ["liveworkitemcontext.", "msdyn_ocliveworkitem."];

const MANUAL_TRANSFER_CAVEAT = "Agents can transfer conversations to any queue by hand, and bots or flows can target a queue directly; this scan can't see either.";

class RuleContext {
  constructor(readonly snapshot: Snapshot, readonly graph: ReferenceGraph) {}

  ok(table: string): boolean {
    return this.snapshot.tables[table]?.status === "ok";
  }

  rows(table: string): RecordRow[] {
    return this.ok(table) ? this.snapshot.tables[table].rows : [];
  }

  row(table: string, id: string | undefined): RecordRow | undefined {
    if (!id) return undefined;
    const row = this.graph.byId.get(id);
    return row && row.table === table ? row : undefined;
  }

  lookup(row: RecordRow, attribute: string): string | undefined {
    return normalizeId(row.raw[lookupValueKey(attribute)]);
  }

  columnReadable(table: string, column: string): boolean {
    return this.ok(table) && !this.snapshot.tables[table].droppedColumns.includes(column);
  }

  // Available edges connecting any of `a` with any of `b`, in either direction.
  edgesBetween(a: string[], b: string[]): EdgeSpec[] {
    return this.snapshot.edges.filter((edge) => this.graph.edgeAvailability(edge).available && edge.kind === "lookup"
      && ((a.includes(edge.from) && edge.to.some((t) => b.includes(t))) || (b.includes(edge.from) && edge.to.some((t) => a.includes(t)))));
  }

  // Records of `tables` directly linked to `row` by any known relationship.
  linked(row: RecordRow, tables: string[]): RecordRow[] {
    return [...(this.graph.neighbors.get(recordKey(row.table, row.id)) ?? [])]
      .map((key) => this.graph.byKey.get(key)!)
      .filter((r) => r && tables.includes(r.table));
  }

  childrenOf(parent: RecordRow, childTable: string): RecordRow[] {
    return this.rows(childTable).filter((child) => (this.graph.outbound.get(recordKey(child.table, child.id)) ?? []).some((ref) => ref.edge.semantics === "parent" && ref.target?.id === parent.id));
  }

  finding(row: RecordRow, checkId: CheckId, confidence: Confidence, confidenceReason: string, explanation: string, evidence: string[], options: { nextStep?: string; marksDead: boolean; suffix?: string }): Finding {
    const def = CHECKS[checkId];
    return {
      id: `${checkId}:${row.table}:${row.id}${options.suffix ? ":" + options.suffix : ""}`,
      checkId,
      table: row.table,
      recordId: row.id,
      recordName: row.name,
      category: def.category,
      checkType: def.checkType,
      confidence,
      confidenceReason,
      title: def.title,
      explanation,
      evidence,
      nextStep: options.nextStep ?? REVIEW_STEP,
      related: relatedRecords(this.graph, row),
      highValueNote: this.snapshot.tables[row.table]?.spec.highValueNote,
      marksDead: options.marksDead
    };
  }
}

function describe(row: RecordRow): string {
  return `${tableLabel(row.table)} “${row.name}”${row.active ? "" : " (deactivated)"}`;
}

export function parseDisabledRuleIds(raw: unknown): Set<string> {
  if (typeof raw !== "string" || !raw.trim()) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
  } catch { /* not JSON — fall through to a plain list */ }
  return new Set(raw.split(/[,\s]+/).filter(Boolean));
}

// Queue ids a queue-routing ruleset can send work to (single target or weighted distribution).
// Falls back to every id mentioned in the XML when the format isn't recognized — for reachability,
// over-counting targets only ever means fewer findings, never a false one.
export function rulesetQueueTargets(ruleset: RecordRow): { ids: string[]; parsed: boolean } {
  const xml = ruleset.raw.msdyn_rulesetdefinition;
  const decision = typeof xml === "string" ? parseDecisionXml(xml) : null;
  if (!decision) return { ids: extractIds(xml), parsed: false };
  const ids: string[] = [];
  decision.rules.forEach((rule) => {
    const assign = rule.setAttributes.find((sa) => sa.lhs === "assign_to.queue");
    const assignId = normalizeId(assign?.rhs);
    if (assignId) ids.push(assignId);
    rule.distributionRecords.forEach((record) => {
      const queueId = normalizeId(record.find((sa) => sa.lhs === "queuedetails.queueid")?.rhs);
      if (queueId) ids.push(queueId);
    });
  });
  return { ids: [...new Set(ids)], parsed: true };
}

// A workstream's routing configurations that are actually in effect: the one(s) flagged
// msdyn_isactiveconfiguration, or — when none is flagged — every active one (conservative).
function activeConfigs(ctx: RuleContext, workstream: RecordRow): RecordRow[] {
  const configs = ctx.childrenOf(workstream, "msdyn_routingconfiguration").filter((c) => c.active);
  const flagged = configs.filter((c) => c.raw.msdyn_isactiveconfiguration === true);
  return flagged.length ? flagged : configs;
}

function stepsOf(ctx: RuleContext, config: RecordRow): RecordRow[] {
  return ctx.childrenOf(config, "msdyn_routingconfigurationstep").filter((s) => s.active);
}

function legacyRulesOf(ctx: RuleContext, workstream: RecordRow): RecordRow[] {
  return ctx.childrenOf(workstream, "msdyn_ocruleitem").filter((r) => r.active);
}

function defaultQueueId(ctx: RuleContext, workstream: RecordRow): string | undefined {
  return ctx.lookup(workstream, "msdyn_defaultqueue");
}

// --- Queue reachability ----------------------------------------------------------------------

export interface Reachability {
  reasons: Map<string, string[]>;
  // Tables the computation depends on that couldn't be read — lowers confidence of anything
  // concluded from the absence of a route.
  gaps: string[];
}

const REACHABILITY_TABLES = ["msdyn_liveworkstream", "msdyn_routingconfiguration", "msdyn_routingconfigurationstep", "msdyn_decisionruleset", "msdyn_overflowactionconfig", "msdyn_ocruleitem"];

export function computeQueueReachability(snapshot: Snapshot, graph: ReferenceGraph): Reachability {
  const ctx = new RuleContext(snapshot, graph);
  const queueIds = new Set(ctx.rows("queue").map((q) => q.id));
  const reasons = new Map<string, string[]>();
  const add = (queueId: string | undefined, reason: string) => {
    if (!queueId || !queueIds.has(queueId)) return;
    reasons.set(queueId, [...(reasons.get(queueId) ?? []), reason]);
  };

  ctx.rows("msdyn_liveworkstream").filter((ws) => ws.active).forEach((ws) => {
    add(defaultQueueId(ctx, ws), `Fallback queue of workstream “${ws.name}”`);
    activeConfigs(ctx, ws).forEach((config) => stepsOf(ctx, config).forEach((step) => {
      const ruleset = ctx.row("msdyn_decisionruleset", ctx.lookup(step, "msdyn_rulesetid"));
      if (!ruleset || !ruleset.active) return;
      extractIds(ruleset.raw.msdyn_rulesetdefinition).forEach((id) => add(id, `Routing rules of workstream “${ws.name}” (ruleset “${ruleset.name}”)`));
    }));
    legacyRulesOf(ctx, ws).forEach((rule) => {
      add(ctx.lookup(rule, "msdyn_queueassignid"), `Legacy routing rule “${rule.name}” of workstream “${ws.name}”`);
      add(ctx.lookup(rule, "msdyn_cdsqueueassignid"), `Legacy routing rule “${rule.name}” of workstream “${ws.name}”`);
    });
  });

  // Overflow can move work from a reachable queue to another one (Queue Transfer) — follow it to a
  // fixed point.
  const overflowIds = new Set(ctx.rows("msdyn_overflowactionconfig").map((o) => o.id));
  let changed = true;
  while (changed) {
    changed = false;
    ctx.rows("queue").filter((q) => q.active && reasons.has(q.id)).forEach((queue) => {
      ["msdyn_prequeueoverflowrulesetid", "msdyn_inqueueoverflowrulesetid"].forEach((attribute) => {
        const ruleset = ctx.row("msdyn_decisionruleset", ctx.lookup(queue, attribute));
        if (!ruleset || !ruleset.active) return;
        const mentioned = extractIds(ruleset.raw.msdyn_rulesetdefinition);
        const targets = [
          ...mentioned,
          ...mentioned.filter((id) => overflowIds.has(id)).flatMap((id) => extractIds(ctx.row("msdyn_overflowactionconfig", id)?.raw.msdyn_overflowactiondata))
        ];
        targets.forEach((target) => {
          if (!queueIds.has(target) || reasons.has(target)) return;
          add(target, `Overflow transfer from queue “${queue.name}”`);
          changed = true;
        });
      });
    });
  }

  const gaps = REACHABILITY_TABLES.filter((t) => !ctx.ok(t)).map((t) => `${tableLabel(t)} (${t}) couldn't be read, so routes through it weren't followed.`);
  if (ctx.ok("msdyn_liveworkstream") && !ctx.columnReadable("msdyn_liveworkstream", lookupValueKey("msdyn_defaultqueue"))) gaps.push("Workstream fallback queues couldn't be read.");
  return { reasons, gaps };
}

function queueRule(ctx: RuleContext, result: RuleResult): void {
  if (!ctx.ok("queue")) return;
  if (!ctx.ok("msdyn_liveworkstream")) {
    result.notes.push("Queue checks skipped: workstreams couldn't be read, so no route to any queue can be established.");
    return;
  }
  const reach = computeQueueReachability(ctx.snapshot, ctx.graph);
  const membershipKnown = ctx.ok("queuemembership");
  const membersByQueue = new Map<string, number>();
  ctx.rows("queuemembership").forEach((m) => {
    const queueId = normalizeId(m.raw.queueid);
    if (queueId) membersByQueue.set(queueId, (membersByQueue.get(queueId) ?? 0) + 1);
  });

  ctx.rows("queue").forEach((queue) => {
    if (queue.raw.msdyn_isomnichannelqueue === false) return;
    if (queue.active && reach.reasons.has(queue.id)) return;
    const members = membersByQueue.get(queue.id) ?? 0;
    const refs = ctx.graph.users.get(recordKey("queue", queue.id)) ?? [];
    const evidence = [
      queue.active ? "Queue is active." : "Queue is deactivated.",
      membershipKnown ? `${members} member(s).` : "Queue membership couldn't be read.",
      refs.length ? `Mentioned by: ${refs.map((r) => describe(r.user)).join("; ")} — none of which is part of an active workstream's routing.` : "No workstream, routing rule, fallback setting or overflow action points to it.",
      ...reach.gaps
    ];
    if (!members && !refs.length && membershipKnown) {
      const high = !reach.gaps.length;
      result.findings.push(ctx.finding(queue, "queue.noMembersNoRoutes", high ? "high" : "medium",
        high ? "Every routing source was read; nothing routes here and no agent is a member." : "Nothing routes here, but some routing data couldn't be read.",
        `No agent is a member of “${queue.name}” and nothing in the routing configuration points to it. ${MANUAL_TRANSFER_CAVEAT}`,
        evidence, { marksDead: true }));
    } else {
      result.findings.push(ctx.finding(queue, "queue.unreachable", "medium",
        "Inferred from routing logic: no active workstream's routing, fallback or overflow reaches it. It may still be a manual-transfer target.",
        `No active workstream can deliver work to “${queue.name}”${members ? `, yet ${members} agent(s) are members` : ""}. ${MANUAL_TRANSFER_CAVEAT}`,
        evidence, { marksDead: true }));
    }
  });
}

// --- Workstreams and voice channels ------------------------------------------------------------

function workstreamRule(ctx: RuleContext, result: RuleResult): void {
  if (!ctx.ok("msdyn_liveworkstream")) return;
  const routingReadable = ctx.ok("msdyn_routingconfiguration") && ctx.ok("msdyn_routingconfigurationstep");
  if (!routingReadable) result.notes.push("“No routing” workstream check skipped: routing configurations or their steps couldn't be read.");

  const voiceTables = SCAN_SETTINGS.voiceChannelTables.filter((t) => ctx.ok(t));
  const numberTables = SCAN_SETTINGS.phoneNumberTables.filter((t) => ctx.ok(t));
  const channelEdgesKnown = voiceTables.length > 0 && ctx.edgesBetween(voiceTables, ["msdyn_liveworkstream"]).length > 0;
  const numberEdgesKnown = numberTables.length > 0 && ctx.edgesBetween(numberTables, ["msdyn_liveworkstream", ...voiceTables]).length > 0;
  if (!channelEdgesKnown) result.notes.push("Voice channel checks skipped: no readable voice channel table with a known relationship to workstreams.");
  if (!numberEdgesKnown) result.notes.push("Phone number checks skipped: no readable phone/service number table with a known relationship to workstreams or voice channels.");

  ctx.rows("msdyn_liveworkstream").forEach((ws) => {
    if (!ws.active) {
      result.findings.push(ctx.finding(ws, "workstream.inactive", "medium",
        "The workstream's state is deactivated. Deactivated workstreams are sometimes kept deliberately, to reactivate later.",
        `“${ws.name}” is deactivated, so it receives no work, but it and everything that belongs to it (routing configuration, context variables, channel links) still exist.`,
        ["Workstream state: deactivated."], { marksDead: true }));
      return;
    }

    const configs = activeConfigs(ctx, ws);
    const steps = configs.flatMap((c) => stepsOf(ctx, c));
    const legacy = legacyRulesOf(ctx, ws);
    const fallback = defaultQueueId(ctx, ws);
    if (routingReadable && !steps.length && !legacy.length && !fallback) {
      result.findings.push(ctx.finding(ws, "workstream.noRouting", "medium",
        "Inferred from routing logic: with no routing step, legacy rule or fallback queue, incoming work has nowhere to go.",
        `“${ws.name}” is active but has no routing configuration steps, no legacy routing rules and no fallback queue.`,
        [`${configs.length} routing configuration(s) in effect, with 0 steps.`, "0 active legacy routing rules.", "No fallback queue."], { marksDead: false }));
    }

    const targetIds = new Set<string>();
    if (fallback) targetIds.add(fallback);
    steps.filter((s) => s.raw.msdyn_type === STEP_TYPE_QUEUE_IDENTIFICATION).forEach((step) => {
      const ruleset = ctx.row("msdyn_decisionruleset", ctx.lookup(step, "msdyn_rulesetid"));
      if (ruleset) rulesetQueueTargets(ruleset).ids.forEach((id) => targetIds.add(id));
    });
    legacy.forEach((rule) => ["msdyn_queueassignid", "msdyn_cdsqueueassignid"].forEach((a) => { const id = ctx.lookup(rule, a); if (id) targetIds.add(id); }));
    if (targetIds.size && ctx.ok("queue")) {
      const targets = [...targetIds].map((id) => ({ id, queue: ctx.row("queue", id) }));
      if (targets.every((t) => !t.queue || !t.queue.active)) {
        result.findings.push(ctx.finding(ws, "workstream.allTargetsUnreachable", "medium",
          "Inferred from routing logic: every queue it can route to is deactivated or missing.",
          `Every queue “${ws.name}” can route to is deactivated or no longer exists, so no work it receives can reach an agent.`,
          targets.map((t) => (t.queue ? `Target queue “${t.queue.name}” is deactivated.` : `Target queue ${t.id} was not found among the Omnichannel queues you can read.`)), { marksDead: false }));
      }
    }

    if (ws.raw.msdyn_enablevoicev2 !== true || !channelEdgesKnown) return;
    const direct = ctx.linked(ws, voiceTables);
    const channels = [...new Map([...direct, ...direct.flatMap((c) => ctx.linked(c, voiceTables))].map((c) => [c.id, c])).values()];
    if (!channels.length) {
      result.findings.push(ctx.finding(ws, "workstream.voiceNoChannel", "medium",
        "Inferred from relationships discovered in this environment: no voice channel record links to it.",
        `“${ws.name}” is a voice workstream, but no voice channel record (${voiceTables.join(", ")}) is linked to it, so no call can arrive through it.`,
        [`Voice workstream (msdyn_enablevoicev2 = true).`, `Checked relationships: ${ctx.edgesBetween(voiceTables, ["msdyn_liveworkstream"]).map((e) => `${e.from}.${e.field}`).join(", ")}.`, "No linked voice channel record found."], { marksDead: false }));
      return;
    }
    if (channels.every((c) => !c.active)) {
      result.findings.push(ctx.finding(ws, "workstream.voiceChannelDisabled", "medium",
        "Every linked voice channel record is deactivated.",
        `Every voice channel linked to “${ws.name}” is deactivated, so no call can arrive through it.`,
        channels.map((c) => `${describe(c)}.`), { marksDead: false }));
      return;
    }
    if (!numberEdgesKnown) return;
    const numbers = [ws, ...channels].flatMap((r) => ctx.linked(r, numberTables)).filter((n) => n.active);
    if (!numbers.length) {
      result.findings.push(ctx.finding(ws, "workstream.voiceNoNumber", "medium",
        "Inferred from relationships discovered in this environment: no active phone/service number links to it or its channel.",
        `“${ws.name}” is a voice workstream with an active voice channel, but no phone/service number is attached to either, so no call can arrive through it.`,
        [...channels.map((c) => `Linked ${describe(c)}.`), `No active ${numberTables.join("/")} record linked to the workstream or its channel.`], { marksDead: false }));
    }
  });
}

function voiceChannelRule(ctx: RuleContext, result: RuleResult): void {
  if (!ctx.ok("msdyn_ocvoice")) return;
  const numberTables = SCAN_SETTINGS.phoneNumberTables.filter((t) => ctx.ok(t));
  if (!numberTables.length || !ctx.edgesBetween(numberTables, ["msdyn_ocvoice"]).length) return;
  ctx.rows("msdyn_ocvoice").filter((v) => ctx.graph.alive(v)).forEach((voice) => {
    if (ctx.linked(voice, numberTables).some((n) => n.active)) return;
    result.findings.push(ctx.finding(voice, "voicechannel.noNumber", "medium",
      "Inferred from relationships discovered in this environment: no active phone/service number is attached.",
      `No phone/service number is attached to voice channel “${voice.name}”, so no call can arrive through it.`,
      [`Checked relationships: ${ctx.edgesBetween(numberTables, ["msdyn_ocvoice"]).map((e) => `${e.from}.${e.field}`).join(", ")}.`, "No active number record linked."], { marksDead: false }));
  });
}

function inactiveRecordRule(ctx: RuleContext, result: RuleResult): void {
  Object.values(ctx.snapshot.tables).filter((t) => t.status === "ok" && t.spec.flagInactive).forEach((table) => {
    table.rows.filter((r) => !r.active).forEach((row) => {
      result.findings.push(ctx.finding(row, "record.inactive", "medium",
        "The record's state is deactivated. Deactivated records are sometimes kept deliberately.",
        `${tableLabel(row.table)} “${row.name}” is deactivated but still exists.`,
        ["State: deactivated."], { marksDead: true }));
    });
  });
}

// --- Routing configuration, steps, rulesets -----------------------------------------------------

function routingConfigRule(ctx: RuleContext, result: RuleResult): void {
  if (!ctx.ok("msdyn_routingconfiguration")) return;
  const stepsReadable = ctx.ok("msdyn_routingconfigurationstep");
  const configs = ctx.rows("msdyn_routingconfiguration");
  configs.filter((c) => ctx.graph.alive(c)).forEach((config) => {
    if (stepsReadable && !ctx.childrenOf(config, "msdyn_routingconfigurationstep").length) {
      result.findings.push(ctx.finding(config, "routingconfig.noSteps", "medium",
        "Inferred from routing logic: a configuration with no steps routes nothing.",
        `Routing configuration “${config.name}” belongs to an active workstream but has no steps.`,
        ["0 routing configuration steps."], { marksDead: true }));
    }
    const workstreamId = ctx.lookup(config, "msdyn_liveworkstreamid");
    const sibling = configs.find((c) => c.id !== config.id && c.active && c.raw.msdyn_isactiveconfiguration === true && ctx.lookup(c, "msdyn_liveworkstreamid") === workstreamId);
    if (config.raw.msdyn_isactiveconfiguration === false && sibling) {
      result.findings.push(ctx.finding(config, "routingconfig.superseded", "low",
        "Old routing configuration versions are often kept on purpose, to compare or roll back.",
        `Routing configuration “${config.name}” is not the active version for its workstream; “${sibling.name}” is.`,
        [`This version: msdyn_isactiveconfiguration = false.`, `Active version: “${sibling.name}”.`], { marksDead: false }));
    }
  });
}

function routingStepRule(ctx: RuleContext, result: RuleResult): void {
  if (!ctx.ok("msdyn_routingconfigurationstep") || !ctx.ok("queue")) return;
  const queueTablePartial = ctx.snapshot.tables.queue.partial;
  ctx.rows("msdyn_routingconfigurationstep").forEach((step) => {
    const ruleset = ctx.row("msdyn_decisionruleset", ctx.lookup(step, "msdyn_rulesetid"));
    if (!ruleset) return;
    const { ids, parsed } = rulesetQueueTargets(ruleset);
    if (!parsed) return; // Only a recognized rule format can tell a queue target from any other id.
    const bad = ids.map((id) => ({ id, queue: ctx.row("queue", id) })).filter((t) => !t.queue || !t.queue.active);
    if (!bad.length) return;
    const anyInactive = bad.some((t) => t.queue);
    result.findings.push(ctx.finding(step, "routingstep.targetQueueBroken", anyInactive ? "high" : "medium",
      anyInactive ? "At least one target queue was read and is deactivated." : "The target id wasn't found, but a queue outside your read access (or not an Omnichannel queue) looks the same as a deleted one.",
      `Routing step “${step.name}” (ruleset “${ruleset.name}”) sends work to ${bad.length === 1 ? "a queue that is" : "queues that are"} deactivated or missing.`,
      bad.map((t) => (t.queue ? `Target queue “${t.queue.name}” is deactivated.` : `Target queue ${t.id} wasn't found${queueTablePartial ? " among the Omnichannel queues you can read" : ""}.`)),
      { marksDead: false, nextStep: "Point the rule at a working queue, or remove the rule if the queue was retired on purpose. " + REVIEW_STEP }));
  });
}

function rulesetRule(ctx: RuleContext, result: RuleResult): void {
  ctx.rows("msdyn_decisionruleset").forEach((ruleset) => {
    const xml = ruleset.raw.msdyn_rulesetdefinition;
    const decision = typeof xml === "string" ? parseDecisionXml(xml) : null;
    if (!decision) return; // Unknown or non-declarative format: can't judge it.
    const disabled = parseDisabledRuleIds(ruleset.raw.msdyn_disabledrules);
    const activeRules = decision.rules.filter((rule) => !disabled.has(rule.id));
    if (activeRules.length) return;
    result.findings.push(ctx.finding(ruleset, "ruleset.noRules", "medium",
      "Read directly from the ruleset definition: it can never match.",
      decision.rules.length ? `Every rule in ruleset “${ruleset.name}” is disabled, so it never produces an outcome.` : `Ruleset “${ruleset.name}” contains no rules, so it never produces an outcome.`,
      [`${decision.rules.length} rule(s) in the definition, ${decision.rules.length - activeRules.length} disabled.`], { marksDead: true }));
  });
}

function assignmentConfigRule(ctx: RuleContext, result: RuleResult): void {
  if (!ctx.ok("msdyn_assignmentconfiguration") || !ctx.ok("msdyn_assignmentconfigurationstep")) return;
  const parentEdges = ctx.snapshot.edges.filter((e) => e.from === "msdyn_assignmentconfigurationstep" && e.semantics === "parent" && e.to.includes("msdyn_assignmentconfiguration") && ctx.graph.edgeAvailability(e).available);
  if (!parentEdges.length) {
    result.notes.push("Assignment configuration “no steps” check skipped: no known relationship from steps to their configuration.");
    return;
  }
  ctx.rows("msdyn_assignmentconfiguration").filter((c) => ctx.graph.alive(c)).forEach((config) => {
    if (ctx.childrenOf(config, "msdyn_assignmentconfigurationstep").length) return;
    result.findings.push(ctx.finding(config, "assignmentconfig.noSteps", "low",
      "Built-in assignment methods may legitimately be represented without steps, so this is only a hint.",
      `Assignment configuration “${config.name}” has no steps.`,
      [`Checked relationship: ${parentEdges.map((e) => `${e.from}.${e.field}`).join(", ")}.`, "0 steps found."], { marksDead: false }));
  });
}

// --- Context variables -----------------------------------------------------------------------

function conditionVariableNames(ruleset: RecordRow): Set<string> {
  const xml = ruleset.raw.msdyn_rulesetdefinition;
  const decision = typeof xml === "string" ? parseDecisionXml(xml) : null;
  const names = new Set<string>();
  decision?.rules.forEach((rule) => rule.conditions.forEach((condition) => {
    const prefix = WORKITEM_PREFIXES.find((p) => condition.lhs.startsWith(p));
    if (prefix) names.add(condition.lhs.slice(prefix.length).toLowerCase());
  }));
  return names;
}

function contextVariableRule(ctx: RuleContext, result: RuleResult): void {
  if (!ctx.ok("msdyn_ocliveworkstreamcontextvariable")) return;
  if (!ctx.ok("msdyn_decisionruleset") || !ctx.ok("msdyn_routingconfiguration") || !ctx.ok("msdyn_routingconfigurationstep")) {
    result.notes.push("Context variable usage check skipped: rulesets, routing configurations or steps couldn't be read.");
    return;
  }
  const namesByRuleset = new Map(ctx.rows("msdyn_decisionruleset").map((rs) => [rs.id, conditionVariableNames(rs)]));
  const usedAnywhere = new Set([...namesByRuleset.values()].flatMap((s) => [...s]));
  const legacyText = ctx.rows("msdyn_ocruleitem").map((r) => [r.raw.msdyn_condition, r.raw.msdyn_expression, r.raw.msdyn_rulejson].filter((v) => typeof v === "string").join(" ").toLowerCase()).join(" ");

  ctx.rows("msdyn_ocliveworkstreamcontextvariable").filter((v) => ctx.graph.alive(v)).forEach((variable) => {
    if (variable.raw.msdyn_isdisplayable === true) return; // Shown to agents: that's a use.
    const name = String(variable.raw.msdyn_name ?? variable.name).toLowerCase();
    if (usedAnywhere.has(name) || legacyText.includes(name)) return;
    const workstream = ctx.row("msdyn_liveworkstream", ctx.lookup(variable, "msdyn_liveworkstreamid"));
    const attached = workstream ? ctx.childrenOf(workstream, "msdyn_routingconfiguration").flatMap((c) => ctx.childrenOf(c, "msdyn_routingconfigurationstep")).map((s) => ctx.row("msdyn_decisionruleset", ctx.lookup(s, "msdyn_rulesetid"))).filter((r): r is RecordRow => !!r) : [];
    result.findings.push(ctx.finding(variable, "contextvariable.unused", "low",
      "Low: bots, IVR flows and agent scripts can read or set context variables outside routing rules, and none of that is visible here.",
      `Context variable “${variable.name}”${workstream ? ` on workstream “${workstream.name}”` : ""} isn't shown to agents, and no routing rule condition reads it.`,
      [`Checked ${attached.length} ruleset(s) attached to its workstream, plus every other ruleset (${namesByRuleset.size}) and legacy rule, for a condition on liveworkitemcontext.${variable.raw.msdyn_name ?? variable.name}.`, "Not displayable to agents (msdyn_isdisplayable = false).", "No condition found."],
      { marksDead: true, nextStep: "Check whether a bot, IVR flow or agent script sets or reads it (the Context Variable Monitor shows what real calls capture). " + REVIEW_STEP }));
  });
}

// --- Omnichannel configuration (near-singleton) -------------------------------------------------

function omnichannelConfigRule(ctx: RuleContext, result: RuleResult): void {
  const rows = ctx.rows("msdyn_omnichannelconfiguration");
  if (rows.length < 2) return;
  const time = (r: RecordRow) => Date.parse(String(r.raw.modifiedon ?? "")) || 0;
  const activeRows = rows.filter((r) => r.active).sort((a, b) => time(b) - time(a));
  const current = activeRows[0];
  rows.filter((r) => r !== current).forEach((row) => {
    result.findings.push(ctx.finding(row, "omnichannelconfig.duplicate", row.active ? "low" : "medium",
      row.active ? "Several active configuration records exist; which one the product reads can't be confirmed from data alone." : "The record is deactivated and another configuration record exists.",
      `${rows.length} Omnichannel configuration records exist. “${row.name}” is ${row.active ? "active but older than" : "deactivated; the one in use is presumably"} “${current?.name ?? "(none active)"}”.`,
      [`${rows.length} records in msdyn_omnichannelconfiguration, ${activeRows.length} active.`, `This record: ${row.active ? "active" : "deactivated"}, last modified ${String(row.raw.modifiedon ?? "unknown")}.`],
      { marksDead: true }));
  });
}

export function runRules(snapshot: Snapshot, graph: ReferenceGraph): RuleResult {
  const ctx = new RuleContext(snapshot, graph);
  const result: RuleResult = { findings: [], notes: [] };
  queueRule(ctx, result);
  workstreamRule(ctx, result);
  voiceChannelRule(ctx, result);
  inactiveRecordRule(ctx, result);
  routingConfigRule(ctx, result);
  routingStepRule(ctx, result);
  rulesetRule(ctx, result);
  assignmentConfigRule(ctx, result);
  contextVariableRule(ctx, result);
  omnichannelConfigRule(ctx, result);
  return result;
}
