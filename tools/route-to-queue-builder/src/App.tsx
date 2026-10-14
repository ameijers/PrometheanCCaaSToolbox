// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { environmentLabel, isDataverseAvailable } from "../../shared/src/xrm";
import { downloadCsv, parseCsv } from "../../voice-workstream-builder/src/csv";
import { RunInfo, logFileName } from "../../voice-workstream-builder/src/runLog";
import { RouteSource } from "./dataSource";
import { dataverseSource } from "./dataverse";
import { demoSource } from "./demoData";
import { executePlan } from "./execute";
import { OUTCOME_LABELS, issuesToCsv, runLogCsv } from "./export";
import { Catalog, Issue, ParsedPlan, Settings, WorkstreamPlan, WorkstreamResult, errorCount } from "./model";
import { resolvePlan, validateCsv } from "./plan";
import { WORKSTREAM_TABLE } from "./schema";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyTemplateCsv, exampleCsv } from "./template";

type Step = "upload" | "review" | "create";
const STEPS: Step[] = ["upload", "review", "create"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const source: RouteSource = live ? dataverseSource : demoSource;
  const environment = live ? environmentLabel() : "the sample environment";

  const [step, setStep] = useState<Step>("upload");
  const [settings, setSettings] = useState<Settings>({ variable: "", defaultRulesetName: "Route to queue" });
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedPlan | undefined>(undefined);
  const [catalog, setCatalog] = useState<Catalog | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(live ? "" : "Not running inside Dataverse, so this is the sample environment: creating only simulates the rules. Try it with the example CSV and the context variable SelectedMenuItem.");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; message: string } | undefined>(undefined);
  const [results, setResults] = useState<WorkstreamResult[] | undefined>(undefined);
  const [run, setRun] = useState<RunInfo | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  // The plan follows the settings, so they can still be corrected on the Review step.
  const plan = useMemo(() => parsed && catalog ? resolvePlan(parsed, catalog, settings) : undefined, [parsed, catalog, settings]);

  async function loadFile(file: File) {
    setBusy(true);
    setMessage("");
    setConfirming(false);
    try {
      const csv = validateCsv(parseCsv(await file.text()));
      setCatalog(await source.loadCatalog());
      setParsed(csv);
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
    const outcome = await executePlan(plan, source, { newId: () => crypto.randomUUID(), pollMs: source.mode === "demo" ? 300 : 3000 }, setProgress);
    setRun({ tool: "Route-to-Queue Builder", mode: source.mode, environment, user: source.currentUser(), startedAt, finishedAt: new Date().toISOString(), source: fileName });
    setResults(outcome);
    setProgress(undefined);
  }

  function startOver() {
    setStep("upload");
    setParsed(undefined);
    setCatalog(undefined);
    setResults(undefined);
    setRun(undefined);
    setFileName("");
    setConfirming(false);
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">RQB</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Route-to-Queue Builder</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{source.mode === "live" ? <>Creates in <strong>{environment}</strong></> : "Sample environment — nothing is written"}</span>
      </div>
    </header>

    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}

    <div className="write-banner" role="note">
      <span className="write-icon" aria-hidden="true">✎</span>
      <span><strong>This tool changes workstream routing{source.mode === "live" ? ` in ${environment}` : ""}.</strong> Nothing is written until you've reviewed the plan and confirmed. It adds route-to-queue rules after a workstream's existing ones, and creates the context variable, ruleset and routing configuration where they're missing. It never changes or deletes existing rules.</span>
    </div>

    <ol className="stepper">
      {STEPS.map((s, i) => <li key={s} className={s === step ? "active" : (STEPS.indexOf(step) > i ? "done" : "")}>
        <span className="step-number">{i + 1}</span>{s === "upload" ? "Settings and CSV" : s === "review" ? "Review plan" : "Create"}
      </li>)}
    </ol>

    {step === "upload" && <UploadStep busy={busy} fileInput={fileInput} onFile={loadFile} settings={settings} onSettings={setSettings} />}
    {step === "review" && plan && <ReviewStep plan={plan} fileName={fileName} environment={environment} confirming={confirming} live={source.mode === "live"} onSettings={(s) => { setConfirming(false); setSettings(s); }}
      onReplace={() => fileInput.current?.click()} onBack={startOver} onCreate={() => setConfirming(true)} onCancel={() => setConfirming(false)} onConfirm={create} />}
    <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }} />
    {step === "create" && <CreateStep progress={progress} results={results} run={run} issues={plan?.issues ?? []} settings={settings} source={source} environment={environment} onStartOver={startOver} />}
  </main>;
}

