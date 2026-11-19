// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { environmentLabel, isDataverseAvailable } from "../../shared/src/xrm";
import { downloadCsv } from "../../voice-workstream-builder/src/csv";
import { RunInfo, logFileName } from "../../voice-workstream-builder/src/runLog";
import { ApplyProgress, applyCopies, undoChanges } from "./apply";
import { CopierSource } from "./dataSource";
import { dataverseSource } from "./dataverse";
import { demoSource } from "./demoData";
import { STATUS_LABELS, runLogCsv } from "./export";
import { CopyResult, MatchOptions, Method, QueueCopy, QueueRow } from "./model";
import { planCopies, rulesOf, sourceProblems, usesContextVariables } from "./plan";
import { CUSTOM_STRATEGY, QUEUE_TABLE, QUEUE_TYPE_LABELS, STEP_TYPE_LABELS, STRATEGY_LABELS } from "./schema";

interface Filter { search: string; method: string; }
const EMPTY_FILTER: Filter = { search: "", method: "all" };

interface RunRecord { results: CopyResult[]; info: RunInfo; kind: "copy" | "undo"; from: string; }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The assignment method a queue uses now, in the admin center's words.
function methodNow(queue: QueueRow): string {
  if (queue.strategy !== CUSTOM_STRATEGY) return STRATEGY_LABELS[queue.strategy] ?? "Unknown";
  const active = queue.methods.filter((m) => m.active);
  return active.length ? `Custom: ${active.map((m) => m.name).join(", ")}` : "Custom";
}

