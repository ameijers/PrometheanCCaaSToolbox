// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { downloadCsv, parseCsv } from "../../voice-workstream-builder/src/csv";
import { RunInfo, logFileName } from "../../voice-workstream-builder/src/runLog";
import { UnitSource } from "./dataSource";
import { clientUrl, dataverseSource, isDataverseAvailable } from "./dataverse";
import { demoSource } from "./demoData";
import { executePlan } from "./execute";
import { issuesToCsv, runLogCsv } from "./export";
import { ExistingUnit, Issue, Plan, PlannedUnit, UnitResult, errorCount } from "./model";
import { buildPlan } from "./plan";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyTemplateCsv, exampleCsv } from "./template";

type Step = "upload" | "review" | "create";
const STEPS: Step[] = ["upload", "review", "create"];
const STATUS_LABELS: Record<UnitResult["status"], string> = { created: "Created", failed: "Not created", skipped: "Skipped" };

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const source: UnitSource = live ? dataverseSource : demoSource;
  const environment = live ? (clientUrl()?.replace(/^https:\/\//, "") ?? "this environment") : "the sample environment";

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<Plan | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(live ? "" : "Not running inside Dataverse, so this is the sample environment: creating only simulates the business units. Try it with the example CSV.");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; message: string } | undefined>(undefined);
  const [results, setResults] = useState<UnitResult[] | undefined>(undefined);
  const [run, setRun] = useState<RunInfo | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadFile(file: File) {
    setBusy(true);
    setMessage("");
    setConfirming(false);
    try {
      setPlan(buildPlan(parseCsv(await file.text()), await source.loadCatalog()));
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
    setRun({ tool: "Business Unit Builder", mode: source.mode, environment, user: source.currentUser(), startedAt, finishedAt: new Date().toISOString(), source: fileName });
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
      <div className="brand-mark">BU</div>
      <div><p className="eyebrow">Dynamics 365 · Dataverse</p><h1>Business Unit Builder</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{source.mode === "live" ? <>Creates in <strong>{environment}</strong></> : "Sample environment — nothing is written"}</span>
      </div>
    </header>

    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}

    <div className="write-banner" role="note">
      <span className="write-icon" aria-hidden="true">✎</span>
      <span><strong>This tool creates business units{source.mode === "live" ? ` in ${environment}` : ""}.</strong> Nothing is written until you've reviewed the plan and confirmed. Business units are hard to remove: one can only be deleted after it's disabled and nothing belongs to it any more, so check the hierarchy carefully. This tool never changes, disables or deletes existing business units.</span>
    </div>

    <ol className="stepper">
      {STEPS.map((s, i) => <li key={s} className={s === step ? "active" : (STEPS.indexOf(step) > i ? "done" : "")}>
        <span className="step-number">{i + 1}</span>{s === "upload" ? "Upload CSV" : s === "review" ? "Review hierarchy" : "Create"}
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
      <h2>Upload the business units to create</h2>
      <p className="muted">One row per business unit. <code>parent_business_unit</code> can name an existing business unit or another row in the same file, so a whole hierarchy fits in one file, in any row order. Leave it empty to place the business unit directly under the root.</p>
      <div className="template-actions">
        <button className="button secondary" onClick={() => downloadCsv(EXAMPLE_FILE_NAME, exampleCsv())}>⇩ Download example CSV</button>
        <button className="button ghost" onClick={() => downloadCsv("business-units.csv", emptyTemplateCsv())}>Empty template (headers only)</button>
      </div>
      <p className="muted">The example creates 6 business units: a three-level "Contact Center" hierarchy under the root, and one under the existing "Sales". Its rows are deliberately out of order. Replace the parents with ones from your environment, or upload it as-is to see how the checks work.</p>
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
        <p>{c.description}{c.maxLength ? <> Up to {c.maxLength} characters.</> : null}{!c.required && c.header !== "parent_business_unit" ? <> Empty: not set.</> : null}</p>
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

// The planned hierarchy: each existing business unit that gets new children, with the new units nested
// under it. Existing ones are shown plain, new ones highlighted.
function HierarchyTree({ plan, issues }: { plan: Plan; issues: Issue[] }): React.ReactElement {
  const childrenOfPlanned = (key: string) => plan.units.filter((u) => u.parent?.kind === "planned" && u.parent.key === key);
  const anchors = new Map<string, { unit: ExistingUnit; children: PlannedUnit[] }>();
  plan.units.filter((u) => u.parent?.kind === "existing").forEach((u) => {
    const unit = (u.parent as { unit: ExistingUnit }).unit;
    const entry = anchors.get(unit.id) ?? { unit, children: [] };
    entry.children.push(u);
    anchors.set(unit.id, entry);
  });
  const hasError = (u: PlannedUnit) => issues.some((i) => i.severity === "error" && i.line === u.line);
  const node = (u: PlannedUnit): React.ReactElement => <li key={u.key}>
    <span className={`tree-node new ${hasError(u) ? "has-error" : ""}`}>
      <span className="tree-badge">New</span><strong>{u.name}</strong>
      <small>Line {u.line}{u.fields.divisionname ? ` · ${u.fields.divisionname}` : ""}{u.fields.costcenter ? ` · ${u.fields.costcenter}` : ""}{u.fields.address1_city ? ` · ${u.fields.address1_city}` : ""}</small>
    </span>
    {childrenOfPlanned(u.key).length > 0 && <ul>{childrenOfPlanned(u.key).map(node)}</ul>}
  </li>;
  if (!anchors.size) return <div className="scenario-empty"><span>◔</span><p>Nothing can be placed in the hierarchy yet</p><small>Fix the errors to see the tree.</small></div>;
  return <ul className="tree">{[...anchors.values()].map(({ unit, children }) => <li key={unit.id}>
    <span className="tree-node existing"><span className="tree-badge">Existing</span><strong>{unit.name}</strong>{!unit.parentId && <small>Root business unit</small>}</span>
    <ul>{children.map(node)}</ul>
  </li>)}</ul>;
}

function ReviewStep(props: {
  plan: Plan; fileName: string; environment: string; confirming: boolean; live: boolean;
  onReplace: () => void; onBack: () => void; onCreate: () => void; onCancel: () => void; onConfirm: () => void;
}): React.ReactElement {
  const { plan } = props;
  const errors = errorCount(plan.issues);
  const warnings = plan.issues.length - errors;
  const count = plan.units.length;
  const depth = plan.units.reduce((d, u) => Math.max(d, u.depth), 0);
  const canCreate = errors === 0 && count > 0;

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Checked <strong>{props.fileName}</strong> ({plan.rowCount} row{plan.rowCount === 1 ? "" : "s"}) against <strong>{props.environment}</strong>. Nothing has been created yet.</p>
      <div className="summary-tiles">
        <div className="stat-tile"><span className="eyebrow">Business units</span><strong>{count}</strong><span>to create</span></div>
        <div className="stat-tile"><span className="eyebrow">Levels</span><strong>{depth}</strong><span>below existing units</span></div>
        <div className={`stat-tile ${errors ? "bad" : "good"}`}><span className="eyebrow">Errors</span><strong>{errors}</strong><span>{errors ? "fix these first" : "none"}</span></div>
        <div className={`stat-tile ${warnings ? "warn" : ""}`}><span className="eyebrow">Warnings</span><strong>{warnings}</strong><span>check, won't block</span></div>
        <div />
        <div className="summary-actions">
          <button className="button ghost" onClick={props.onBack}>Start over</button>
          <button className="button secondary" onClick={props.onReplace}>Upload corrected file</button>
          <button className="button primary" disabled={!canCreate || props.confirming} onClick={props.onCreate}>Create {count} business unit{count === 1 ? "" : "s"}</button>
        </div>
      </div>
      {props.confirming && <div className="confirm-box" role="alertdialog" aria-label="Confirm creation">
        <p><strong>Create {count} business unit{count === 1 ? "" : "s"} in {props.environment}?</strong> {props.live ? "This tool can't undo it, and removing a business unit later means disabling it first, and only works while nothing belongs to it." : "In the sample environment this is simulated."} Each gets its own default team and copy of every security role. A log is available afterwards.</p>
        <div><button className="button ghost" onClick={props.onCancel}>Cancel</button><button className="button danger" onClick={props.onConfirm}>Yes, create them</button></div>
      </div>}
    </section>

    <section className="review-grid">
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Plan</p><h2>Hierarchy after creation</h2></div></div>
        <HierarchyTree plan={plan} issues={plan.issues} />
        <p className="muted tree-note">Created in this order: {plan.units.map((u) => u.name).join(" → ") || "—"}. Parents are always created before their children.</p>
      </div>
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Checks</p><h2>Problems found</h2></div>{plan.issues.length > 0 && <button className="button ghost small" onClick={() => downloadCsv("business-units-issues.csv", issuesToCsv(plan.issues))}>Download</button>}</div>
        {plan.issues.length ? <IssueList issues={plan.issues} /> : <div className="scenario-empty"><span>✓</span><p>No problems found</p><small>Every parent exists, or is created first.</small></div>}
      </div>
    </section>
  </>;
}

function CreateStep({ progress, results, run, issues, source, environment, onStartOver }: {
  progress?: { done: number; total: number; message: string }; results?: UnitResult[]; run?: RunInfo; issues: Issue[]; source: UnitSource; environment: string; onStartOver: () => void;
}): React.ReactElement {
  const summary = useMemo(() => results && ({
    created: results.filter((r) => r.status === "created").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length
  }), [results]);

  if (!results) {
    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return <section className="panel progress-panel">
      <p className="eyebrow">Creating</p>
      <h2>Creating business units in {environment}…</h2>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="muted">{progress ? `${progress.done} of ${progress.total} — ${progress.message}` : "Starting…"}</p>
      <p className="muted">Keep this page open until it's finished.</p>
    </section>;
  }

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Finished in <strong>{environment}</strong>.</p>
      <div className="summary-tiles">
        <div className="stat-tile good"><span className="eyebrow">Created</span><strong>{summary!.created}</strong><span>business units</span></div>
        <div className={`stat-tile ${summary!.failed ? "bad" : ""}`}><span className="eyebrow">Not created</span><strong>{summary!.failed}</strong></div>
        <div className={`stat-tile ${summary!.skipped ? "warn" : ""}`}><span className="eyebrow">Skipped</span><strong>{summary!.skipped}</strong><span>parent not created</span></div>
        <div />
        <div />
        <div className="summary-actions">
          {run && <button className="button secondary" onClick={() => downloadCsv(logFileName("business-units", run), runLogCsv(results, issues, run))}>⇩ Download log</button>}
          <button className="button primary" onClick={onStartOver}>Upload another file</button>
        </div>
      </div>
    </section>
    <section className="panel">
      <div className="data-table unit-table" role="table">
        <div className="data-head" role="row"><span /><span>Business unit</span><span>Parent</span><span>Result</span></div>
        {results.map((r) => {
          const url = r.id ? source.recordUrl(r.id) : undefined;
          return <div className={`data-row ${r.status}`} role="row" key={r.name}>
            <span className={`step-status ${r.status}`}>{r.status === "created" ? "✓" : r.status === "failed" ? "✕" : "–"}</span>
            <span className="cell-strong">{url ? <a href={url} target="_blank" rel="noreferrer">{r.name}</a> : r.name}</span>
            <span>{r.parentName}</span>
            <span>{STATUS_LABELS[r.status]}{r.error && <small className="step-error">{r.error}</small>}{r.notes.map((n) => <small key={n}>{n}</small>)}</span>
          </div>;
        })}
      </div>
      <p className="muted tree-note">Next steps: assign users and teams to the new business units, and check the security roles each one received.</p>
    </section>
  </>;
}
