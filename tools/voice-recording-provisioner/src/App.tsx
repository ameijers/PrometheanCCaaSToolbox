// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { downloadCsv } from "../../voice-workstream-builder/src/csv";
import {
  CAPTURE_LABELS, CAPTURE_OPTIONS, Capture, RECORDING_FIELD_LABELS, ReadCapture, START_LABELS, START_MODES, StartMode, describeCapture
} from "../../voice-workstream-builder/src/recordingSettings";
import { RunInfo, logFileName } from "../../voice-workstream-builder/src/runLog";
import { ApplyProgress, applyChanges, revertPlan } from "./apply";
import { describeChange, describeFieldChange, isEmptyChange, planChanges } from "./change";
import { ProvisionerSource } from "./dataSource";
import { clientUrl, dataverseSource, isDataverseAvailable } from "./dataverse";
import { demoSource } from "./demoData";
import { runLogCsv } from "./export";
import { ApplyResult, ChannelChange, ChannelRow, SettingChange } from "./model";

const CAPTURE_DESCRIPTIONS: Record<Capture, string> = {
  none: "No transcript and no recording.",
  transcript: "Calls are transcribed; no audio is recorded.",
  transcriptAndRecording: "Calls are transcribed and the audio is recorded."
};

type OptionField = "agentTranscriptionControls" | "agentRecordingControls" | "requestConsent" | "stopOnHold" | "playNotifications" | "showTranscriptByDefault";
const OPTION_FIELDS: OptionField[] = ["agentTranscriptionControls", "agentRecordingControls", "requestConsent", "stopOnHold", "playNotifications", "showTranscriptByDefault"];

interface Filter { search: string; workstream: string; direction: string; state: string; includeInactive: boolean; }
const EMPTY_FILTER: Filter = { search: "", workstream: "all", direction: "all", state: "all", includeInactive: false };

