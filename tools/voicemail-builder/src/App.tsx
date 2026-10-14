// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { environmentLabel, isDataverseAvailable } from "../../shared/src/xrm";
import { downloadCsv, parseCsv } from "../../voice-workstream-builder/src/csv";
import { RunInfo, logFileName } from "../../voice-workstream-builder/src/runLog";
import { VoicemailSource } from "./dataSource";
import { dataverseSource } from "./dataverse";
import { demoSource } from "./demoData";
import { executePlan } from "./execute";
import { OUTCOME_LABELS, issuesToCsv, runLogCsv } from "./export";
import { Catalog, Issue, ParsedPlan, QueuePlan, QueueResult, ResolvedPlan, Settings, errorCount } from "./model";
import { describe } from "./overflow";
import { hasWork, memberLabel, resolvePlan, validateCsv } from "./plan";
import { ASSIGNMENT_METHODS, AssignmentMethod, QUEUE_TABLE } from "./schema";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyTemplateCsv, exampleCsv } from "./template";

type Step = "upload" | "review" | "create";
const STEPS: Step[] = ["upload", "review", "create"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const source: VoicemailSource = live ? dataverseSource : demoSource;
  const environment = live ? environmentLabel() : "the sample environment";

  const [step, setStep] = useState<Step>("upload");
  const [settings, setSettings] = useState<Settings>({ existingRules: "skip", assignmentMethod: "Highest capacity" });
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedPlan | undefined>(undefined);
  const [catalog, setCatalog] = useState<Catalog | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(live ? "" : "Not running inside Dataverse, so this is the sample environment: creating only simulates the voicemail setup. Try it with the example CSV.");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; message: string } | undefined>(undefined);
  const [results, setResults] = useState<QueueResult[] | undefined>(undefined);
  const [run, setRun] = useState<RunInfo | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  // The plan follows the settings, so they can still be changed on the Review step.
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
    const outcome = await executePlan(plan, source, () => crypto.randomUUID(), setProgress);
    setRun({ tool: "Voicemail Builder", mode: source.mode, environment, user: source.currentUser(), startedAt, finishedAt: new Date().toISOString(), source: fileName });
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
      <div className="brand-mark">VMB</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Voicemail Builder</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{source.mode === "live" ? <>Creates in <strong>{environment}</strong></> : "Sample environment — nothing is written"}</span>
      </div>
    </header>

    {message && <div className="notice"><span className="notice-icon">i</span><span>{message}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button></div>}

    <div className="write-banner" role="note">
      <span className="write-icon" aria-hidden="true">✎</span>
      <span><strong>This tool changes voice queues and voicemail routing{source.mode === "live" ? ` in ${environment}` : ""}.</strong> Nothing is written until you've reviewed the plan and confirmed. Per voice queue it sets overflow to voicemail and creates a voicemail queue, a voicemail workstream and the intake rule between them. It never deletes anything, and only changes existing overflow rules for the conditions in the file.</span>
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
    <div className="field">
      <span className="field-label">Existing overflow rules</span>
      <div className="choice-row" role="radiogroup" aria-label="Existing overflow rules">
        <label className={settings.existingRules === "skip" ? "active" : ""}><input type="radio" name="existing" checked={settings.existingRules === "skip"} onChange={() => onSettings({ ...settings, existingRules: "skip" })} /> Skip</label>
        <label className={settings.existingRules === "overwrite" ? "active" : ""}><input type="radio" name="existing" checked={settings.existingRules === "overwrite"} onChange={() => onSettings({ ...settings, existingRules: "overwrite" })} /> Overwrite</label>
      </div>
      <small>When a queue already has an overflow rule for the same condition with another action (e.g. callback): leave it (Skip), or change it to voicemail (Overwrite). The same goes for an intake rule that sends the queue's voicemails elsewhere.</small>
    </div>
    <label className="field">
      <span className="field-label">Assignment method of new voicemail queues</span>
      <select value={settings.assignmentMethod} onChange={(e) => onSettings({ ...settings, assignmentMethod: e.target.value as AssignmentMethod })}>
        {Object.keys(ASSIGNMENT_METHODS).map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <small>How voicemails are handed to the agents of a new voicemail queue. Existing queues keep theirs.</small>
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
      <h2>Voicemail per voice queue</h2>
      <p className="muted">For each voice queue in the file: overflow to voicemail on the queue, a voicemail queue (Record) with its agents, a voicemail workstream, and an intake rule so the queue's voicemails go to that workstream.</p>
      <SettingsFields settings={settings} onSettings={onSettings} />
      <div className="template-actions">
        <button className="button secondary" onClick={() => downloadCsv(EXAMPLE_FILE_NAME, exampleCsv())}>⇩ Download example CSV</button>
        <button className="button ghost" onClick={() => downloadCsv("voicemail.csv", emptyTemplateCsv())}>Empty template (headers only)</button>
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
      <p className="muted">One row per voice queue, with at least one overflow condition.</p>
    </div>
  </section>;
}

