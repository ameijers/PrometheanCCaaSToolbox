import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { ParsedCsv, downloadCsv, parseCsv } from "../../voice-workstream-builder/src/csv";
import { RunInfo, logFileName } from "../../voice-workstream-builder/src/runLog";
import { ColumnDef } from "./columns";
import { Issue, ItemResult, Plan, actionCounts, errorCount } from "./model";
import { RunProgress, issuesToCsv, runLogCsv, runPlan } from "./runner";

// The page shared by the onboarding tools: Upload CSV → Review (every row's actions, marked "will do" or
// "already in place") → Run → results and log. Each tool supplies its columns, example, how to read the
// environment and how to turn rows into actions. A tool can also offer a second way in next to the CSV
// upload — picking from lists in the page (config.selection) — which produces the same kind of plan and
// goes through the same review, run and log.

export interface ToolSource<C> {
  mode: "live" | "demo";
  environment: string;
  loadCatalog(): Promise<C>;
  recordUrl(table: string, id: string): string | undefined;
  currentUser(): string;
}

export interface ToolConfig<C> {
  brand: string;
  title: string;
  logName: string;            // tool name in the log
  logPrefix: string;          // log file name prefix
  itemLabel: string;          // "Team", "User"
  itemPlural: string;         // "teams", "users"
  runVerb: string;            // "Create" / "Set up" / "Add"
  writes: string;             // the write banner's explanation
  intro: React.ReactNode;
  exampleNote: string;
  exampleFileName: string;
  exampleCsv(): string;
  emptyCsv(): string;
  columns: ColumnDef[];
  source: ToolSource<C>;
  buildPlan(csv: ParsedCsv, catalog: C): Plan;
  // The table an action writes to, so a result can link to the record.
  tableOf(actionKey: string): string | undefined;
  nextSteps?: string;
  selection?: SelectionInput<C>;
}

export interface SelectionInput<C> {
  tabLabel: string;          // e.g. "Select users and skills"
  // Renders the selection page for the loaded catalog; calls onReview with the plan it built.
  component: React.ComponentType<{ catalog: C; onReview: (plan: Plan) => void }>;
}

type InputMode = "file" | "selection";

type Step = "upload" | "review" | "run";
const STEPS: Step[] = ["upload", "review", "run"];
const OUTCOME_LABELS: Record<ItemResult["outcome"], string> = { done: "Done", noChange: "Nothing to do", partial: "Partly done", failed: "Not done" };
const STATUS_ICON: Record<string, string> = { done: "✓", noChange: "=", failed: "✕", skipped: "–" };