interface RunRecord { results: ApplyResult[]; info: RunInfo; kind: "apply" | "revert"; summary: string[]; }

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const source: ProvisionerSource = live ? dataverseSource : demoSource;
  const environment = live ? (clientUrl()?.replace(/^https:\/\//, "") ?? "this environment") : "the sample environment";

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(live ? "" : "Not running inside Dataverse, so this is the sample environment: changes are simulated in this page only.");
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [change, setChange] = useState<SettingChange>({});
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<ApplyProgress | undefined>(undefined);
  const [run, setRun] = useState<RunRecord | undefined>(undefined);
  const [confirmingRevert, setConfirmingRevert] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const rows = await source.loadChannels();
      setChannels(rows.sort((a, b) => a.workstreamName.localeCompare(b.workstreamName) || a.name.localeCompare(b.name)));
    } catch (error) {
      setMessage(`Couldn't read the voice channels: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  const workstreams = useMemo(() => [...new Set(channels.map((c) => c.workstreamName))].sort((a, b) => a.localeCompare(b)), [channels]);
  const statesPresent = useMemo(() => new Set(channels.map((c) => c.settings.capture)), [channels]);

  const visible = useMemo(() => channels.filter((c) => {
    if (!filter.includeInactive && !c.active) return false;
    if (filter.workstream !== "all" && c.workstreamName !== filter.workstream) return false;
    if (filter.direction !== "all" && c.direction !== filter.direction) return false;
    if (filter.state !== "all" && c.settings.capture !== filter.state) return false;
    const q = filter.search.trim().toLowerCase();
    return !q || [c.name, c.workstreamName, c.phoneNumber ?? ""].some((v) => v.toLowerCase().includes(q));
  }), [channels, filter]);

  const selectedRows = useMemo(() => channels.filter((c) => selected.has(c.id)), [channels, selected]);
  const plan = useMemo(() => planChanges(selectedRows, change), [selectedRows, change]);
  const planById = useMemo(() => new Map(plan.map((p) => [p.channel.id, p])), [plan]);
  const toChange = plan.filter((p) => p.status === "change");
  const unchanged = plan.filter((p) => p.status === "noChange");
  const hiddenSelected = selectedRows.filter((c) => !visible.includes(c)).length;
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  function updateChange(patch: SettingChange) {
    setConfirming(false);
    setChange((current) => {
      const next: SettingChange = { ...current, ...patch };
      (Object.keys(next) as (keyof SettingChange)[]).forEach((k) => { if (next[k] === undefined) delete next[k]; });
      return next;
    });
  }

  function toggle(id: string) {
    setConfirming(false);
    setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleAllVisible() {
    setConfirming(false);
    setSelected((s) => {
      const next = new Set(s);
      if (allVisibleSelected) visible.forEach((c) => next.delete(c.id)); else visible.forEach((c) => next.add(c.id));
      return next;
    });
  }

  async function runChanges(changes: ChannelChange[], kind: RunRecord["kind"], summary: string[]) {
    setConfirming(false);
    setConfirmingRevert(false);
    const startedAt = new Date().toISOString();
    const results = await applyChanges(changes, source, setProgress);
    setProgress(undefined);
    setRun({ results, kind, summary, info: { tool: "Recording & Transcription Provisioner", mode: source.mode, environment, user: source.currentUser(), startedAt, finishedAt: new Date().toISOString() } });
    if (kind === "apply") setSelected(new Set());
    await reload();
  }

  const busy = !!progress;

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">RTP</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Recording &amp; Transcription Provisioner</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{source.mode === "live" ? <>Changes <strong>{environment}</strong></> : "Sample environment — nothing is written"}</span>
        <button className="button secondary" onClick={() => void reload()} disabled={loading || busy}>{loading ? "Loading…" : "Reload channels"}</button>
      </div>
    </header>

    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}

    <div className="write-banner" role="note">
      <span className="write-icon" aria-hidden="true">✎</span>
      <span><strong>This tool changes live voice channels{source.mode === "live" ? ` in ${environment}` : ""}.</strong> It only writes recording and transcription settings, only on the channels you select, and only after you confirm. New settings apply to calls that start after the change. Check your organisation's recording and consent obligations before switching recording on.</span>
    </div>

    {progress && <section className="progress-strip"><div className="progress-bar"><div style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 100}%` }} /></div><span>{progress.done}/{progress.total} — {progress.message}</span></section>}

    {run && !progress && <RunSummary run={run} confirmingRevert={confirmingRevert}
      onRevert={() => setConfirmingRevert(true)} onCancelRevert={() => setConfirmingRevert(false)}
      onConfirmRevert={() => void runChanges(revertPlan(run.results), "revert", ["Previous values restored"])}
      onDismiss={() => { setRun(undefined); setConfirmingRevert(false); }} source={source} />}

    <section className="workspace">
      <aside className="sidebar">
        <div className="section-heading"><div><p className="eyebrow">Filters</p><h2>Voice channels</h2></div><span className="count">{visible.length}/{channels.length}</span></div>
        <label className="search"><span>⌕</span><input placeholder="Search channel, workstream or number" value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} /></label>
        <div className="filter-group">
          <span className="filter-label">Workstream</span>
          <select value={filter.workstream} onChange={(e) => setFilter((f) => ({ ...f, workstream: e.target.value }))}>
            <option value="all">All workstreams</option>
            {workstreams.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">Direction</span>
          <select value={filter.direction} onChange={(e) => setFilter((f) => ({ ...f, direction: e.target.value }))}>
            <option value="all">All</option><option value="Inbound">Inbound</option><option value="Outbound">Outbound</option><option value="Other">Other (direct, proactive)</option>
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">Transcript and recording now</span>
          <select value={filter.state} onChange={(e) => setFilter((f) => ({ ...f, state: e.target.value }))}>
            <option value="all">Any</option>
            {(Object.keys(CAPTURE_LABELS) as ReadCapture[]).filter((s) => s !== "recordingOnly" || statesPresent.has(s)).map((s) => <option key={s} value={s}>{CAPTURE_LABELS[s]}</option>)}
          </select>
        </div>
        <label className="checkbox-row"><input type="checkbox" checked={filter.includeInactive} onChange={(e) => setFilter((f) => ({ ...f, includeInactive: e.target.checked }))} /> Show deactivated channels</label>
        <button className="button ghost small" onClick={() => setFilter(EMPTY_FILTER)}>Clear filters</button>
        <div className="sidebar-footer"><span className="shield">◇</span><span>Writes only the recording and transcription columns of the voice channels you select. Never creates or deletes anything.</span></div>
      </aside>

      <section className="content">
        <div className="selection-bar">
          <label className="checkbox-row"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={!visible.length || busy} /> Select all {visible.length} shown</label>
          <span>{selected.size} selected{hiddenSelected ? ` (${hiddenSelected} hidden by filters)` : ""}</span>
          {selected.size > 0 && <button className="button ghost small" onClick={() => { setSelected(new Set()); setConfirming(false); }}>Clear selection</button>}
        </div>
        <div className="data-table channel-table" role="table" aria-label="Voice channels">
          <div className="data-head" role="row"><span /><span>Channel</span><span>Workstream</span><span>Now</span><span>After this change</span></div>
          {visible.length ? visible.map((c) => {
            const p = planById.get(c.id);
            return <label role="row" key={c.id} className={`data-row ${selected.has(c.id) ? "selected" : ""}`}>
              <span><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} disabled={busy} /></span>
              <span className="cell-strong">{c.name}<small>{c.phoneNumber ?? "no number"}{c.active ? "" : " · deactivated"}</small></span>
              <span className="cell-muted">{c.workstreamName}<small>{c.direction}</small></span>
              <span className={c.settings.capture === "recordingOnly" ? "irregular" : ""} title={c.settings.capture === "recordingOnly" ? "Not one of the three options (None, Transcript, Transcript and Recording). Applying any option replaces it." : undefined}>{describeCapture(c.settings)}{c.settings.capture === "recordingOnly" && <small>not one of the options</small>}</span>
              <span>{p ? <PreviewCell change={p} /> : <span className="cell-muted">—</span>}</span>
            </label>;
          }) : <div className="scenario-empty"><span>◔</span><p>{loading ? "Loading voice channels…" : "No voice channels match these filters"}</p></div>}
        </div>
      </section>

      <aside className="inspector">
        <p className="eyebrow">Setting to apply</p>
        <h2>Set on {selected.size} channel{selected.size === 1 ? "" : "s"}</h2>

        <p className="detail-label">Transcript and recording</p>
        <div className="preset-list" role="radiogroup" aria-label="Transcript and recording">
          <label className={`preset ${change.capture === undefined ? "active" : ""}`}>
            <input type="radio" name="capture" checked={change.capture === undefined} onChange={() => updateChange({ capture: undefined })} />
            <span><strong>Leave unchanged</strong><small>Keep each channel's current option.</small></span>
          </label>
          {CAPTURE_OPTIONS.map((c) => <label key={c} className={`preset ${change.capture === c ? "active" : ""}`}>
            <input type="radio" name="capture" checked={change.capture === c} onChange={() => updateChange({ capture: c })} />
            <span><strong>{CAPTURE_LABELS[c]}</strong><small>{CAPTURE_DESCRIPTIONS[c]}</small></span>
          </label>)}
        </div>

        <div className="filter-group start-group">
          <span className="filter-label">Start</span>
          <select value={change.start ?? ""} onChange={(e) => updateChange({ start: (e.target.value || undefined) as StartMode | undefined })}>
            <option value="">Leave unchanged</option>
            {START_MODES.map((m) => <option key={m} value={m}>{START_LABELS[m]}{m === "automatic" ? " — when the call connects" : " — the agent starts it"}</option>)}
          </select>
          <small className="muted">Only used for channels with a transcript.</small>
        </div>

        <details className="more-options" open={OPTION_FIELDS.some((f) => change[f] !== undefined)}>
          <summary>More options</summary>
          {OPTION_FIELDS.map((field) => <div className="filter-group" key={field}>
            <span className="filter-label">{RECORDING_FIELD_LABELS[field]}</span>
            <select value={change[field] === undefined ? "" : change[field] ? "yes" : "no"} onChange={(e) => updateChange({ [field]: e.target.value === "" ? undefined : e.target.value === "yes" })}>
              <option value="">Leave unchanged</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </div>)}
        </details>

        <div className="preview">
          <p className="detail-label">Preview</p>
          {!selected.size ? <p className="muted">Select channels in the list to see what would change.</p> : isEmptyChange(change) ? <p className="muted">Choose what to set.</p> : <>
            <ul className="preview-counts">
              <li><strong>{toChange.length}</strong> will change</li>
              <li><strong>{unchanged.length}</strong> already set this way</li>
            </ul>
            <p className="muted">Sets: {describeChange(change).join("; ")}.</p>
          </>}
        </div>

        {!confirming
          ? <button className="button primary full" disabled={!toChange.length || busy} onClick={() => setConfirming(true)}>Apply to {toChange.length} channel{toChange.length === 1 ? "" : "s"}</button>
          : <div className="confirm-box">
            <p><strong>Change {toChange.length} voice channel{toChange.length === 1 ? "" : "s"} in {environment}?</strong> {describeChange(change).join("; ")}. Calls that start after this use the new setting. You can revert this change afterwards, and download a log of it.</p>
            <div><button className="button ghost" onClick={() => setConfirming(false)}>Cancel</button><button className="button danger" onClick={() => void runChanges(toChange, "apply", describeChange(change))}>Yes, apply</button></div>
          </div>}
      </aside>
    </section>
  </main>;
}