function SettingsFields({ settings, onSettings }: { settings: Settings; onSettings: (s: Settings) => void }): React.ReactElement {
  return <div className="settings-fields">
    <label className="field">
      <span className="field-label">Context variable <span className="required">required</span></span>
      <input value={settings.variable} placeholder="e.g. SelectedMenuItem" onChange={(e) => onSettings({ ...settings, variable: e.target.value })} />
      <small>Every rule compares this variable with its menu value. It's created as a text variable on workstreams that don't have it.</small>
    </label>
    <label className="field">
      <span className="field-label">Default ruleset name</span>
      <input value={settings.defaultRulesetName} placeholder="e.g. Route to queue" onChange={(e) => onSettings({ ...settings, defaultRulesetName: e.target.value })} />
      <small>Only for workstreams without a route-to-queue ruleset yet. Workstreams that have one keep it, with its name.</small>
    </label>
  </div>;
}

function UploadStep({ busy, fileInput, onFile, settings, onSettings }: {
  busy: boolean; fileInput: React.RefObject<HTMLInputElement>; onFile: (f: File) => void; settings: Settings; onSettings: (s: Settings) => void;
}): React.ReactElement {
  const [dragging, setDragging] = useState(false);
  return <section className="panel-grid">
    <div className="panel">
      <p className="eyebrow">Step 1</p>
      <h2>Route conversations by a context variable</h2>
      <p className="muted">Each rule routes a conversation to a queue when the context variable equals a value, for example the menu option chosen in the IVR.</p>
      <SettingsFields settings={settings} onSettings={onSettings} />
      <p className="muted">Then upload the rules: one row per rule. A workstream gets its rules in the order of the file, after the rules it already has.</p>
      <div className="template-actions">
        <button className="button secondary" onClick={() => downloadCsv(EXAMPLE_FILE_NAME, exampleCsv())}>⇩ Download example CSV</button>
        <button className="button ghost" onClick={() => downloadCsv("route-to-queue.csv", emptyTemplateCsv())}>Empty template (headers only)</button>
      </div>
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
        <p>{c.description}</p>
      </li>)}</ul></div>
      <p className="muted">Every rule is: <em>context variable</em> equals <code>menu_value</code> → route to <code>queue_name</code>. The value is compared exactly, as text.</p>
    </div>
  </section>;
}

function IssueList({ issues }: { issues: Issue[] }): React.ReactElement {
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? (a.line ?? 0) - (b.line ?? 0) : a.severity === "error" ? -1 : 1));
  return <ul className="issue-list">{sorted.map((issue, i) => <li key={i} className={issue.severity}>
    <span className={`severity-pill ${issue.severity}`}>{issue.severity === "error" ? "Error" : "Warning"}</span>
    <span className="issue-where">{issue.line ? `Line ${issue.line}` : issue.column === "context variable" ? "Settings" : "File"}{issue.column ? ` · ${issue.column}` : ""}{issue.workstream ? ` · ${issue.workstream}` : ""}</span>
    <span className="issue-message">{issue.message}</span>
  </li>)}</ul>;
}

function rulesetLabel(w: WorkstreamPlan): string {
  if (w.mode === "append") return `Adds to "${w.rulesetName}"`;
  if (w.mode === "newRuleset") return `New ruleset "${w.rulesetName}"`;
  return `New routing and ruleset "${w.rulesetName}"`;
}