function IssueList({ issues }: { issues: Issue[] }): React.ReactElement {
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? (a.line ?? 0) - (b.line ?? 0) : a.severity === "error" ? -1 : 1));
  return <ul className="issue-list">{sorted.map((issue, i) => <li key={i} className={issue.severity}>
    <span className={`severity-pill ${issue.severity}`}>{issue.severity === "error" ? "Error" : "Warning"}</span>
    <span className="issue-where">{issue.line ? `Line ${issue.line}` : "Environment"}{issue.column ? ` · ${issue.column}` : ""}{issue.queue ? ` · ${issue.queue}` : ""}</span>
    <span className="issue-message">{issue.message}</span>
  </li>)}</ul>;
}

// What the plan does for one queue, as a list.
function planLines(q: QueuePlan): { label: string; text: string; kind: "new" | "change" | "same" }[] {
  const lines: { label: string; text: string; kind: "new" | "change" | "same" }[] = [];
  lines.push({ label: "Voicemail queue", text: q.voicemailQueue ? `Uses "${q.row.voicemailQueueName}"` : `Creates "${q.row.voicemailQueueName}"`, kind: q.voicemailQueue ? "same" : "new" });
  if (q.members.length) lines.push({ label: "Members", text: `Adds ${q.members.map(memberLabel).join(", ")}`, kind: "new" });
  lines.push({ label: "Voicemail workstream", text: q.voicemailWorkstream ? `Uses "${q.row.voicemailWorkstreamName}"` : `Creates "${q.row.voicemailWorkstreamName}"`, kind: q.voicemailWorkstream ? "same" : "new" });
  lines.push({ label: "Intake rule", text: q.intake === "add" ? "Adds: voicemails from this queue go to the workstream" : q.intake === "update" ? `Changes "${q.intakeRule?.name}" to this workstream` : q.intakeRule && q.voicemailWorkstream && q.intakeRule.workstreamId === q.voicemailWorkstream.id ? "Already in place" : "Left as it is (Skip)", kind: q.intake === "add" ? "new" : q.intake === "update" ? "change" : "same" });
  q.stages.forEach((s) => {
    const label = s.stage === "prequeue" ? "Overflow before queueing" : "Overflow while waiting";
    if (s.changes.length) lines.push({ label, text: s.changes.map((c) => `${c.kind === "add" ? "Adds" : c.overwrote ? "Overwrites" : "Updates"}: ${describe(c.wanted)} → voicemail`).join("; ") + (s.ruleset ? "" : " (new ruleset)"), kind: s.changes.some((c) => c.kind === "update") ? "change" : "new" });
    if (s.skipped.length) lines.push({ label, text: `Skips ${s.skipped.join(", ")} (another action)`, kind: "same" });
  });
  const wantedStages = new Set(q.row.overflow.map((w) => (w.condition === "waitTime" ? "inqueue" : "prequeue")));
  q.stages.filter((s) => wantedStages.has(s.stage) && !s.changes.length && !s.skipped.length).forEach((s) => lines.push({ label: s.stage === "prequeue" ? "Overflow before queueing" : "Overflow while waiting", text: "Already set to voicemail", kind: "same" }));
  return lines;
}