function PreviewCell({ change }: { change: ChannelChange }): React.ReactElement {
  if (change.status === "noChange") return <span className="cell-muted">No change</span>;
  return <span className="preview-change">{describeCapture(change.after)}<small>{change.changedFields.map((f) => describeFieldChange(change, f)).join("; ")}</small></span>;
}

function RunSummary({ run, confirmingRevert, onRevert, onCancelRevert, onConfirmRevert, onDismiss, source }: {
  run: RunRecord; confirmingRevert: boolean; source: ProvisionerSource;
  onRevert: () => void; onCancelRevert: () => void; onConfirmRevert: () => void; onDismiss: () => void;
}): React.ReactElement {
  const updated = run.results.filter((r) => r.status === "updated").length;
  const notVerified = run.results.filter((r) => r.status === "notVerified");
  const failed = run.results.filter((r) => r.status === "failed");
  const revertable = run.kind === "apply" && updated + notVerified.length > 0;
  const action = run.kind === "apply" ? "Apply" : "Revert";
  return <section className={`run-summary ${failed.length ? "has-failures" : ""}`}>
    <div className="run-head">
      <div>
        <p className="eyebrow">{run.kind === "apply" ? "Change applied" : "Change reverted"} · {new Date(run.info.finishedAt).toLocaleString()} · {run.info.user}</p>
        <h2>{updated} channel{updated === 1 ? "" : "s"} updated{notVerified.length ? `, ${notVerified.length} not confirmed` : ""}{failed.length ? `, ${failed.length} failed` : ""}</h2>
        <p className="muted">{run.summary.join("; ")}.</p>
      </div>
      <div className="run-actions">
        <button className="button secondary" onClick={() => downloadCsv(logFileName(`recording-${run.kind}`, run.info), runLogCsv(run.results, run.info, action))}>⇩ Download log</button>
        {revertable && !confirmingRevert && <button className="button ghost" onClick={onRevert}>Revert this change</button>}
        <button className="icon-button" aria-label="Dismiss" onClick={onDismiss}>×</button>
      </div>
    </div>
    {confirmingRevert && <div className="confirm-box">
      <p><strong>Put back the previous settings on {updated + notVerified.length} channel{updated + notVerified.length === 1 ? "" : "s"}?</strong> Only the options this change set are restored.</p>
      <div><button className="button ghost" onClick={onCancelRevert}>Cancel</button><button className="button danger" onClick={onConfirmRevert}>Yes, revert</button></div>
    </div>}
    {[...failed, ...notVerified].length > 0 && <ul className="failure-list">{[...failed, ...notVerified].map((r) => {
      const url = source.recordUrl(r.change.channel.id);
      return <li key={r.change.channel.id} className={r.status}>
        <strong>{url ? <a href={url} target="_blank" rel="noreferrer">{r.change.channel.name}</a> : r.change.channel.name}</strong>
        <span>{r.status === "failed" ? "Not changed: " : ""}{r.error}</span>
      </li>;
    })}</ul>}
  </section>;
}