function ReviewStep(props: {
  plan: ReturnType<typeof resolvePlan>; fileName: string; environment: string; confirming: boolean; live: boolean; onSettings: (s: Settings) => void;
  onReplace: () => void; onBack: () => void; onCreate: () => void; onCancel: () => void; onConfirm: () => void;
}): React.ReactElement {
  const { plan } = props;
  const errors = errorCount(plan.issues);
  const warnings = plan.issues.length - errors;
  const ready = plan.workstreams.filter((w) => !w.blocked);
  const rules = ready.reduce((n, w) => n + w.rules.length, 0);
  const variables = ready.filter((w) => w.createVariable).length;
  const newRulesets = ready.filter((w) => w.mode !== "append").length;
  const canCreate = errors === 0 && ready.length > 0;
  const variable = plan.settings.variable.trim() || "the context variable";

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Checked <strong>{props.fileName}</strong> ({plural(plan.rowCount, "row")}) against <strong>{props.environment}</strong>. Nothing has been created yet.</p>
      <div className="summary-tiles">
        <div className="stat-tile"><span className="eyebrow">Workstreams</span><strong>{plan.workstreams.length}</strong></div>
        <div className="stat-tile"><span className="eyebrow">Rules</span><strong>{rules}</strong><span>to add</span></div>
        <div className="stat-tile"><span className="eyebrow">New</span><strong>{newRulesets}</strong><span>{newRulesets === 1 ? "ruleset" : "rulesets"}, {plural(variables, "variable")}</span></div>
        <div className={`stat-tile ${errors ? "bad" : "good"}`}><span className="eyebrow">Errors</span><strong>{errors}</strong><span>{errors ? "fix these first" : "none"}</span></div>
        <div className={`stat-tile ${warnings ? "warn" : ""}`}><span className="eyebrow">Warnings</span><strong>{warnings}</strong><span>check, won't block</span></div>
        <div className="summary-actions">
          <button className="button ghost" onClick={props.onBack}>Start over</button>
          <button className="button secondary" onClick={props.onReplace}>Upload corrected file</button>
          <button className="button primary" disabled={!canCreate || props.confirming} onClick={props.onCreate}>Add {plural(rules, "rule")}</button>
        </div>
      </div>
      {props.confirming && <div className="confirm-box" role="alertdialog" aria-label="Confirm">
        <p><strong>Add {plural(rules, "rule")} to {plural(ready.length, "workstream")} in {props.environment}?</strong> {variables ? `Creates the context variable "${variable}" on ${plural(variables, "workstream")}. ` : ""}{newRulesets ? `Creates ${plural(newRulesets, "new route-to-queue ruleset")}. ` : ""}{props.live ? "New conversations are routed by these rules straight away. This tool can't undo it: rules have to be removed in the admin center." : "In the sample environment this is simulated."} A log of everything created is available afterwards.</p>
        <div><button className="button ghost" onClick={props.onCancel}>Cancel</button><button className="button danger" onClick={props.onConfirm}>Yes, add them</button></div>
      </div>}
    </section>

    <section className="review-grid">
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Plan</p><h2>Rules per workstream</h2></div></div>
        <SettingsFields settings={plan.settings} onSettings={props.onSettings} />
        {plan.workstreams.length ? plan.workstreams.map((w) => <article key={w.name} className={`ws-card ${w.blocked ? "has-errors" : ""}`}>
          <header>
            <h3>{w.name}</h3>
            <div className="ws-facts">
              <span className="pill">{rulesetLabel(w)}</span>
              {w.createVariable && <span className="pill later">Creates "{variable}"</span>}
              {w.blocked && <span className="pill blocked">Blocked</span>}
            </div>
          </header>
          <div className="data-table rule-table" role="table">
            <div className="data-head" role="row"><span>Rule</span><span>When {variable} equals</span><span>Route to queue</span></div>
            {w.rules.map((r) => <div key={r.line} className={`data-row ${plan.issues.some((i) => i.severity === "error" && i.line === r.line) ? "row-error" : ""}`} role="row">
              <span className="cell-strong">{r.ruleName}<small>Line {r.line}</small></span>
              <span><code>{r.menuValue}</code></span>
              <span>{r.queueName}</span>
            </div>)}
          </div>
        </article>) : <div className="scenario-empty"><span>◔</span><p>No rules in this file</p></div>}
      </div>
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Checks</p><h2>Problems found</h2></div>{plan.issues.length > 0 && <button className="button ghost small" onClick={() => downloadCsv("route-to-queue-issues.csv", issuesToCsv(plan.issues))}>Download</button>}</div>
        {plan.issues.length ? <IssueList issues={plan.issues} /> : <div className="scenario-empty"><span>✓</span><p>No problems found</p><small>Every workstream and queue in the file matches a record in the environment.</small></div>}
      </div>
    </section>
  </>;
}

