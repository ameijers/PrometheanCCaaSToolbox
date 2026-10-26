// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { downloadCsv } from "../../voice-workstream-builder/src/csv";
import { RunInfo, logFileName } from "../../voice-workstream-builder/src/runLog";
import { ApplyProgress, applySteps } from "./apply";
import { NumberSource } from "./dataSource";
import { clientUrl, dataverseSource, isDataverseAvailable } from "./dataverse";
import { demoSource } from "./demoData";
import { runLogCsv } from "./export";
import { ApplyResult, ChannelRow, Edit, isOutbound, Kind, KIND_LABELS, KIND_PLURALS, PhoneNumber } from "./model";
import { choicesFor, describeChange, numberLabel, orderSteps, planChanges, revertEdits, withDetaches } from "./plan";

interface Filter { search: string; kind: "all" | Kind; includeInactive: boolean; changedOnly: boolean; }
const EMPTY_FILTER: Filter = { search: "", kind: "all", includeInactive: false, changedOnly: false };

interface RunRecord { results: ApplyResult[]; info: RunInfo; kind: "apply" | "revert"; }

// On an outbound channel the caller ID follows the number, unless it was set to another number.
const followsByDefault = (c: ChannelRow) => !c.callerIdId || c.callerIdId === c.numberId;

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const source: NumberSource = live ? dataverseSource : demoSource;
  const environment = live ? (clientUrl()?.replace(/^https:\/\//, "") ?? "this environment") : "the sample environment";

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(live ? "" : "Not running inside Dataverse, so this is the sample environment: changes are simulated in this page only.");
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [edits, setEdits] = useState<Map<string, Edit>>(new Map());
  // Take a number off its other channel automatically when another channel gets it.
  const [detach, setDetach] = useState(false);
  const effective = useMemo(() => (detach ? withDetaches(channels, edits) : edits), [detach, channels, edits]);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<ApplyProgress | undefined>(undefined);
  const [run, setRun] = useState<RunRecord | undefined>(undefined);
  const [confirmingRevert, setConfirmingRevert] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const data = await source.load();
      const order: Kind[] = ["inbound", "outbound", "proactive", "other"];
      setChannels(data.channels.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.workstreamName.localeCompare(b.workstreamName) || (a.workstreamId ?? "").localeCompare(b.workstreamId ?? "") || a.name.localeCompare(b.name)));
      setNumbers(data.numbers.sort((a, b) => a.number.localeCompare(b.number)));
    } catch (error) {
      setMessage(`Couldn't read the voice channels and numbers: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void reload(); }, []);

  const numberById = useMemo(() => new Map(numbers.map((n) => [n.id, n])), [numbers]);
  const plan = useMemo(() => planChanges(channels, numbers, effective), [channels, numbers, effective]);
  const changeById = useMemo(() => new Map(plan.changes.map((c) => [c.channel.id, c])), [plan]);
  const issuesById = useMemo(() => {
    const m = new Map<string, typeof plan.issues>();
    plan.issues.forEach((i) => m.set(i.channelId, [...(m.get(i.channelId) ?? []), i]));
    return m;
  }, [plan]);
  const errors = plan.issues.filter((i) => i.severity === "error");
  const usedBy = useMemo(() => {
    const m = new Map<string, ChannelRow[]>();
    channels.forEach((c) => [c.numberId, c.callerIdId !== c.numberId ? c.callerIdId : undefined].forEach((n) => { if (n) m.set(n, [...(m.get(n) ?? []), c]); }));
    return m;
  }, [channels]);

  const visible = useMemo(() => channels.filter((c) => {
    if (!filter.includeInactive && !c.active) return false;
    if (filter.kind !== "all" && c.kind !== filter.kind) return false;
    if (filter.changedOnly && !changeById.has(c.id)) return false;
    const q = filter.search.trim().toLowerCase();
    return !q || [c.name, c.workstreamName, numberLabel(numberById, c.numberId), numberLabel(numberById, c.callerIdId)].some((v) => v.toLowerCase().includes(q));
  }), [channels, filter, changeById, numberById]);

  // The list grouped: a heading per kind, then per workstream, with its voice channels under it.
  type Item = { type: "kind"; kind: Kind; count: number } | { type: "workstream"; key: string; name: string; kind: Kind; channels: number } | { type: "channel"; channel: ChannelRow; flat: boolean };
  const grouped = useMemo(() => {
    const items: Item[] = [];
    let kind: Kind | undefined, ws: string | undefined;
    visible.forEach((c) => {
      if (c.kind !== kind) { kind = c.kind; ws = undefined; items.push({ type: "kind", kind, count: visible.filter((v) => v.kind === kind).length }); }
      // An outbound profile is a workstream with one voice channel: one row, no heading of its own.
      const flat = isOutbound(c.kind) && visible.filter((v) => v.workstreamId === c.workstreamId).length === 1;
      const key = c.workstreamId ?? c.workstreamName;
      if (!flat && key !== ws) { ws = key; items.push({ type: "workstream", key, name: c.workstreamName, kind: c.kind, channels: visible.filter((v) => (v.workstreamId ?? v.workstreamName) === key).length }); }
      items.push({ type: "channel", channel: c, flat });
    });
    return items;
  }, [visible]);

  function edit(channel: ChannelRow, patch: Partial<Edit> | undefined) {
    setConfirming(false);
    setEdits((current) => {
      const next = new Map(current);
      if (!patch) { next.delete(channel.id); return next; }
      const base: Edit = next.get(channel.id) ?? { numberId: channel.numberId ?? null, callerIdFollows: followsByDefault(channel) };
      next.set(channel.id, { ...base, ...patch });
      return next;
    });
  }

  async function runSteps(kind: RunRecord["kind"], editsToRun: Map<string, Edit>) {
    setConfirming(false);
    setConfirmingRevert(false);
    const startedAt = new Date().toISOString();
    const thePlan = planChanges(channels, numbers, editsToRun);
    const results = await applySteps(orderSteps(thePlan, channels), channels, source, setProgress);
    setProgress(undefined);
    setRun({ results, kind, info: { tool: "Phone Number Changer", mode: source.mode, environment, user: source.currentUser(), startedAt, finishedAt: new Date().toISOString() } });
    setEdits(new Map());
    await reload();
  }

  const busy = !!progress;
  const counts = { inbound: 0, outbound: 0, proactive: 0, other: 0 } as Record<Kind, number>;
  channels.forEach((c) => { counts[c.kind] += 1; });

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">PNC</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Phone Number Changer</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{source.mode === "live" ? <>Changes <strong>{environment}</strong></> : "Sample environment — nothing is written"}</span>
        <button className="button secondary" onClick={() => void reload()} disabled={loading || busy}>{loading ? "Loading…" : "Reload"}</button>
      </div>
    </header>

    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}

    <div className="write-banner" role="note">
      <span className="write-icon" aria-hidden="true">✎</span>
      <span><strong>This tool changes the numbers of live voice channels{source.mode === "live" ? ` in ${environment}` : ""}.</strong> It only writes a channel's phone number and caller ID, only on the channels you change, and only after you confirm. Calls to a number arrive at its new channel straight away. The numbers must already be set up and synced into Contact Center.</span>
    </div>

    {progress && <section className="progress-strip"><div className="progress-bar"><div style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 100}%` }} /></div><span>{progress.done}/{progress.total} — {progress.message}</span></section>}

    {run && !progress && <RunSummary run={run} numbers={numberById} confirmingRevert={confirmingRevert} source={source}
      onRevert={() => setConfirmingRevert(true)} onCancelRevert={() => setConfirmingRevert(false)}
      onConfirmRevert={() => void runSteps("revert", revertEdits(run.results))}
      onDownload={() => downloadCsv(logFileName(`numbers-${run.kind}`, run.info), runLogCsv(run.results, numbers, run.info, run.kind === "apply" ? "Change" : "Revert"))}
      onDismiss={() => { setRun(undefined); setConfirmingRevert(false); }} />}

    <section className="workspace">
      <aside className="sidebar">
        <div className="section-heading"><div><p className="eyebrow">Filters</p><h2>Voice channels</h2></div><span className="count">{visible.length}/{channels.length}</span></div>
        <label className="search"><span>⌕</span><input placeholder="Search channel, workstream or number" value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} /></label>
        <div className="filter-group">
          <span className="filter-label">Kind</span>
          <select value={filter.kind} onChange={(e) => setFilter((f) => ({ ...f, kind: e.target.value as Filter["kind"] }))}>
            <option value="all">All ({channels.length})</option>
            {(Object.keys(KIND_LABELS) as Kind[]).filter((k) => counts[k]).map((k) => <option key={k} value={k}>{KIND_PLURALS[k]} ({counts[k]})</option>)}
          </select>
        </div>
        <label className="checkbox-row"><input type="checkbox" checked={filter.changedOnly} onChange={(e) => setFilter((f) => ({ ...f, changedOnly: e.target.checked }))} /> Only channels I'm changing</label>
        <label className="checkbox-row"><input type="checkbox" checked={filter.includeInactive} onChange={(e) => setFilter((f) => ({ ...f, includeInactive: e.target.checked }))} /> Show deactivated channels</label>
        <button className="button ghost small" onClick={() => setFilter(EMPTY_FILTER)}>Clear filters</button>
        <div className="sidebar-footer"><span className="shield">◇</span><span>Writes only a voice channel's phone number and caller ID lookups. Never creates or deletes anything, and never changes the numbers themselves.</span></div>
      </aside>

      <section className="content">
        <div className="selection-bar">
          <span>Pick a new number for each channel to change. A number can be on one inbound channel and one outbound profile; a number that is <em>now on</em> another channel can only be picked if that channel gets another number in the same change (a move or a swap), or with <strong>Take a number off its other channel automatically</strong> switched on. An outbound profile is an outbound workstream the admin center doesn't show; its caller ID follows the number unless you switch that off.</span>
          {edits.size > 0 && <button className="button ghost small" onClick={() => { setEdits(new Map()); setConfirming(false); }}>Undo all picks</button>}
        </div>
        <div className="data-table number-table" role="table" aria-label="Voice channels and their numbers">
          <div className="data-head" role="row"><span>Channel</span><span>Number now</span><span>New number</span><span>Caller ID</span></div>
          {visible.length ? grouped.map((item) => {
            if (item.type === "kind") return <div role="row" key={`kind:${item.kind}`} className="kind-head"><span>{KIND_PLURALS[item.kind]}</span><span>{item.count} channel{item.count === 1 ? "" : "s"}</span></div>;
            if (item.type === "workstream") return <div role="row" key={`ws:${item.key}`} className="group-head"><span>{item.name}</span><span>{item.channels > 1 ? `${item.channels} voice channels` : item.kind === "inbound" ? "1 voice channel" : ""}</span></div>;
            const c = item.channel;
            const e = edits.get(c.id);
            const change = changeById.get(c.id);
            const issues = issuesById.get(c.id) ?? [];
            const out = isOutbound(c.kind);
            const value = e === undefined ? "" : e.numberId === null ? "none" : e.numberId;
            return <div role="row" key={c.id} className={`data-row ${change ? "selected" : ""} ${issues.some((i) => i.severity === "error") ? "has-error" : ""}`}>
              <span className={`cell-strong ${item.flat ? "" : "channel-cell"}`}>{c.name}{item.flat && c.workstreamName !== c.name && <small>workstream {c.workstreamName}</small>}{!c.active && <small>deactivated</small>}</span>
              <span>{numberLabel(numberById, c.numberId)}{out && <small>caller ID {numberLabel(numberById, c.callerIdId)}</small>}</span>
              <span>
                <select aria-label={`New number for ${c.name}`} value={value} disabled={busy} onChange={(ev) => {
                  const v = ev.target.value;
                  if (v === "") edit(c, undefined); else edit(c, { numberId: v === "none" ? null : v });
                }}>
                  <option value="">{numberLabel(numberById, c.numberId)} (current)</option>
                  {choicesFor(c, numbers, channels).map(({ number, reason, heldBy }) => (
                    <option key={number.id} value={number.id} disabled={!!reason}>
                      {number.number} — {reason ?? (heldBy.length ? `now on ${heldBy.map((h) => h.name).join(", ")}${detach ? " (taken off it)" : ""}` : "free")}
                    </option>
                  ))}
                  {c.numberId && <option value="none">No number</option>}
                </select>
                {change && <small className="preview-change">{describeChange(change, numberById)}</small>}
                {issues.map((i, k) => <small key={k} className={`issue ${i.severity}`}>{i.message}</small>)}
              </span>
              <span>{out ? <label className="checkbox-row compact"><input type="checkbox" disabled={busy || !e} checked={e ? e.callerIdFollows !== false : followsByDefault(c)} onChange={(ev) => edit(c, { callerIdFollows: ev.target.checked })} /> follows the number</label> : <span className="cell-muted">—</span>}</span>
            </div>;
          }) : <div className="scenario-empty"><span>◔</span><p>{loading ? "Loading voice channels…" : "No voice channels match these filters"}</p></div>}
        </div>
      </section>

      <aside className="inspector">
        <p className="eyebrow">Change</p>
        <h2>{plan.changes.length ? `${plan.changes.length} channel${plan.changes.length === 1 ? "" : "s"} to change` : "Nothing picked yet"}</h2>
        <label className="switch-row">
          <input type="checkbox" role="switch" checked={detach} disabled={busy} onChange={(e) => { setDetach(e.target.checked); setConfirming(false); }} />
          <span><strong>Take a number off its other channel automatically</strong><small>When you pick a number that is now on another channel of the same direction, that channel is left without a number in the same change (unless you give it another one).</small></span>
        </label>
        {plan.changes.length ? <ul className="plan-list">
          {plan.changes.map((c) => <li key={c.channel.id} className={`${(issuesById.get(c.channel.id) ?? []).some((i) => i.severity === "error") ? "error" : ""} ${c.auto ? "auto" : ""}`}>
            <strong>{c.channel.name}</strong><span>{describeChange(c, numberById)}</span>
          </li>)}
        </ul> : <p className="muted">Pick a new number for a channel in the list. To move a number, also give its old channel another number (or no number); to swap two, pick each other's.</p>}
        {errors.length > 0 && <p className="error-text">{errors.length} problem{errors.length === 1 ? "" : "s"} to solve first (shown in red in the list).</p>}

        {!confirming
          ? <button className="button primary full" disabled={!plan.changes.length || errors.length > 0 || busy} onClick={() => setConfirming(true)}>Change {plan.changes.length || ""} number{plan.changes.length === 1 ? "" : "s"}</button>
          : <div className="confirm-box">
            <p><strong>Change the numbers of {plan.changes.length} voice channel{plan.changes.length === 1 ? "" : "s"} in {environment}?</strong> Calls to a moved number arrive at its new channel straight away. You can revert this afterwards, and download a log of it.</p>
            <div><button className="button ghost" onClick={() => setConfirming(false)}>Cancel</button><button className="button danger" onClick={() => void runSteps("apply", effective)}>Yes, change</button></div>
          </div>}

        <details className="numbers-overview">
          <summary>Numbers in this environment ({numbers.length})</summary>
          <ul>
            {numbers.map((n) => <li key={n.id} className={n.active ? "" : "inactive"}>
              <strong>{n.number}</strong>
              <small>{[n.inbound ? "inbound" : "", n.outbound ? "outbound" : ""].filter(Boolean).join(" + ") || "no calls"}{n.active ? "" : " · deactivated"}</small>
              <small>{(usedBy.get(n.id) ?? []).map((u) => u.name).join(", ") || "free"}</small>
            </li>)}
          </ul>
        </details>
      </aside>
    </section>
  </main>;
}

