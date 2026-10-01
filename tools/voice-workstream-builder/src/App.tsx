import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { downloadCsv, parseCsv } from "./csv";
import { BuilderSource } from "./dataSource";
import { clientUrl, dataverseSource, isDataverseAvailable } from "./dataverse";
import { demoSource } from "./demoData";
import { executePlan } from "./execute";
import { issuesToCsv, runLogCsv } from "./export";
import { Issue, ResolvedPlan, ResolvedWorkstream, WorkstreamResult, errorCount, recordCount } from "./model";
import { describeCapture } from "./recordingSettings";
import { resolvePlan } from "./resolve";
import { RunInfo, logFileName } from "./runLog";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyTemplateCsv, templateCsv } from "./template";
import { validateCsv } from "./validate";

type Step = "upload" | "review" | "create";

const OUTCOME_LABELS: Record<WorkstreamResult["outcome"], string> = { created: "Created", partial: "Partly created", failed: "Not created" };

function environmentLabel(source: BuilderSource): string {
  return source.mode === "live" ? (clientUrl()?.replace(/^https:\/\//, "") ?? "this environment") : "the sample environment";
}

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const source: BuilderSource = live ? dataverseSource : demoSource;
  const environment = environmentLabel(source);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<ResolvedPlan | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(live ? "" : "Not running inside Dataverse, so this is the sample environment: creating only simulates the records. Try it with the example CSV.");
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
      const text = await file.text();
      const parsed = validateCsv(parseCsv(text));
      const catalog = await source.loadCatalog();
      setPlan(resolvePlan(parsed, catalog));
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
    const outcome = await executePlan(plan, source, setProgress);
    setRun({ tool: "Voice Workstream Builder", mode: source.mode, environment, user: source.currentUser(), startedAt, finishedAt: new Date().toISOString(), source: fileName });
    setResults(outcome);
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
      <div className="brand-mark">VWB</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Voice Workstream Builder</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{source.mode === "live" ? <>Creates in <strong>{environment}</strong></> : "Sample environment — nothing is written"}</span>
      </div>
    </header>

    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}

    <div className="write-banner" role="note">
      <span className="write-icon" aria-hidden="true">✎</span>
      <span><strong>This tool creates records{source.mode === "live" ? ` in ${environment}` : ""}.</strong> Nothing is written until you've reviewed the plan and confirmed. It only ever creates new workstreams and channels: it never changes or deletes existing configuration.</span>
    </div>

    <ol className="stepper">
      {(["upload", "review", "create"] as Step[]).map((s, i) => <li key={s} className={s === step ? "active" : (["upload", "review", "create"].indexOf(step) > i ? "done" : "")}>
        <span className="step-number">{i + 1}</span>{s === "upload" ? "Upload CSV" : s === "review" ? "Review plan" : "Create"}
      </li>)}
    </ol>

    {step === "upload" && <UploadStep busy={busy} fileInput={fileInput} onFile={loadFile} />}

    {step === "review" && plan && <ReviewStep
      plan={plan} fileName={fileName} environment={environment} confirming={confirming} live={source.mode === "live"}
      onReplace={() => fileInput.current?.click()} onBack={startOver}
      onCreate={() => setConfirming(true)} onCancel={() => setConfirming(false)} onConfirm={create}
    />}
    <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }} />

    {step === "create" && <CreateStep progress={progress} results={results} run={run} issues={plan?.issues ?? []} source={source} environment={environment} onStartOver={startOver} />}
  </main>;
}