function CreateStep({ progress, results, run, issues, settings, source, environment, onStartOver }: {
  progress?: { done: number; total: number; message: string }; results?: WorkstreamResult[]; run?: RunInfo; issues: Issue[]; settings: Settings; source: RouteSource; environment: string; onStartOver: () => void;
}): React.ReactElement {
  const summary = useMemo(() => results && ({
    done: results.filter((r) => r.outcome === "done").length,
    partial: results.filter((r) => r.outcome === "partial").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    rules: results.reduce((n, r) => n + r.rulesAdded, 0)
  }), [results]);

  if (!results) {
    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return <section className="panel progress-panel">
      <p className="eyebrow">Creating</p>
      <h2>Adding route-to-queue rules in {environment}…</h2>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="muted">{progress ? `${progress.done} of ${progress.total} — ${progress.message}` : "Starting…"}</p>
      <p className="muted">A new context variable takes the platform up to a minute to process. Keep this page open until it's finished.</p>
    </section>;
  }

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Finished in <strong>{environment}</strong>.</p>
      <div className="summary-tiles">
        <div className="stat-tile good"><span className="eyebrow">Rules added</span><strong>{summary!.rules}</strong></div>
        <div className="stat-tile good"><span className="eyebrow">Done</span><strong>{summary!.done}</strong><span>workstreams</span></div>
        <div className={`stat-tile ${summary!.partial ? "warn" : ""}`}><span className="eyebrow">Partly done</span><strong>{summary!.partial}</strong><span>need attention</span></div>
        <div className={`stat-tile ${summary!.failed ? "bad" : ""}`}><span className="eyebrow">Not done</span><strong>{summary!.failed}</strong></div>
        <div />
        <div className="summary-actions">
          {run && <button className="button secondary" onClick={() => downloadCsv(logFileName("route-to-queue", run), runLogCsv(results, issues, run, settings))}>⇩ Download log</button>}
          <button className="button primary" onClick={onStartOver}>Upload another file</button>
        </div>
      </div>
    </section>
    <section className="panel results-panel">
      {results.map((r) => <article key={r.name} className={`result-card ${r.outcome}`}>
        <header><h3>{r.workstreamId && source.recordUrl(WORKSTREAM_TABLE, r.workstreamId) ? <a href={source.recordUrl(WORKSTREAM_TABLE, r.workstreamId)} target="_blank" rel="noreferrer">{r.name}</a> : r.name}</h3><span className={`outcome-pill ${r.outcome}`}>{OUTCOME_LABELS[r.outcome]}</span></header>
        <ul className="step-list">{r.steps.map((s, i) => <li key={i} className={s.status}>
          <span className={`step-status ${s.status}`}>{s.status === "failed" ? "✕" : s.status === "skipped" ? "–" : "✓"}</span>
          <span className="step-label">{s.label}</span>
          <span className="step-name">{s.name}{s.error && <small className="step-error">{s.error}</small>}</span>
        </li>)}</ul>
        {r.notes.length > 0 && <ul className="note-list">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </article>)}
    </section>
  </>;
}
