import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { downloadCsv, parseCsv } from "../../voice-workstream-builder/src/csv";
import { RunInfo, logFileName } from "../../voice-workstream-builder/src/runLog";
import { QueueSource } from "./dataSource";
import { clientUrl, dataverseSource, isDataverseAvailable } from "./dataverse";
import { demoSource } from "./demoData";
import { executePlan } from "./execute";
import { issuesToCsv, runLogCsv } from "./export";
import { Issue, QueueResult, ResolvedPlan, ResolvedQueue, errorCount } from "./model";
import { resolvePlan } from "./resolve";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyTemplateCsv, exampleCsv } from "./template";
import { validateCsv } from "./validate";

type Step = "upload" | "review" | "create";
const STEPS: Step[] = ["upload", "review", "create"];
const OUTCOME_LABELS: Record<QueueResult["outcome"], string> = { created: "Created", partial: "Partly created", failed: "Not created" };

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const source: QueueSource = live ? dataverseSource : demoSource;
  const environment = live ? (clientUrl()?.replace(/^https:\/\//, "") ?? "this environment") : "the sample environment";

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<ResolvedPlan | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(live ? "" : "Not running inside Dataverse, so this is the sample environment: creating only simulates the queues. Try it with the example CSV.");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; message: string } | undefined>(undefined);
  const [results, setResults] = useState<QueueResult[] | undefined>(undefined);
  const [run, setRun] = useState<RunInfo | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadFile(file: File) {
    setBusy(true);
    setMessage("");
    setConfirming(false);
    try {
      const parsed = validateCsv(parseCsv(await file.text()));
      setPlan(resolvePlan(parsed, await source.loadCatalog()));
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
    setRun({ tool: "Queue Builder", mode: source.mode, environment, user: source.currentUser(), startedAt, finishedAt: new Date().toISOString(), source: fileName });
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
      <div className="brand-mark">QB</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Queue Builder</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{source.mode === "live" ? <>Creates in <strong>{environment}</strong></> : "Sample environment — nothing is written"}</span>
      </div>
    </header>

    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}

    <div className="write-banner" role="note">
      <span className="write-icon" aria-hidden="true">✎</span>
      <span><strong>This tool creates records{source.mode === "live" ? ` in ${environment}` : ""}.</strong> Nothing is written until you've reviewed the plan and confirmed. It only ever creates new advanced queues and adds members to them: it never changes or deletes existing queues.</span>
    </div>

    <ol className="stepper">
      {STEPS.map((s, i) => <li key={s} className={s === step ? "active" : (STEPS.indexOf(step) > i ? "done" : "")}>
        <span className="step-number">{i + 1}</span>{s === "upload" ? "Upload CSV" : s === "review" ? "Review plan" : "Create"}
      </li>)}
    </ol>

    {step === "upload" && <UploadStep busy={busy} fileInput={fileInput} onFile={loadFile} />}
    {step === "review" && plan && <ReviewStep plan={plan} fileName={fileName} environment={environment} confirming={confirming} live={source.mode === "live"}
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
      <h2>Upload the advanced queues to create</h2>
      <p className="muted">One row per queue. List its members in the <code>members</code> column by sign-in name, separated by <code>|</code>. Empty cells take the default shown in the column reference.</p>
      <div className="template-actions">
        <button className="button secondary" onClick={() => downloadCsv(EXAMPLE_FILE_NAME, exampleCsv())}>⇩ Download example CSV</button>
        <button className="button ghost" onClick={() => downloadCsv("advanced-queues.csv", emptyTemplateCsv())}>Empty template (headers only)</button>
      </div>
      <p className="muted">The example creates 5 queues: voice queues with each assignment method, a public queue, a messaging queue and a record queue, with and without members and operating hours. Replace its names with ones from your environment, or upload it as-is to see how the checks work.</p>
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
        <p>{c.description}{c.defaultValue ? <> Empty: <em>{c.defaultValue}</em>.</> : null}{c.choices ? <> Values: {c.choices.join(", ")}.</> : null}</p>
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
  plan: ResolvedPlan; fileName: string; environment: string; confirming: boolean; live: boolean;
  onReplace: () => void; onBack: () => void; onCreate: () => void; onCancel: () => void; onConfirm: () => void;
}): React.ReactElement {
  const { plan } = props;
  const errors = errorCount(plan.issues);
  const warnings = plan.issues.length - errors;
  const members = plan.queues.reduce((n, q) => n + q.refs.members.length, 0);
  const canCreate = errors === 0 && plan.queues.length > 0;
  const count = plan.queues.length;

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Checked <strong>{props.fileName}</strong> ({plan.rowCount} row{plan.rowCount === 1 ? "" : "s"}) against <strong>{props.environment}</strong>. Nothing has been created yet.</p>
      <div className="summary-tiles">
        <div className="stat-tile"><span className="eyebrow">Queues</span><strong>{count}</strong></div>
        <div className="stat-tile"><span className="eyebrow">Memberships</span><strong>{members}</strong><span>agents added</span></div>
        <div className={`stat-tile ${errors ? "bad" : "good"}`}><span className="eyebrow">Errors</span><strong>{errors}</strong><span>{errors ? "fix these first" : "none"}</span></div>
        <div className={`stat-tile ${warnings ? "warn" : ""}`}><span className="eyebrow">Warnings</span><strong>{warnings}</strong><span>check, won't block</span></div>
        <div />
        <div className="summary-actions">
          <button className="button ghost" onClick={props.onBack}>Start over</button>
          <button className="button secondary" onClick={props.onReplace}>Upload corrected file</button>
          <button className="button primary" disabled={!canCreate || props.confirming} onClick={props.onCreate}>Create {count} queue{count === 1 ? "" : "s"}</button>
        </div>
      </div>
      {props.confirming && <div className="confirm-box" role="alertdialog" aria-label="Confirm creation">
        <p><strong>Create {count} advanced queue{count === 1 ? "" : "s"} in {props.environment}?</strong> With {members} membership{members === 1 ? "" : "s"}. {props.live ? "This tool can't undo it: queues have to be removed in the admin center." : "In the sample environment this is simulated."} A log of everything created is available afterwards.</p>
        <div><button className="button ghost" onClick={props.onCancel}>Cancel</button><button className="button danger" onClick={props.onConfirm}>Yes, create them</button></div>
      </div>}
    </section>

    <section className="review-grid">
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Plan</p><h2>What will be created</h2></div></div>
        {plan.queues.length ? <div className="data-table queue-table" role="table">
          <div className="data-head" role="row"><span>Queue</span><span>Type · assignment</span><span>Priority · visibility</span><span>Operating hours</span><span>Members</span></div>
          {plan.queues.map((q) => <QueueRow key={q.line} q={q} hasErrors={plan.issues.some((i) => i.severity === "error" && i.line === q.line)} />)}
        </div> : <div className="scenario-empty"><span>◔</span><p>No queues in this file</p></div>}
      </div>
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Checks</p><h2>Problems found</h2></div>{plan.issues.length > 0 && <button className="button ghost small" onClick={() => downloadCsv("advanced-queues-issues.csv", issuesToCsv(plan.issues))}>Download</button>}</div>
        {plan.issues.length ? <IssueList issues={plan.issues} /> : <div className="scenario-empty"><span>✓</span><p>No problems found</p><small>Every name in the file matches a record in the environment.</small></div>}
      </div>
    </section>
  </>;
}

function QueueRow({ q, hasErrors }: { q: ResolvedQueue; hasErrors: boolean }): React.ReactElement {
  return <div className={`data-row ${hasErrors ? "row-error" : ""}`} role="row">
    <span className="cell-strong">{q.name}<small>Line {q.line}{q.description ? ` · ${q.description}` : ""}</small></span>
    <span>{q.type}<small>{q.assignmentMethod}</small></span>
    <span>Priority {q.priority}<small>{q.visibility}</small></span>
    <span>{q.operatingHours ?? <span className="cell-muted">Always open</span>}</span>
    <span>{q.refs.members.length ? q.refs.members.map((m) => <span key={m.id} className="member">{m.fullName}</span>) : <span className="pill later">No members</span>}</span>
  </div>;
}

function CreateStep({ progress, results, run, issues, source, environment, onStartOver }: {
  progress?: { done: number; total: number; message: string }; results?: QueueResult[]; run?: RunInfo; issues: Issue[]; source: QueueSource; environment: string; onStartOver: () => void;
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
      <h2>Creating queues in {environment}…</h2>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="muted">{progress ? `${progress.done} of ${progress.total} — ${progress.message}` : "Starting…"}</p>
      <p className="muted">Keep this page open until it's finished.</p>
    </section>;
  }

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Finished in <strong>{environment}</strong>.</p>
      <div className="summary-tiles">
        <div className="stat-tile good"><span className="eyebrow">Created</span><strong>{summary!.created}</strong><span>queues</span></div>
        <div className={`stat-tile ${summary!.partial ? "warn" : ""}`}><span className="eyebrow">Partly created</span><strong>{summary!.partial}</strong><span>need attention</span></div>
        <div className={`stat-tile ${summary!.failed ? "bad" : ""}`}><span className="eyebrow">Not created</span><strong>{summary!.failed}</strong></div>
        <div />
        <div />
        <div className="summary-actions">
          {run && <button className="button secondary" onClick={() => downloadCsv(logFileName("advanced-queues", run), runLogCsv(results, issues, run))}>⇩ Download log</button>}
          <button className="button primary" onClick={onStartOver}>Upload another file</button>
        </div>
      </div>
    </section>
    <section className="panel results-panel">
      {results.map((r) => <article key={r.name} className={`result-card ${r.outcome}`}>
        <header><h3>{r.queueId && source.recordUrl(r.queueId) ? <a href={source.recordUrl(r.queueId)} target="_blank" rel="noreferrer">{r.name}</a> : r.name}</h3><span className={`outcome-pill ${r.outcome}`}>{OUTCOME_LABELS[r.outcome]}</span></header>
        <ul className="step-list">{r.steps.map((s, i) => <li key={i} className={s.status}>
          <span className={`step-status ${s.status}`}>{s.status === "created" ? "✓" : s.status === "failed" ? "✕" : "–"}</span>
          <span className="step-label">{s.label}</span>
          <span className="step-name">{s.name}{s.error && <small className="step-error">{s.error}</small>}</span>
        </li>)}</ul>
        {r.notes.length > 0 && <ul className="note-list">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </article>)}
    </section>
  </>;
}