function UploadStep({ busy, fileInput, onFile }: { busy: boolean; fileInput: React.RefObject<HTMLInputElement>; onFile: (f: File) => void }): React.ReactElement {
  const [dragging, setDragging] = useState(false);
  return <section className="panel-grid">
    <div className="panel">
      <p className="eyebrow">Step 1</p>
      <h2>Upload the workstreams and voice channels to create</h2>
      <p className="muted">One row per voice channel. Rows with the same <code>workstream_name</code> make up one workstream, so a workstream with three channels is three rows. Fill in the workstream columns on its first row; later rows can leave them blank. Leave <code>phone_number</code> blank to create a channel now and assign its number later.</p>
      <div className="template-actions">
        <button className="button secondary" onClick={() => downloadCsv(EXAMPLE_FILE_NAME, templateCsv())}>⇩ Download example CSV</button>
        <button className="button ghost" onClick={() => downloadCsv("voice-workstreams.csv", emptyTemplateCsv())}>Empty template (headers only)</button>
      </div>
      <p className="muted">The example creates 5 workstreams with 6 voice channels: several channels on one workstream, channels without a phone number, each transcript/recording option, an outbound workstream, and one workstream without a channel. Replace its names with ones from your environment, or upload it as-is to see how the checks work.</p>
      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      >
        <span className="dropzone-icon">⇪</span>
        <p><strong>Drop a CSV file here</strong> or</p>
        <button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? "Checking…" : "Choose file"}</button>
        <small>Comma, semicolon or tab separated, as saved by Excel. The file is read in your browser and checked against the environment before anything is created.</small>
      </div>
    </div>
    <div className="panel">
      <p className="eyebrow">Reference</p>
      <h2>Columns</h2>
      <div className="column-reference">
        {(["workstream", "channel"] as const).map((level) => <details key={level} open={level === "workstream"}>
          <summary>{level === "workstream" ? "Workstream columns" : "Voice channel columns"}</summary>
          <ul>{COLUMNS.filter((c) => c.level === level).map((c) => <li key={c.header}>
            <code>{c.header}</code>{c.required && <span className="required">{level === "channel" ? "required for a channel" : "required"}</span>}
            <p>{c.description}{c.defaultValue ? <> Default: <em>{c.defaultValue}</em>.</> : null}{c.choices && c.kind !== "yesno" ? <> Values: {c.choices.join(", ")}.</> : null}</p>
          </li>)}</ul>
        </details>)}
      </div>
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
  plan: ResolvedPlan; fileName: string; environment: string; confirming: boolean; live: boolean;
  onReplace: () => void; onBack: () => void; onCreate: () => void; onCancel: () => void; onConfirm: () => void;
}): React.ReactElement {
  const { plan } = props;
  const counts = recordCount(plan);
  const errors = errorCount(plan.issues);
  const warnings = plan.issues.length - errors;
  const withoutNumber = plan.workstreams.reduce((n, ws) => n + ws.channels.filter((c) => !c.phoneNumber).length, 0);
  const canCreate = errors === 0 && plan.workstreams.length > 0;

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Checked <strong>{props.fileName}</strong> ({plan.rowCount} row{plan.rowCount === 1 ? "" : "s"}) against <strong>{props.environment}</strong>. Nothing has been created yet.</p>
      <div className="summary-tiles">
        <div className="stat-tile"><span className="eyebrow">Workstreams</span><strong>{counts.workstreams}</strong></div>
        <div className="stat-tile"><span className="eyebrow">Voice channels</span><strong>{counts.channels}</strong><span>{withoutNumber} without a number</span></div>
        <div className="stat-tile"><span className="eyebrow">Records</span><strong>{counts.records}</strong><span>to create in total</span></div>
        <div className={`stat-tile ${errors ? "bad" : "good"}`}><span className="eyebrow">Errors</span><strong>{errors}</strong><span>{errors ? "fix these first" : "none"}</span></div>
        <div className={`stat-tile ${warnings ? "warn" : ""}`}><span className="eyebrow">Warnings</span><strong>{warnings}</strong><span>check, won't block</span></div>
        <div className="summary-actions">
          <button className="button ghost" onClick={props.onBack}>Start over</button>
          <button className="button secondary" onClick={props.onReplace}>Upload corrected file</button>
          <button className="button primary" disabled={!canCreate || props.confirming} onClick={props.onCreate}>Create {counts.workstreams} workstream{counts.workstreams === 1 ? "" : "s"}</button>
        </div>
      </div>
      {props.confirming && <div className="confirm-box" role="alertdialog" aria-label="Confirm creation">
        <p><strong>Create {counts.records} records in {props.environment}?</strong> {counts.workstreams} workstream{counts.workstreams === 1 ? "" : "s"} and {counts.channels} voice channel{counts.channels === 1 ? "" : "s"}{withoutNumber ? `, ${withoutNumber} of them without a phone number` : ""}. {props.live ? "This tool can't undo it: records have to be removed in the admin center." : "In the sample environment this is simulated."} A log of every record created is available afterwards.</p>
        <div><button className="button ghost" onClick={props.onCancel}>Cancel</button><button className="button danger" onClick={props.onConfirm}>Yes, create them</button></div>
      </div>}
    </section>

    <section className="review-grid">
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Plan</p><h2>What will be created</h2></div></div>
        {plan.workstreams.length ? plan.workstreams.map((ws) => <WorkstreamCard key={ws.key} ws={ws} issues={plan.issues.filter((i) => i.workstream === ws.name)} />) : <div className="scenario-empty"><span>◔</span><p>No workstreams in this file</p></div>}
      </div>
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Checks</p><h2>Problems found</h2></div>{plan.issues.length > 0 && <button className="button ghost small" onClick={() => downloadCsv("voice-workstreams-issues.csv", issuesToCsv(plan.issues))}>Download</button>}</div>
        {plan.issues.length ? <IssueList issues={plan.issues} /> : <div className="scenario-empty"><span>✓</span><p>No problems found</p><small>Every name in the file matches a record in the environment.</small></div>}
      </div>
    </section>
  </>;
}