export function ProvisioningApp<C>({ config }: { config: ToolConfig<C> }): React.ReactElement {
  const { source } = config;
  const live = source.mode === "live";
  const environment = live ? source.environment : "the sample environment";

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<Plan | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(live ? "" : `Not running inside Dataverse, so this is the sample environment: nothing is written. Try it with the example CSV.`);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<RunProgress | undefined>(undefined);
  const [results, setResults] = useState<ItemResult[] | undefined>(undefined);
  const [run, setRun] = useState<RunInfo | undefined>(undefined);
  const [mode, setMode] = useState<InputMode>("file");
  const [catalog, setCatalog] = useState<C | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  async function openSelection() {
    setMode("selection");
    if (catalog) return;
    setBusy(true);
    setMessage("");
    try {
      setCatalog(await source.loadCatalog());
    } catch (error) {
      setMessage(`Couldn't read the environment: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function reloadSelection() {
    setBusy(true);
    try { setCatalog(await source.loadCatalog()); } catch { setCatalog(undefined); } finally { setBusy(false); }
  }

  function reviewSelection(selectionPlan: Plan) {
    setPlan(selectionPlan);
    setFileName("your selection");
    setConfirming(false);
    setStep("review");
  }

  async function loadFile(file: File) {
    setBusy(true);
    setMessage("");
    setConfirming(false);
    try {
      setPlan(config.buildPlan(parseCsv(await file.text()), await source.loadCatalog()));
      setFileName(file.name);
      setStep("review");
    } catch (error) {
      setMessage(`Couldn't read the environment to check the file: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function startRun() {
    if (!plan) return;
    setConfirming(false);
    setStep("run");
    setResults(undefined);
    const startedAt = new Date().toISOString();
    const outcome = await runPlan(plan, setProgress);
    setRun({ tool: config.logName, mode: source.mode, environment, user: source.currentUser(), startedAt, finishedAt: new Date().toISOString(), source: fileName });
    setResults(outcome);
    setProgress(undefined);
  }

  function startOver() {
    setStep("upload");
    setCatalog(undefined);
    if (mode === "selection") void reloadSelection();
    setPlan(undefined);
    setResults(undefined);
    setRun(undefined);
    setFileName("");
    setConfirming(false);
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">{config.brand}</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>{config.title}</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{live ? <>Changes <strong>{environment}</strong></> : "Sample environment — nothing is written"}</span>
      </div>
    </header>

    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}

    <div className="write-banner" role="note">
      <span className="write-icon" aria-hidden="true">✎</span>
      <span><strong>This tool writes to {live ? environment : "the environment"}.</strong> {config.writes} Nothing is written until you've reviewed the plan and confirmed. Anything already in place is left alone, so the same file can be run again safely.</span>
    </div>

    <ol className="stepper">
      {STEPS.map((s, i) => <li key={s} className={s === step ? "active" : (STEPS.indexOf(step) > i ? "done" : "")}>
        <span className="step-number">{i + 1}</span>{s === "upload" ? (mode === "selection" ? "Select" : "Upload CSV") : s === "review" ? "Review plan" : config.runVerb}
      </li>)}
    </ol>

    {step === "upload" && config.selection && <div className="mode-tabs" role="tablist">
      <button role="tab" aria-selected={mode === "file"} className={`tab ${mode === "file" ? "active" : ""}`} onClick={() => setMode("file")}>From a CSV file</button>
      <button role="tab" aria-selected={mode === "selection"} className={`tab ${mode === "selection" ? "active" : ""}`} onClick={() => void openSelection()}>{config.selection.tabLabel}</button>
    </div>}
    {step === "upload" && mode === "file" && <UploadStep config={config} busy={busy} fileInput={fileInput} onFile={loadFile} />}
    {/* Stays mounted (hidden) during review, so "Change selection" comes back to the same choices. */}
    {step !== "run" && mode === "selection" && config.selection && <div hidden={step !== "upload"}>{catalog
      ? <config.selection.component catalog={catalog} onReview={reviewSelection} />
      : <section className="panel progress-panel"><p className="muted">{busy ? "Reading the environment…" : "Couldn't load the lists."}</p></section>}</div>}
    {step === "review" && plan && <ReviewStep config={config} plan={plan} fileName={fileName} environment={environment} confirming={confirming} live={live}
      fromSelection={mode === "selection"} onReplace={() => (mode === "selection" ? setStep("upload") : fileInput.current?.click())} onBack={startOver} onRun={() => setConfirming(true)} onCancel={() => setConfirming(false)} onConfirm={startRun} />}
    <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }} />
    {step === "run" && <RunStep config={config} progress={progress} results={results} run={run} issues={plan?.issues ?? []} environment={environment} onStartOver={startOver} />}
  </main>;
}

