// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { downloadCsv, parseCsv } from "../../voice-workstream-builder/src/csv";
import { BuilderSource } from "../../voice-workstream-builder/src/dataSource";
import { clientUrl, dataverseSource, isDataverseAvailable } from "../../voice-workstream-builder/src/dataverse";
import { demoSource } from "../../voice-workstream-builder/src/demoData";
import { issuesToCsv, runLogCsv } from "../../voice-workstream-builder/src/export";
import { Catalog, Issue, ResolvedChannel, ResolvedPlan, ResolvedWorkstream, WorkstreamResult, errorCount } from "../../voice-workstream-builder/src/model";
import { describeCapture } from "../../voice-workstream-builder/src/recordingSettings";
import { RunInfo, logFileName } from "../../voice-workstream-builder/src/runLog";
import { addChannels, existingChannelCount, resolveChannelPlan, validateChannels } from "./plan";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyTemplateCsv, exampleCsv } from "./template";

// Writes go through Voice Workstream Builder's data layer (dataverse.ts), whose create allowlist and
// write-scope test cover everything this tool creates. This file and plan.ts never write themselves.

type Step = "upload" | "review" | "create";
const STEPS: Step[] = ["upload", "review", "create"];
const OUTCOME_LABELS: Record<WorkstreamResult["outcome"], string> = { created: "Channels added", partial: "Partly added", failed: "Not added" };

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const source: BuilderSource = live ? dataverseSource : demoSource;
  const environment = live ? (clientUrl()?.replace(/^https:\/\//, "") ?? "this environment") : "the sample environment";

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<ResolvedPlan | undefined>(undefined);
  const [catalog, setCatalog] = useState<Catalog | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(live ? "" : "Not running inside Dataverse, so this is the sample environment: creating only simulates the channels. Try it with the example CSV.");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; message: string } | undefined>(undefined);
  const [results, setResults] = useState<WorkstreamResult[] | undefined>(undefined);
  const [run, setRun] = useState<RunInfo | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadFile(file: File) {
    setBusy(true);
    setMessage("");
    setConfirming(false);
    try {
      const parsed = validateChannels(parseCsv(await file.text()));
      const read = await source.loadCatalog();
      setCatalog(read);
      setPlan(resolveChannelPlan(parsed, read));
      setFileName(file.name);
      setStep("review");
    } catch (error) {
      setMessage(`Couldn't read the environment to check the file: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function create() {
    if (!plan) return;
    setConfirming(false);
    setStep("create");
    setResults(undefined);
    const startedAt = new Date().toISOString();
    try {
      const outcome = await addChannels(plan, source, setProgress);
      setRun({ tool: "Voice Channel Builder", mode: source.mode, environment, user: source.currentUser(), startedAt, finishedAt: new Date().toISOString(), source: fileName });
      setResults(outcome);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setStep("review");
    }
    setProgress(undefined);
  }

  function startOver() {
    setStep("upload");
    setPlan(undefined);
    setResults(undefined);
    setRun(undefined);
    setFileName("");
    setConfirming(false);
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">VC</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Voice Channel Builder</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{source.mode === "live" ? <>Creates in <strong>{environment}</strong></> : "Sample environment — nothing is written"}</span>
      </div>
    </header>

    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}

    <div className="write-banner" role="note">
      <span className="write-icon" aria-hidden="true">✎</span>
      <span><strong>This tool creates records{source.mode === "live" ? ` in ${environment}` : ""}.</strong> Nothing is written until you've reviewed the plan and confirmed. It only adds new voice channels to existing workstreams: it never creates workstreams, and never changes or deletes existing channels.</span>
    </div>

    <ol className="stepper">
      {STEPS.map((s, i) => <li key={s} className={s === step ? "active" : (STEPS.indexOf(step) > i ? "done" : "")}>
        <span className="step-number">{i + 1}</span>{s === "upload" ? "Upload CSV" : s === "review" ? "Review plan" : "Create"}
      </li>)}
    </ol>

    {step === "upload" && <UploadStep busy={busy} fileInput={fileInput} onFile={loadFile} />}
    {step === "review" && plan && <ReviewStep plan={plan} catalog={catalog} fileName={fileName} environment={environment} confirming={confirming} live={source.mode === "live"}
      onReplace={() => fileInput.current?.click()} onBack={startOver} onCreate={() => setConfirming(true)} onCancel={() => setConfirming(false)} onConfirm={create} />}
    <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }} />
    {step === "create" && <CreateStep progress={progress} results={results} run={run} issues={plan?.issues ?? []} source={source} environment={environment} onStartOver={startOver} />}
  </main>;
}

function UploadStep({ busy, fileInput, onFile }: { busy: boolean; fileInput: React.RefObject<HTMLInputElement>; onFile: (f: File) => void }): React.ReactElement {
  const [dragging, setDragging] = useState(false);
  return <section className="panel-grid">
    <div className="panel">
      <p className="eyebrow">Step 1</p>
      <h2>Upload the voice channels to add</h2>
      <p className="muted">One row per new voice channel, with the <code>workstream_name</code> of an existing inbound voice workstream. Leave <code>phone_number</code> empty to create the channel without a number and assign one later. Empty cells take the default shown in the column reference.</p>
      <div className="template-actions">
        <button className="button secondary" onClick={() => downloadCsv(EXAMPLE_FILE_NAME, exampleCsv())}>⇩ Download example CSV</button>
        <button className="button ghost" onClick={() => downloadCsv("voice-channels.csv", emptyTemplateCsv())}>Empty template (headers only)</button>
      </div>
      <p className="muted">The example adds 3 channels to 2 workstreams: one with a phone number and two without. Replace its names with ones from your environment, or upload it as-is to see how the checks work. The channel columns are the same as in Voice Workstream Builder.</p>
      <div className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}>
        <span className="dropzone-icon">⇪</span>
        <p><strong>Drop a CSV file here</strong> or</p>
        <button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? "Checking…" : "Choose file"}</button>
        <small>Comma, semicolon or tab separated, as saved by Excel. The file is read in your browser and checked against the environment before anything is created.</small>
      </div>
    </div>
    <div className="panel">
      <p className="eyebrow">Reference</p>
      <h2>Columns</h2>
      <div className="column-reference"><ul>{COLUMNS.map((c) => <li key={c.header}>
        <code>{c.header}</code>{c.required && <span className="required">required</span>}
        <p>{c.description}{c.defaultValue ? <> Empty: <em>{c.defaultValue}</em>.</> : null}{c.choices && c.choices.length > 1 && !(c.choices.length === 2 && c.choices[0] === "Yes") ? <> Values: {c.choices.join(", ")}.</> : null}</p>
      </li>)}</ul></div>
    </div>
  </section>;
}

function IssueList({ issues }: { issues: Issue[] }): React.ReactElement {
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? (a.line ?? 0) - (b.line ?? 0) : a.severity === "error" ? -1 : 1));
  return <ul className="issue-list">{sorted.map((issue, i) => <li key={i} className={issue.severity}>
    <span className={`severity-pill ${issue.severity}`}>{issue.severity === "error" ? "Error" : "Warning"}</span>
    <span className="issue-where">{issue.line ? `Line ${issue.line}` : "File"}{issue.column ? ` · ${issue.column}` : ""}</span>
    <span className="issue-message">{issue.message}</span>
  </li>)}</ul>;
}

function ReviewStep(props: {
  plan: ResolvedPlan; catalog?: Catalog; fileName: string; environment: string; confirming: boolean; live: boolean;
  onReplace: () => void; onBack: () => void; onCreate: () => void; onCancel: () => void; onConfirm: () => void;
}): React.ReactElement {
  const { plan } = props;
  const errors = errorCount(plan.issues);
  const warnings = plan.issues.length - errors;
  const channels = plan.workstreams.reduce((n, w) => n + w.channels.length, 0);
  const withoutNumber = plan.workstreams.reduce((n, w) => n + w.channels.filter((c) => !c.phoneNumber).length, 0);
  const missing = plan.workstreams.filter((w) => !w.existingId).length;
  const canCreate = errors === 0 && channels > 0 && missing === 0;

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Checked <strong>{props.fileName}</strong> ({plan.rowCount} row{plan.rowCount === 1 ? "" : "s"}) against <strong>{props.environment}</strong>. Nothing has been created yet.</p>
      <div className="summary-tiles">
        <div className="stat-tile"><span className="eyebrow">Channels</span><strong>{channels}</strong><span>{withoutNumber ? `${withoutNumber} without a number` : "all with a number"}</span></div>
        <div className="stat-tile"><span className="eyebrow">Workstreams</span><strong>{plan.workstreams.length}</strong><span>{missing ? `${missing} can't be used` : "all found"}</span></div>
        <div className={`stat-tile ${errors ? "bad" : "good"}`}><span className="eyebrow">Errors</span><strong>{errors}</strong><span>{errors ? "fix these first" : "none"}</span></div>
        <div className={`stat-tile ${warnings ? "warn" : ""}`}><span className="eyebrow">Warnings</span><strong>{warnings}</strong><span>check, won't block</span></div>
        <div />
        <div className="summary-actions">
          <button className="button ghost" onClick={props.onBack}>Start over</button>
          <button className="button secondary" onClick={props.onReplace}>Upload corrected file</button>
          <button className="button primary" disabled={!canCreate || props.confirming} onClick={props.onCreate}>Add {channels} channel{channels === 1 ? "" : "s"}</button>
        </div>
      </div>
      {props.confirming && <div className="confirm-box" role="alertdialog" aria-label="Confirm creation">
        <p><strong>Add {channels} voice channel{channels === 1 ? "" : "s"} to {plan.workstreams.length} workstream{plan.workstreams.length === 1 ? "" : "s"} in {props.environment}?</strong> {props.live ? "This tool can't undo it: channels have to be removed in the admin center." : "In the sample environment this is simulated."} A log of everything created is available afterwards.</p>
        <div><button className="button ghost" onClick={props.onCancel}>Cancel</button><button className="button danger" onClick={props.onConfirm}>Yes, add them</button></div>
      </div>}
    </section>

    <section className="review-grid">
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Plan</p><h2>What will be created</h2></div></div>
        {channels ? <div className="data-table channel-table" role="table">
          <div className="data-head" role="row"><span>Workstream</span><span>New channel</span><span>Phone number</span><span>Language · voice</span><span>Behaviors</span></div>
          {plan.workstreams.flatMap((ws) => ws.channels.map((ch) => <ChannelRow key={`${ws.key}|${ch.line}`} ws={ws} ch={ch} existing={props.catalog ? existingChannelCount(props.catalog, ws.name) : undefined}
            hasErrors={plan.issues.some((i) => i.severity === "error" && i.line === ch.line)} />))}
        </div> : <div className="scenario-empty"><span>◔</span><p>No channels in this file</p></div>}
      </div>
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Checks</p><h2>Problems found</h2></div>{plan.issues.length > 0 && <button className="button ghost small" onClick={() => downloadCsv("voice-channels-issues.csv", issuesToCsv(plan.issues))}>Download</button>}</div>
        {plan.issues.length ? <IssueList issues={plan.issues} /> : <div className="scenario-empty"><span>✓</span><p>No problems found</p><small>Every name in the file matches a record in the environment.</small></div>}
      </div>
    </section>
  </>;
}

function ChannelRow({ ws, ch, existing, hasErrors }: { ws: ResolvedWorkstream; ch: ResolvedChannel; existing?: number; hasErrors: boolean }): React.ReactElement {
  return <div className={`data-row ${hasErrors ? "row-error" : ""}`} role="row">
    <span className="cell-strong">{ws.name}<small>{existing === undefined ? "" : `Has ${existing} channel${existing === 1 ? "" : "s"} now`}</small></span>
    <span>{ch.name}<small>Line {ch.line}{ch.operatingHours ? ` · ${ch.operatingHours}` : ""}</small></span>
    <span>{ch.phoneNumber ?? "No number yet"}<small>{ch.phoneNumber ? "" : "Assign one later"}</small></span>
    <span>{ch.language}<small>{ch.ttsVoice ?? "No voice"}</small></span>
    <span>{describeCapture(ch.recording)}{ch.recording.requestConsent ? <small>Asks for consent</small> : null}</span>
  </div>;
}

function CreateStep({ progress, results, run, issues, source, environment, onStartOver }: {
  progress?: { done: number; total: number; message: string }; results?: WorkstreamResult[]; run?: RunInfo; issues: Issue[]; source: BuilderSource; environment: string; onStartOver: () => void;
}): React.ReactElement {
  const summary = useMemo(() => results && ({
    channels: results.reduce((n, r) => n + r.steps.filter((s) => s.table === "channel" && s.status === "created").length, 0),
    partial: results.filter((r) => r.outcome === "partial").length,
    failed: results.filter((r) => r.outcome === "failed").length
  }), [results]);

  if (!results) {
    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return <section className="panel progress-panel">
      <p className="eyebrow">Creating</p>
      <h2>Adding channels in {environment}…</h2>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="muted">{progress ? `${progress.done} of ${progress.total} — ${progress.message}` : "Starting…"}</p>
      <p className="muted">Keep this page open until it's finished.</p>
    </section>;
  }

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Finished in <strong>{environment}</strong>.</p>
      <div className="summary-tiles">
        <div className="stat-tile good"><span className="eyebrow">Added</span><strong>{summary!.channels}</strong><span>channels</span></div>
        <div className={`stat-tile ${summary!.partial ? "warn" : ""}`}><span className="eyebrow">Partly added</span><strong>{summary!.partial}</strong><span>workstreams to check</span></div>
        <div className={`stat-tile ${summary!.failed ? "bad" : ""}`}><span className="eyebrow">Not added</span><strong>{summary!.failed}</strong><span>workstreams</span></div>
        <div />
        <div />
        <div className="summary-actions">
          {run && <button className="button secondary" onClick={() => downloadCsv(logFileName("voice-channels", run), runLogCsv(results, issues, run))}>⇩ Download log</button>}
          <button className="button primary" onClick={onStartOver}>Upload another file</button>
        </div>
      </div>
    </section>
    <section className="panel results-panel">
      {results.map((r) => <article key={r.name} className={`result-card ${r.outcome}`}>
        <header><h3>{r.name}</h3><span className={`outcome-pill ${r.outcome}`}>{OUTCOME_LABELS[r.outcome]}</span></header>
        <ul className="step-list">{r.steps.map((s, i) => {
          const url = s.id ? source.recordUrl(s.table, s.id) : undefined;
          return <li key={i} className={s.status}>
            <span className={`step-status ${s.status}`}>{s.status === "created" ? "✓" : s.status === "failed" ? "✕" : "–"}</span>
            <span className="step-label">{s.label}</span>
            <span className="step-name">{url ? <a href={url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}{s.error && <small className="step-error">{s.error}</small>}</span>
          </li>;
        })}</ul>
        {r.notes.length > 0 && <ul className="note-list">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </article>)}
    </section>
  </>;
}