function ReviewStep(props: {
  plan: ResolvedPlan; fileName: string; environment: string; confirming: boolean; live: boolean; onSettings: (s: Settings) => void;
  onReplace: () => void; onBack: () => void; onCreate: () => void; onCancel: () => void; onConfirm: () => void;
}): React.ReactElement {
  const { plan } = props;
  const errors = errorCount(plan.issues);
  const warnings = plan.issues.length - errors;
  const ready = plan.queues.filter((q) => !q.blocked && hasWork(q));
  const newQueues = ready.filter((q) => !q.voicemailQueue).length;
  const newWorkstreams = ready.filter((q) => !q.voicemailWorkstream).length;
  const canCreate = errors === 0 && ready.length > 0;

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Checked <strong>{props.fileName}</strong> ({plural(plan.rowCount, "row")}) against <strong>{props.environment}</strong>. Nothing has been created yet.</p>
      <div className="summary-tiles">
        <div className="stat-tile"><span className="eyebrow">Voice queues</span><strong>{plan.queues.length}</strong><span>{ready.length} to set up</span></div>
        <div className="stat-tile"><span className="eyebrow">New</span><strong>{newQueues + newWorkstreams}</strong><span>{plural(newQueues, "queue")}, {plural(newWorkstreams, "workstream")}</span></div>
        <div className={`stat-tile ${errors ? "bad" : "good"}`}><span className="eyebrow">Errors</span><strong>{errors}</strong><span>{errors ? "fix these first" : "none"}</span></div>
        <div className={`stat-tile ${warnings ? "warn" : ""}`}><span className="eyebrow">Warnings</span><strong>{warnings}</strong><span>check, won't block</span></div>
        <div />
        <div className="summary-actions">
          <button className="button ghost" onClick={props.onBack}>Start over</button>
          <button className="button secondary" onClick={props.onReplace}>Upload corrected file</button>
          <button className="button primary" disabled={!canCreate || props.confirming} onClick={props.onCreate}>Set up {plural(ready.length, "queue")}</button>
        </div>
      </div>
      {props.confirming && <div className="confirm-box" role="alertdialog" aria-label="Confirm">
        <p><strong>Set up voicemail for {plural(ready.length, "voice queue")} in {props.environment}?</strong> Creates {plural(newQueues, "voicemail queue")} and {plural(newWorkstreams, "voicemail workstream")}, adds the intake rules, and sets the overflow rules. {props.live ? "Calls that overflow go to voicemail straight away. This tool can't undo it: changes have to be removed in the admin center." : "In the sample environment this is simulated."} A log of everything created is available afterwards.</p>
        <div><button className="button ghost" onClick={props.onCancel}>Cancel</button><button className="button danger" onClick={props.onConfirm}>Yes, set it up</button></div>
      </div>}
    </section>

    <section className="review-grid">
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Plan</p><h2>Per voice queue</h2></div></div>
        <SettingsFields settings={plan.settings} onSettings={props.onSettings} />
        {plan.queues.length ? plan.queues.map((q) => <article key={q.line} className={`ws-card ${q.blocked ? "has-errors" : ""}`}>
          <header>
            <h3>{q.row.queueName}</h3>
            <div className="ws-facts">
              {q.blocked ? <span className="pill blocked">Blocked</span> : !hasWork(q) ? <span className="pill later">Nothing to do</span> : <span className="pill">Line {q.line}</span>}
            </div>
          </header>
          <ul className="plan-lines">{planLines(q).map((l, i) => <li key={i} className={l.kind}>
            <span className="plan-label">{l.label}</span><span>{l.text}</span>
          </li>)}</ul>
        </article>) : <div className="scenario-empty"><span>◔</span><p>No queues in this file</p></div>}
      </div>
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">Checks</p><h2>Problems found</h2></div>{plan.issues.length > 0 && <button className="button ghost small" onClick={() => downloadCsv("voicemail-issues.csv", issuesToCsv(plan.issues))}>Download</button>}</div>
        {plan.issues.length ? <IssueList issues={plan.issues} /> : <div className="scenario-empty"><span>✓</span><p>No problems found</p><small>Every queue and user in the file matches a record in the environment.</small></div>}
      </div>
    </section>
  </>;
}

function CreateStep({ progress, results, run, issues, settings, source, environment, onStartOver }: {
  progress?: { done: number; total: number; message: string }; results?: QueueResult[]; run?: RunInfo; issues: Issue[]; settings: Settings; source: VoicemailSource; environment: string; onStartOver: () => void;
}): React.ReactElement {
  const summary = useMemo(() => results && ({
    done: results.filter((r) => r.outcome === "done").length,
    partial: results.filter((r) => r.outcome === "partial").length,
    failed: results.filter((r) => r.outcome === "failed").length
  }), [results]);

  if (!results) {
    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return <section className="panel progress-panel">
      <p className="eyebrow">Creating</p>
      <h2>Setting up voicemail in {environment}…</h2>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="muted">{progress ? `${progress.done} of ${progress.total} — ${progress.message}` : "Starting…"}</p>
      <p className="muted">Keep this page open until it's finished.</p>
    </section>;
  }

  return <>
    <section className="summary-strip">
      <p className="summary-caption">Finished in <strong>{environment}</strong>.</p>
      <div className="summary-tiles">
        <div className="stat-tile good"><span className="eyebrow">Done</span><strong>{summary!.done}</strong><span>voice queues</span></div>
        <div className={`stat-tile ${summary!.partial ? "warn" : ""}`}><span className="eyebrow">Partly done</span><strong>{summary!.partial}</strong><span>need attention</span></div>
        <div className={`stat-tile ${summary!.failed ? "bad" : ""}`}><span className="eyebrow">Not done</span><strong>{summary!.failed}</strong></div>
        <div />
        <div />
        <div className="summary-actions">
          {run && <button className="button secondary" onClick={() => downloadCsv(logFileName("voicemail", run), runLogCsv(results, issues, run, settings))}>⇩ Download log</button>}
          <button className="button primary" onClick={onStartOver}>Upload another file</button>
        </div>
      </div>
    </section>
    <section className="panel results-panel">
      {results.map((r) => <article key={r.name} className={`result-card ${r.outcome}`}>
        <header><h3>{r.queueId && source.recordUrl(QUEUE_TABLE, r.queueId) ? <a href={source.recordUrl(QUEUE_TABLE, r.queueId)} target="_blank" rel="noreferrer">{r.name}</a> : r.name}</h3><span className={`outcome-pill ${r.outcome}`}>{OUTCOME_LABELS[r.outcome]}</span></header>
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