function WorkstreamCard({ ws, issues }: { ws: ResolvedWorkstream; issues: Issue[] }): React.ReactElement {
  const errors = errorCount(issues);
  const facts = [
    ws.direction,
    ws.workDistribution,
    ws.capacityFormat === "Profile" ? `Capacity profile: ${ws.refs.capacityProfile?.name ?? ws.capacityProfile ?? "default"}` : `${ws.capacityUnits} capacity units`,
    ws.defaultQueue ? `Fallback queue: ${ws.defaultQueue}` : undefined,
    ws.direction === "Outbound" && ws.outboundQueue ? `Outbound queue: ${ws.outboundQueue}` : undefined,
    `Presence: ${ws.presences.join(", ")}`
  ].filter(Boolean);
  return <article className={`ws-card ${errors ? "has-errors" : ""}`}>
    <header>
      <div><h3>{ws.name}</h3><p className="ws-facts">{facts.join(" · ")}</p></div>
      <span className="line-ref">{ws.lines.length > 1 ? `Lines ${ws.lines[0]}–${ws.lines[ws.lines.length - 1]}` : `Line ${ws.lines[0]}`}</span>
    </header>
    {errors > 0 && <p className="ws-error">{errors} error{errors === 1 ? "" : "s"} to fix. See Problems found.</p>}
    {ws.channels.length ? <div className="data-table channel-table" role="table">
      <div className="data-head" role="row"><span>Channel</span><span>Phone number</span><span>Language · voice</span><span>Transcription / recording</span></div>
      {ws.channels.map((ch) => <div className="data-row" role="row" key={ch.line}>
        <span className="cell-strong">{ch.name}<small>Line {ch.line}{ch.operatingHours ? ` · ${ch.operatingHours}` : ""}</small></span>
        <span>{ch.phoneNumber ?? <span className="pill later">No number yet</span>}</span>
        <span>{ch.language}<small>{ch.ttsVoice ?? "no voice"}</small></span>
        <span>{describeCapture(ch.recording)}</span>
      </div>)}
    </div> : <p className="muted">No voice channel. The workstream is created on its own.</p>}
  </article>;
}

function CreateStep({ progress, results, run, issues, source, environment, onStartOver }: {
  progress?: { done: number; total: number; message: string }; results?: WorkstreamResult[]; run?: RunInfo; issues: Issue[]; source: BuilderSource; environment: string; onStartOver: () => void;
}): React.ReactElement {
  const summary = useMemo(() => results && ({
    created: results.filter((r) => r.outcome === "created").length,
    partial: results.filter((r) => r.outcome === "partial").length,
    failed: results.filter((r) => r.outcome === "failed").length
  }), [results]);

  if (!results) {
    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return <section className="panel progress-panel">
      <p className="eyebrow">Creating</p>
      <h2>Creating records in {environment}…</h2>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="muted">{progress ? `${progress.done} of ${progress.total} — ${progress.message}` : "Starting…"}</p>
      <p className="muted">Keep this page open until it's finished.</p>
    </section>;
  }

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Finished in <strong>{environment}</strong>.</p>
      <div className="summary-tiles">
        <div className="stat-tile good"><span className="eyebrow">Created</span><strong>{summary!.created}</strong><span>workstreams</span></div>
        <div className={`stat-tile ${summary!.partial ? "warn" : ""}`}><span className="eyebrow">Partly created</span><strong>{summary!.partial}</strong><span>need attention</span></div>
        <div className={`stat-tile ${summary!.failed ? "bad" : ""}`}><span className="eyebrow">Not created</span><strong>{summary!.failed}</strong></div>
        <div />
        <div />
        <div className="summary-actions">
          {run && <button className="button secondary" onClick={() => downloadCsv(logFileName("voice-workstreams", run), runLogCsv(results, issues, run))}>⇩ Download log</button>}
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