function newId(): string {
  return crypto.randomUUID();
}

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const source: CopierSource = live ? dataverseSource : demoSource;
  const environment = live ? environmentLabel() : "the sample environment";

  const [queues, setQueues] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(live ? "" : "Not running inside Dataverse, so this is the sample environment: copies are simulated in this page only.");
  const [fromQueueId, setFromQueueId] = useState("");
  const [methodId, setMethodId] = useState("");
  const [method, setMethod] = useState<Method | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activate, setActivate] = useState(true);
  const [match, setMatch] = useState<MatchOptions>({ byName: true, byRules: true });
  const [clearFirst, setClearFirst] = useState(false);
  // The methods already on the selected queues, read to see whether the source method is among them.
  const [onQueues, setOnQueues] = useState<Record<string, Method>>({});
  const [unreadable, setUnreadable] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<ApplyProgress | undefined>(undefined);
  const [run, setRun] = useState<RunRecord | undefined>(undefined);
  const [confirmingUndo, setConfirmingUndo] = useState(false);

  async function reload() {
    setLoading(true);
    setOnQueues({});
    setUnreadable(new Set());
    try {
      const rows = await source.loadQueues();
      setQueues(rows.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      setMessage(`Couldn't read the queues: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  const sources = useMemo(() => queues.filter((q) => q.methods.length), [queues]);
  const fromQueue = queues.find((q) => q.id === fromQueueId);

  // Read the chosen method's rulesets whenever the choice changes.
  useEffect(() => {
    setMethod(undefined);
    if (!methodId) return;
    let current = true;
    source.loadMethod(methodId).then((m) => { if (current) setMethod(m); })
      .catch((error) => { if (current) setMessage(`Couldn't read the assignment method: ${error instanceof Error ? error.message : String(error)}`); });
    return () => { current = false; };
  }, [methodId]);

  function chooseQueue(id: string) {
    const queue = queues.find((q) => q.id === id);
    setConfirming(false);
    setSelected(new Set());
    setFromQueueId(id);
    setMethodId((queue?.methods.find((m) => m.active) ?? queue?.methods[0])?.id ?? "");
  }

  const candidates = useMemo(() => fromQueue ? queues.filter((q) => q.id !== fromQueue.id && q.type === fromQueue.type) : [], [queues, fromQueue]);
  const otherTypes = fromQueue ? queues.filter((q) => q.type !== fromQueue.type).length : 0;
  const methodsNow = useMemo(() => [...new Set(candidates.map((q) => (q.strategy === CUSTOM_STRATEGY ? "Custom" : STRATEGY_LABELS[q.strategy] ?? "Unknown")))].sort(), [candidates]);

  const visible = useMemo(() => candidates.filter((q) => {
    if (filter.method !== "all" && (q.strategy === CUSTOM_STRATEGY ? "Custom" : STRATEGY_LABELS[q.strategy] ?? "Unknown") !== filter.method) return false;
    const text = filter.search.trim().toLowerCase();
    return !text || q.name.toLowerCase().includes(text);
  }), [candidates, filter]);

  const selectedRows = useMemo(() => candidates.filter((q) => selected.has(q.id)), [candidates, selected]);
  const matching = match.byName || match.byRules;

  // Read the methods on the selected queues that haven't been read yet.
  const toRead = useMemo(() => matching || clearFirst ? selectedRows.flatMap((q) => q.methods.map((m) => m.id)).filter((id) => !onQueues[id] && !unreadable.has(id)) : [], [matching, clearFirst, selectedRows, onQueues, unreadable]);
  useEffect(() => {
    if (!toRead.length) return;
    let current = true;
    void Promise.all(toRead.map((id) => source.loadMethod(id).then((m) => ({ id, m }), () => ({ id, m: undefined })))).then((read) => {
      if (!current) return;
      setOnQueues((known) => ({ ...known, ...Object.fromEntries(read.filter((r) => r.m).map((r) => [r.id, r.m!])) }));
      const failed = read.filter((r) => !r.m).map((r) => r.id);
      if (failed.length) setUnreadable((known) => new Set([...known, ...failed]));
    });
    return () => { current = false; };
  }, [toRead.join(",")]);
  const checking = toRead.length > 0;

  const problems = useMemo(() => fromQueue && method ? sourceProblems({ queue: fromQueue, method }) : [], [fromQueue, method]);
  const plan = useMemo(() => fromQueue && method && !checking ? planCopies({ queue: fromQueue, method }, selectedRows, { activate, match, clearFirst }, newId, onQueues) : [],
    [fromQueue, method, selectedRows, activate, match, clearFirst, onQueues, checking]);
  const emptied = plan.filter((p) => p.status !== "blocked").reduce((n, p) => n + p.cleared.length, 0);
  const planById = useMemo(() => new Map(plan.map((p) => [p.queue.id, p])), [plan]);
  const toCopy = plan.filter((p) => p.status === "copy");
  const toUpdate = plan.filter((p) => p.status === "update");
  const upToDate = plan.filter((p) => p.status === "upToDate");
  const blocked = plan.filter((p) => p.status === "blocked");
  const toApply = [...toCopy, ...toUpdate];
  const hiddenSelected = selectedRows.filter((q) => !visible.includes(q)).length;
  const allVisibleSelected = visible.length > 0 && visible.every((q) => selected.has(q.id));

  function toggle(id: string) {
    setConfirming(false);
    setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleAllVisible() {
    setConfirming(false);
    setSelected((s) => {
      const next = new Set(s);
      if (allVisibleSelected) visible.forEach((q) => next.delete(q.id)); else visible.forEach((q) => next.add(q.id));
      return next;
    });
  }

  async function finish(results: CopyResult[], kind: RunRecord["kind"], startedAt: string, from: string) {
    setProgress(undefined);
    setRun({ results, kind, from, info: { tool: "Assignment Method Copier", mode: source.mode, environment, user: source.currentUser(), startedAt, finishedAt: new Date().toISOString() } });
    await reload();
  }

  async function runCopy(copies: QueueCopy[]) {
    if (!fromQueue || !method) return;
    setConfirming(false);
    const startedAt = new Date().toISOString();
    const results = await applyCopies(copies, source, setProgress);
    setSelected(new Set());
    await finish(results, "copy", startedAt, `${method.name} (${fromQueue.name})`);
  }

  async function runUndo(previous: RunRecord) {
    setConfirmingUndo(false);
    const startedAt = new Date().toISOString();
    const results = await undoChanges(previous.results, source, setProgress);
    await finish(results, "undo", startedAt, previous.from);
  }

  const busy = !!progress;
  const ready = !!fromQueue && !!method && !problems.length;

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">AMC</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Assignment Method Copier</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{source.mode === "live" ? <>Changes <strong>{environment}</strong></> : "Sample environment — nothing is written"}</span>
        <button className="button secondary" onClick={() => void reload()} disabled={loading || busy}>{loading ? "Loading…" : "Reload queues"}</button>
      </div>
    </header>

    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}

    <div className="write-banner" role="note">
      <span className="write-icon" aria-hidden="true">✎</span>
      <span><strong>This tool changes live queues{source.mode === "live" ? ` in ${environment}` : ""}.</strong> It copies one queue's custom assignment method to the queues you select, or updates the rules of that method where a queue already has it, and, if you ask, first removes all assignment rules on those queues. It does this only after you confirm. A queue that uses the method assigns new work by its rules straight away. Nothing is deleted: a method the queue already had stays on it, switched off.</span>
    </div>

    {progress && <section className="progress-strip"><div className="progress-bar"><div style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 100}%` }} /></div><span>{progress.done}/{progress.total} — {progress.message}</span></section>}

    {run && !progress && <RunSummary run={run} source={source} confirmingUndo={confirmingUndo}
      onUndo={() => setConfirmingUndo(true)} onCancelUndo={() => setConfirmingUndo(false)}
      onConfirmUndo={() => void runUndo(run)} onDismiss={() => { setRun(undefined); setConfirmingUndo(false); }} />}

    <section className="workspace">
      <aside className="sidebar">
        <div className="section-heading"><div><p className="eyebrow">Copy from</p><h2>Assignment method</h2></div><span className="count">{sources.length}</span></div>
        <div className="filter-group">
          <span className="filter-label">Queue</span>
          <select value={fromQueueId} onChange={(e) => chooseQueue(e.target.value)} disabled={busy}>
            <option value="">{loading ? "Loading…" : sources.length ? "Choose a queue" : "No queue has a custom method"}</option>
            {sources.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
        </div>
        {fromQueue && fromQueue.methods.length > 1 && <div className="filter-group">
          <span className="filter-label">Method</span>
          <select value={methodId} onChange={(e) => { setConfirming(false); setMethodId(e.target.value); }} disabled={busy}>
            {fromQueue.methods.map((m) => <option key={m.id} value={m.id}>{m.name}{m.active ? " (in use)" : ""}</option>)}
          </select>
        </div>}
        {fromQueue && method && <MethodDetail queue={fromQueue} method={method} problems={problems} />}
        {fromQueue && methodId && !method && <p className="muted">Reading the method…</p>}

        {fromQueue && <>
          <div className="section-heading filters-heading"><div><p className="eyebrow">Filters</p><h2>{QUEUE_TYPE_LABELS[fromQueue.type] ?? "Other"} queues</h2></div><span className="count">{visible.length}/{candidates.length}</span></div>
          <label className="search"><span>⌕</span><input placeholder="Search queue" value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} /></label>
          <div className="filter-group">
            <span className="filter-label">Assignment method now</span>
            <select value={filter.method} onChange={(e) => setFilter((f) => ({ ...f, method: e.target.value }))}>
              <option value="all">Any</option>
              {methodsNow.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button className="button ghost small" onClick={() => setFilter(EMPTY_FILTER)}>Clear filters</button>
          {otherTypes > 0 && <p className="muted small-note">{plural(otherTypes, "queue")} of another type {otherTypes === 1 ? "isn't" : "aren't"} shown: a method is only copied between queues of the same type.</p>}
        </>}
        <div className="sidebar-footer"><span className="shield">◇</span><span>Creates assignment methods and their rulesets on the queues you select, updates the rules of a method a queue already has, empties a queue's rulesets if you ask, and sets which method those queues use. Never deletes a record.</span></div>
      </aside>

      <section className="content">
        <div className="selection-bar">
          <label className="checkbox-row"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={!visible.length || busy} /> Select all {visible.length} shown</label>
          <span>{selected.size} selected{hiddenSelected ? ` (${hiddenSelected} hidden by filters)` : ""}</span>
          {selected.size > 0 && <button className="button ghost small" onClick={() => { setSelected(new Set()); setConfirming(false); }}>Clear selection</button>}
        </div>
        <div className="data-table queue-table" role="table" aria-label="Queues to copy to">
          <div className="data-head" role="row"><span /><span>Queue</span><span>Assignment method now</span><span>After this copy</span></div>
          {visible.length ? visible.map((q) => {
            const p = planById.get(q.id);
            return <label role="row" key={q.id} className={`data-row ${selected.has(q.id) ? "selected" : ""}`}>
              <span><input type="checkbox" checked={selected.has(q.id)} onChange={() => toggle(q.id)} disabled={busy} /></span>
              <span className="cell-strong">{q.name}<small>{QUEUE_TYPE_LABELS[q.type] ?? "Other"}{q.methods.length ? ` · ${plural(q.methods.length, "custom method")}` : ""}</small></span>
              <span className="cell-muted">{methodNow(q)}</span>
              <span>{p ? <PreviewCell copy={p} /> : <span className="cell-muted">—</span>}</span>
            </label>;
          }) : <div className="scenario-empty"><span>◔</span><p>{loading ? "Loading queues…" : !fromQueue ? "Choose the queue to copy from" : "No queues match these filters"}</p></div>}
        </div>
      </section>

      <aside className="inspector">
        <p className="eyebrow">Copy to</p>
        <h2>{plural(selected.size, "queue")}</h2>

        <p className="detail-label">After copying</p>
        <div className="preset-list" role="radiogroup" aria-label="After copying">
          <label className={`preset ${activate ? "active" : ""}`}>
            <input type="radio" name="activate" checked={activate} onChange={() => { setActivate(true); setConfirming(false); }} />
            <span><strong>Use it on the queue</strong><small>The copy becomes the queue's assignment method. New work is assigned by its rules straight away.</small></span>
          </label>
          <label className={`preset ${!activate ? "active" : ""}`}>
            <input type="radio" name="activate" checked={!activate} onChange={() => { setActivate(false); setConfirming(false); }} />
            <span><strong>Copy only</strong><small>The copy is added to the queue but not used. Select it in the admin center when you're ready.</small></span>
          </label>
        </div>

        <p className="detail-label">Already on the queue</p>
        <div className="match-options">
          <label className="checkbox-row"><input type="checkbox" checked={match.byRules} onChange={(e) => { setMatch((m) => ({ ...m, byRules: e.target.checked })); setConfirming(false); }} disabled={busy} />
            <span><strong>A method with the same rules</strong><small>Rules with the same conditions and actions, whatever the method is called.</small></span></label>
          <label className="checkbox-row"><input type="checkbox" checked={match.byName} onChange={(e) => { setMatch((m) => ({ ...m, byName: e.target.checked })); setConfirming(false); }} disabled={busy} />
            <span><strong>A method with the same name</strong><small>"{method?.name ?? "The method"}", whatever its rules are now.</small></span></label>
          <p className="muted small-note">{matching
            ? "Such a method is updated instead of copied again: its rulesets get the source's rules, missing rulesets are added. A rule that does the same, or has the same name, keeps its id."
            : "Every queue gets a new copy. If the name is taken on a queue, the copy is numbered."}</p>
        </div>

        <p className="detail-label">Before copying</p>
        <div className="match-options">
          <label className="checkbox-row"><input type="checkbox" checked={clearFirst} onChange={(e) => { setClearFirst(e.target.checked); setConfirming(false); }} disabled={busy} />
            <span><strong>Remove all assignment rules upfront</strong><small>Every ruleset of every custom method on the selected queues is emptied first, so only the source's rules are left. The methods and rulesets stay; Undo changes puts the rules back.</small></span></label>
        </div>

        <div className="preview">
          <p className="detail-label">Preview</p>
          {!fromQueue ? <p className="muted">Choose the queue to copy from.</p> : !method ? <p className="muted">Reading the method…</p> : problems.length ? <p className="muted">This method can't be copied; see the reason on the left.</p> : !selected.size ? <p className="muted">Select queues in the list to see what would be copied.</p> : checking ? <p className="muted">Checking the methods already on the selected queues…</p> : <>
            <ul className="preview-counts">
              <li><strong>{toCopy.length}</strong> will get a new copy</li>
              {matching && <li><strong>{toUpdate.filter(changesRules).length}</strong> already have it, to be updated</li>}
              {matching && toUpdate.some((p) => !changesRules(p)) && <li><strong>{toUpdate.filter((p) => !changesRules(p)).length}</strong> already have it, to be switched on</li>}
              {matching && <li><strong>{upToDate.length}</strong> already up to date</li>}
              <li><strong>{blocked.length}</strong> can't be copied to</li>
              {clearFirst && <li><strong>{emptied}</strong> {emptied === 1 ? "ruleset" : "rulesets"} emptied first</li>}
            </ul>
            <p className="muted">The method has {plural(method.steps.length, "ruleset")} with {plural(method.steps.reduce((n, s) => n + (s.ruleset ? rulesOf(s.ruleset.definition).length : 0), 0), "rule")}.</p>
          </>}
        </div>

        {!confirming
          ? <button className="button primary full" disabled={!ready || checking || !toApply.length || busy} onClick={() => setConfirming(true)}>{applyLabel(toCopy.length, toUpdate.length)}</button>
          : <div className="confirm-box">
            <p><strong>{confirmTitle(method?.name ?? "", toCopy.length, toUpdate.length)} in {environment}?</strong>{" "}
              {activate ? "Each queue is switched to the method and assigns new work by its rules straight away." : "The queues keep the method they use now."}
              {emptied ? ` First, ${emptied === 1 ? "1 ruleset is" : `${emptied} rulesets are`} emptied on these queues.` : ""}
              {toUpdate.some(changesRules) || emptied ? " Updated or removed rules take effect straight away on a queue that uses that method." : ""}
              {toApply.some((p) => p.notes.some((n) => n.startsWith("Warning:"))) ? " Some queues keep using a method whose rules are removed; see the warnings in the list." : ""}
              {" "}You can undo this afterwards. New copies stay on the queues; this tool doesn't delete them.</p>
            <div><button className="button ghost" onClick={() => setConfirming(false)}>Cancel</button><button className="button danger" onClick={() => void runCopy(toApply)}>Yes, {toCopy.length ? "copy" : "update"}</button></div>
          </div>}
      </aside>
    </section>
  </main>;
}

function applyLabel(copies: number, updates: number): string {
  if (copies && updates) return `Copy to ${plural(copies, "queue")}, update ${updates}`;
  if (updates) return `Update on ${plural(updates, "queue")}`;
  return `Copy to ${plural(copies, "queue")}`;
}

// An update that rewrites or adds rulesets, not only switches the method on.
const changesRules = (copy: QueueCopy) => !!copy.existing && (copy.existing.updates.length > 0 || copy.steps.length > 0 || copy.cleared.length > 0);

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function confirmTitle(name: string, copies: number, updates: number): string {
  const copy = `copy "${name}" to ${plural(copies, "queue")}`;
  const update = `update "${name}" on ${plural(updates, "queue")}`;
  return sentence(copies && updates ? `${copy} and ${update.replace(`"${name}" `, "it ")}` : updates ? update : copy);
}

function MethodDetail({ queue, method, problems }: { queue: QueueRow; method: Method; problems: string[] }): React.ReactElement {
  return <div className="method-detail">
    <p className="detail-label">{method.name}</p>
    <p className="muted">{method.active && queue.strategy === CUSTOM_STRATEGY ? "In use on this queue." : "Not in use on this queue."}{method.description ? ` ${method.description}` : ""}</p>
    {method.steps.map((step) => {
      const rules = step.ruleset ? rulesOf(step.ruleset.definition) : [];
      return <div className="method-step" key={step.id}>
        <strong>{STEP_TYPE_LABELS[step.type] ?? "Ruleset"}: {step.ruleset?.name ?? step.name}</strong>
        {rules.length ? <ol>{rules.map((r) => <li key={r.id}>{r.name || "(unnamed rule)"}</li>)}</ol> : <small className="muted">No rules</small>}
      </div>;
    })}
    {method.steps.some((s) => s.ruleset && usesContextVariables(s.ruleset.definition)) && <p className="muted method-note">Some rules use context variables, which belong to one workstream. On any queue, those rules only match work from that workstream.</p>}
    {problems.length > 0 && <ul className="blocked-list">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
  </div>;
}

function PreviewCell({ copy }: { copy: QueueCopy }): React.ReactElement {
  if (copy.status === "blocked") return <span className="preview-blocked">Can't copy<small>{copy.reasons.join(" ")}</small></span>;
  const matched = copy.existing ? ` (same ${copy.existing.matchedBy})` : "";
  if (copy.status === "upToDate") return <span className="preview-same">Already up to date<small>"{copy.methodName}"{matched} matches the source.</small></span>;
  if (copy.status === "update" && !changesRules(copy)) return <span className="preview-change">Custom: {copy.methodName}<small>{[`Already there${matched}; it's switched on.`, ...copy.notes].join(" ")}</small></span>;
  const inUse = copy.queue.strategy === CUSTOM_STRATEGY && copy.queue.methods.some((m) => m.active && m.id === copy.existing?.id);
  const title = copy.status === "update"
    ? `${copy.activate || inUse ? "Custom" : "Unchanged"}; "${copy.methodName}" updated${matched}`
    : copy.activate ? `Custom: ${copy.methodName}` : `Unchanged; "${copy.methodName}" added`;
  const warnings = copy.notes.filter((n) => n.startsWith("Warning:"));
  const notes = copy.notes.filter((n) => !n.startsWith("Warning:"));
  return <span className="preview-change">{title}{notes.length > 0 && <small>{notes.join(" ")}</small>}{warnings.map((w) => <small key={w} className="preview-warning">{w}</small>)}</span>;
}

function RunSummary({ run, source, confirmingUndo, onUndo, onCancelUndo, onConfirmUndo, onDismiss }: {
  run: RunRecord; source: CopierSource; confirmingUndo: boolean;
  onUndo: () => void; onCancelUndo: () => void; onConfirmUndo: () => void; onDismiss: () => void;
}): React.ReactElement {
  const done = run.results.filter((r) => r.status === "copied");
  const problems = run.results.filter((r) => r.status !== "copied");
  const switched = run.results.filter((r) => r.activated).length;
  const rewritten = run.results.filter((r) => r.updated.length).length;
  const copied = done.filter((r) => !r.copy.existing).length;
  const updated = done.filter((r) => r.copy.existing).length;
  const isCopy = run.kind === "copy";
  const headline = isCopy
    ? [copied || !updated ? `Copied to ${plural(copied, "queue")}` : "", updated ? `${copied ? "updated on" : "Updated on"} ${plural(updated, "queue")}` : ""].filter(Boolean).join(", ")
    : `${plural(done.length, "queue")} undone`;
  return <section className={`run-summary ${problems.length ? "has-failures" : ""}`}>
    <div className="run-head">
      <div>
        <p className="eyebrow">{isCopy ? "Method copied" : "Changes undone"} · {new Date(run.info.finishedAt).toLocaleString()} · {run.info.user}</p>
        <h2>{headline}{problems.length ? `, ${problems.length} with a problem` : ""}</h2>
        <p className="muted">{run.from}{isCopy ? ` · ${plural(switched, "queue")} switched to it` : " · new copies stay on the queues, switched off"}.</p>
      </div>
      <div className="run-actions">
        <button className="button secondary" onClick={() => downloadCsv(logFileName(`assignment-method-${run.kind}`, run.info), runLogCsv(run.results, run.info, isCopy ? "Copy" : "Undo", run.from))}>⇩ Download log</button>
        {isCopy && (switched > 0 || rewritten > 0) && !confirmingUndo && <button className="button ghost" onClick={onUndo}>Undo changes</button>}
        <button className="icon-button" aria-label="Dismiss" onClick={onDismiss}>×</button>
      </div>
    </div>
    {confirmingUndo && <div className="confirm-box">
      <p><strong>Undo this run?</strong> {sentence([
        switched ? `${plural(switched, "queue")} go${switched === 1 ? "es" : ""} back to the assignment method ${switched === 1 ? "it" : "they"} used before` : "",
        rewritten ? `the rules removed or rewritten on ${plural(rewritten, "queue")} are put back as they were` : ""
      ].filter(Boolean).join(", and "))}. New copies stay on the queues, switched off.</p>
      <div><button className="button ghost" onClick={onCancelUndo}>Cancel</button><button className="button danger" onClick={onConfirmUndo}>Yes, undo</button></div>
    </div>}
    {problems.length > 0 && <ul className="failure-list">{problems.map((r) => {
      const url = source.recordUrl(QUEUE_TABLE, r.copy.queue.id);
      return <li key={r.copy.queue.id} className={r.status === "notVerified" ? "notVerified" : "failed"}>
        <strong>{url ? <a href={url} target="_blank" rel="noreferrer">{r.copy.queue.name}</a> : r.copy.queue.name}</strong>
        <span>{STATUS_LABELS[r.status]}: {r.error}</span>
      </li>;
    })}</ul>}
  </section>;
}