function UploadStep<C>({ config, busy, fileInput, onFile }: { config: ToolConfig<C>; busy: boolean; fileInput: React.RefObject<HTMLInputElement>; onFile: (f: File) => void }): React.ReactElement {
  const [dragging, setDragging] = useState(false);
  return <section className="panel-grid">
    <div className="panel">
      <p className="eyebrow">Step 1</p>
      <h2>Upload the {config.itemPlural}</h2>
      <p className="muted">{config.intro}</p>
      <div className="template-actions">
        <button className="button secondary" onClick={() => downloadCsv(config.exampleFileName, config.exampleCsv())}>⇩ Download example CSV</button>
        <button className="button ghost" onClick={() => downloadCsv(`${config.logPrefix}.csv`, config.emptyCsv())}>Empty template (headers only)</button>
      </div>
      <p className="muted">{config.exampleNote}</p>
      <div className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}>
        <span className="dropzone-icon">⇪</span>
        <p><strong>Drop a CSV file here</strong> or</p>
        <button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? "Checking…" : "Choose file"}</button>
        <small>Comma, semicolon or tab separated, as saved by Excel. The file is read in your browser and checked against the environment before anything is written.</small>
      </div>
    </div>
    <div className="panel">
      <p className="eyebrow">Reference</p>
      <h2>Columns</h2>
      <div className="column-reference"><ul>{config.columns.map((c) => <li key={c.header}>
        <code>{c.header}</code>{c.required && <span className="required">required</span>}
        <p>{c.description}{c.list ? <> Several values: separate them with <code>|</code>.</> : null}{c.choices ? <> Values: {c.choices.join(", ")}.</> : null}{!c.required ? <> Empty: <em>{c.empty ?? c.defaultValue ?? "not set"}</em>.</> : null}</p>
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

function ReviewStep<C>(props: {
  config: ToolConfig<C>; plan: Plan; fileName: string; environment: string; confirming: boolean; live: boolean; fromSelection: boolean;
  onReplace: () => void; onBack: () => void; onRun: () => void; onCancel: () => void; onConfirm: () => void;
}): React.ReactElement {
  const { plan, config } = props;
  const errors = errorCount(plan.issues);
  const warnings = plan.issues.length - errors;
  const counts = actionCounts(plan);
  const canRun = errors === 0 && counts.todo > 0;
  const n = plan.items.length;

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Checked <strong>{props.fileName}</strong> ({plan.rowCount} {props.fromSelection ? (plan.rowCount === 1 ? config.itemLabel.toLowerCase() : config.itemPlural) : `row${plan.rowCount === 1 ? "" : "s"}`}) against <strong>{props.environment}</strong>. Nothing has been written yet.</p>
      <div className="summary-tiles">
        <div className="stat-tile"><span className="eyebrow">{config.itemPlural}</span><strong>{n}</strong></div>
        <div className="stat-tile good"><span className="eyebrow">To do</span><strong>{counts.todo}</strong><span>actions</span></div>
        <div className="stat-tile"><span className="eyebrow">In place</span><strong>{counts.noChange}</strong><span>left alone</span></div>
        <div className={`stat-tile ${errors ? "bad" : ""}`}><span className="eyebrow">Errors</span><strong>{errors}</strong><span>{errors ? "fix these first" : "none"}</span></div>
        <div className={`stat-tile ${warnings ? "warn" : ""}`}><span className="eyebrow">Warnings</span><strong>{warnings}</strong><span>check, won't block</span></div>
        <div className="summary-actions">
          <button className="button ghost" onClick={props.onBack}>Start over</button>
          <button className="button secondary" onClick={props.onReplace}>{props.fromSelection ? "Change selection" : "Upload corrected file"}</button>
          <button className="button primary" disabled={!canRun || props.confirming} onClick={props.onRun}>{config.runVerb} ({counts.todo} action{counts.todo === 1 ? "" : "s"})</button>
        </div>
      </div>
      {!errors && counts.todo === 0 && n > 0 && <p className="muted all-done">Everything in this file is already in place. There's nothing to do.</p>}
      {props.confirming && <div className="confirm-box" role="alertdialog" aria-label="Confirm">
        <p><strong>Carry out {counts.todo} action{counts.todo === 1 ? "" : "s"} for {n} {n === 1 ? config.itemLabel.toLowerCase() : config.itemPlural} in {props.environment}?</strong> {props.live ? "This tool doesn't undo changes: removing them later is done in the admin center." : "In the sample environment this is simulated."} A log is available afterwards.</p>
        <div><button className="button ghost" onClick={props.onCancel}>Cancel</button><button className="button danger" onClick={props.onConfirm}>Yes, go ahead</button></div>
      </div>}
    </section>

    <section className="review-grid">
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Plan</p><h2>What will happen</h2></div></div>
        {n ? plan.items.map((item) => {
          const hasErrors = plan.issues.some((i) => i.severity === "error" && i.line === item.line);
          return <article key={item.key} className={`item-card ${hasErrors ? "has-errors" : ""}`}>
            <header><div><h3>{item.title}</h3><p className="item-facts">{item.facts.join(" · ")}</p></div>{!props.fromSelection && <span className="line-ref">Line {item.line}</span>}</header>
            <ul className="action-list">{item.actions.map((a) => <li key={a.key} className={a.status}>
              <span className={`action-pill ${a.status}`}>{a.status === "todo" ? "Will do" : "In place"}</span>
              <span className="action-label">{a.label}</span>
              <span className="action-target">{a.target}{a.reason && <small>{a.reason}</small>}</span>
            </li>)}</ul>
            {!item.actions.length && <p className="muted">No actions: see the problems for this line.</p>}
          </article>;
        }) : <div className="scenario-empty"><span>◔</span><p>Nothing to plan</p><small>Fix the errors to see the plan.</small></div>}
      </div>
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Checks</p><h2>Problems found</h2></div>{plan.issues.length > 0 && <button className="button ghost small" onClick={() => downloadCsv(`${config.logPrefix}-issues.csv`, issuesToCsv(plan.issues, config.itemLabel))}>Download</button>}</div>
        {plan.issues.length ? <IssueList issues={plan.issues} /> : <div className="scenario-empty"><span>✓</span><p>No problems found</p><small>{props.fromSelection ? "Every selected user can get these skills." : "Every name in the file matches a record in the environment."}</small></div>}
      </div>
    </section>
  </>;
}

function RunStep<C>({ config, progress, results, run, issues, environment, onStartOver }: {
  config: ToolConfig<C>; progress?: RunProgress; results?: ItemResult[]; run?: RunInfo; issues: Issue[]; environment: string; onStartOver: () => void;
}): React.ReactElement {
  const summary = useMemo(() => results && ({
    done: results.filter((r) => r.outcome === "done" || r.outcome === "noChange").length,
    partial: results.filter((r) => r.outcome === "partial").length,
    failed: results.filter((r) => r.outcome === "failed").length
  }), [results]);

  if (!results) {
    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return <section className="panel progress-panel">
      <p className="eyebrow">Working</p>
      <h2>Writing to {environment}…</h2>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="muted">{progress ? `${progress.done} of ${progress.total} — ${progress.message}` : "Starting…"}</p>
      <p className="muted">Keep this page open until it's finished.</p>
    </section>;
  }

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Finished in <strong>{environment}</strong>.</p>
      <div className="summary-tiles">
        <div className="stat-tile good"><span className="eyebrow">Done</span><strong>{summary!.done}</strong><span>{config.itemPlural}</span></div>
        <div className={`stat-tile ${summary!.partial ? "warn" : ""}`}><span className="eyebrow">Partly done</span><strong>{summary!.partial}</strong><span>need attention</span></div>
        <div className={`stat-tile ${summary!.failed ? "bad" : ""}`}><span className="eyebrow">Not done</span><strong>{summary!.failed}</strong></div>
        <div />
        <div />
        <div className="summary-actions">
          {run && <button className="button secondary" onClick={() => downloadCsv(logFileName(config.logPrefix, run), runLogCsv(results, issues, run, config.itemLabel))}>⇩ Download log</button>}
          <button className="button primary" onClick={onStartOver}>Start again</button>
        </div>
      </div>
    </section>
    <section className="panel results-panel">
      {results.map((r) => <article key={r.key} className={`result-card ${r.outcome}`}>
        <header><h3>{r.title}</h3><span className={`outcome-pill ${r.outcome}`}>{OUTCOME_LABELS[r.outcome]}</span></header>
        <ul className="step-list">{r.actions.map((a) => {
          const table = config.tableOf(a.key);
          const url = a.id && table ? config.source.recordUrl(table, a.id) : undefined;
          return <li key={a.key} className={a.status}>
            <span className={`step-status ${a.status}`}>{STATUS_ICON[a.status]}</span>
            <span className="step-label">{a.label}</span>
            <span className="step-name">{url ? <a href={url} target="_blank" rel="noreferrer">{a.target}</a> : a.target}{a.error && <small className={a.status === "noChange" ? "step-note" : "step-error"}>{a.error}</small>}</span>
          </li>;
        })}</ul>
      </article>)}
    </section>
    {config.nextSteps && <section className="panel next-steps"><p className="muted">{config.nextSteps}</p></section>}
  </>;
}