function RunSummary({ run, numbers, confirmingRevert, source, onRevert, onCancelRevert, onConfirmRevert, onDownload, onDismiss }: {
  run: RunRecord; numbers: Map<string, PhoneNumber>; confirmingRevert: boolean; source: NumberSource;
  onRevert: () => void; onCancelRevert: () => void; onConfirmRevert: () => void; onDownload: () => void; onDismiss: () => void;
}): React.ReactElement {
  const updated = run.results.filter((r) => r.status === "updated").length;
  const notVerified = run.results.filter((r) => r.status === "notVerified");
  const problems = run.results.filter((r) => r.status === "failed" || r.status === "skipped");
  const revertable = run.kind === "apply" && updated + notVerified.length > 0;
  return <section className={`run-summary ${problems.length ? "has-failures" : ""}`}>
    <div className="run-head">
      <div>
        <p className="eyebrow">{run.kind === "apply" ? "Numbers changed" : "Numbers put back"} · {new Date(run.info.finishedAt).toLocaleString()} · {run.info.user}</p>
        <h2>{updated} channel{updated === 1 ? "" : "s"} updated{notVerified.length ? `, ${notVerified.length} not confirmed` : ""}{problems.length ? `, ${problems.length} not changed` : ""}</h2>
        <ul className="plan-list compact">{run.results.filter((r) => r.status !== "failed" && r.status !== "skipped").map((r) => <li key={r.change.channel.id}><strong>{r.change.channel.name}</strong><span>{describeChange(r.change, numbers)}</span></li>)}</ul>
      </div>
      <div className="run-actions">
        <button className="button secondary" onClick={onDownload}>⇩ Download log</button>
        {revertable && !confirmingRevert && <button className="button ghost" onClick={onRevert}>Revert this change</button>}
        <button className="icon-button" aria-label="Dismiss" onClick={onDismiss}>×</button>
      </div>
    </div>
    {confirmingRevert && <div className="confirm-box">
      <p><strong>Put the previous numbers back on {updated + notVerified.length} channel{updated + notVerified.length === 1 ? "" : "s"}?</strong> Calls go to their old channels again straight away.</p>
      <div><button className="button ghost" onClick={onCancelRevert}>Cancel</button><button className="button danger" onClick={onConfirmRevert}>Yes, revert</button></div>
    </div>}
    {[...problems, ...notVerified].length > 0 && <ul className="failure-list">{[...problems, ...notVerified].map((r) => {
      const url = source.recordUrl(r.change.channel.id);
      return <li key={r.change.channel.id} className={r.status}>
        <strong>{url ? <a href={url} target="_blank" rel="noreferrer">{r.change.channel.name}</a> : r.change.channel.name}</strong>
        <span>{r.status === "failed" ? "Not changed: " : ""}{r.error}</span>
      </li>;
    })}</ul>}
  </section>;
}
