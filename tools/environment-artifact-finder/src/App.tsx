// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { EMPTY_FILTER, FindingFilter, SortKey, filterFindings, sortFindings, summarize } from "./aggregate";
import { AnalysisResult, DISCLAIMER, TableCoverage, analyze } from "./analyze";
import { dataverseSource, isDataverseAvailable, recordUrl } from "./dataverse";
import { demoSource } from "./demoData";
import { downloadTextFile, findingsToCsv, findingsToMarkdown } from "./export";
import { CHECKS, CHECK_TYPE_LABELS, CONFIDENCE_LABELS, CONFIDENCE_ORDER, Category, CheckType, Confidence, Finding, TABLE_STATUS_LABELS, Verification } from "./model";
import { tableLabel } from "./referenceMap";
import { scanEnvironment } from "./scan";

type Tab = "summary" | "findings" | "housekeeping" | "coverage";

const PAGE_SIZE = 10;

const VERIFICATION_LABELS: Record<Verification, string> = {
  verified: "Verified live",
  standard: "Standard Dataverse",
  assumed: "Unverified",
  custom: "Custom (cts_*)",
  discovered: "Discovered live"
};

const CHECK_TYPES_BY_CATEGORY: Record<Category, CheckType[]> = { A: ["structural", "functional", "broken"], B: ["housekeeping"] };

function timestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function confidencePill(confidence: Confidence): React.ReactElement {
  return <span className={`confidence-pill ${confidence}`}>{CONFIDENCE_LABELS[confidence]}</span>;
}

function Disclaimer(): React.ReactElement {
  return <div className="disclaimer" role="note">
    <span className="disclaimer-icon" aria-hidden="true">!</span>
    <span><strong>Candidates for review, not a delete list.</strong> {DISCLAIMER}</span>
  </div>;
}

export function App(): React.ReactElement {
  const [result, setResult] = useState<AnalysisResult | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("Showing a sample environment until you scan a live one.");
  const [tab, setTab] = useState<Tab>("summary");
  const [filter, setFilter] = useState<FindingFilter>(EMPTY_FILTER);
  const [sortKey, setSortKey] = useState<SortKey>("confidence");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  async function runScan(live: boolean) {
    setLoading(true);
    setSelectedId(undefined);
    try {
      const snapshot = await scanEnvironment(live ? dataverseSource : demoSource, { onProgress: (p) => setProgress(`${p.message} (${Math.min(p.done, p.total)}/${p.total})`) });
      setResult(analyze(snapshot));
      if (live) setMessage("Scan complete. Nothing was changed — this tool only reads.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The scan failed.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  useEffect(() => { void runScan(false); }, []);

  function scanLive() {
    if (!isDataverseAvailable()) {
      setMessage("Not running inside Dataverse, so there's nothing live to scan. Open this page from the Promethean CCaaS Toolbox app. The sample environment is shown instead.");
      return;
    }
    setMessage("");
    void runScan(true);
  }

  const findings = result?.findings ?? [];
  const coverage = result?.coverage ?? [];
  const summary = useMemo(() => summarize(findings, coverage), [findings, coverage]);
  const tabCategory: Category = tab === "housekeeping" ? "B" : "A";
  const categoryFindings = useMemo(() => findings.filter((f) => f.category === tabCategory), [findings, tabCategory]);
  const visible = useMemo(() => sortFindings(filterFindings(categoryFindings, filter), sortKey, sortAsc), [categoryFindings, filter, sortKey, sortAsc]);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paged = visible.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const selected = findings.find((f) => f.id === selectedId);
  const entityOptions = useMemo(() => [...new Set(categoryFindings.map((f) => f.table))].sort((a, b) => tableLabel(a).localeCompare(tableLabel(b))), [categoryFindings]);
  const categoryCounts = useMemo(() => ({ A: findings.filter((f) => f.category === "A").length, B: findings.filter((f) => f.category === "B").length }), [findings]);
  const byCheck = useMemo(() => {
    const counts = new Map<string, number>();
    findings.forEach((f) => counts.set(f.checkId, (counts.get(f.checkId) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [findings]);
  const live = result?.snapshot.mode === "live";

  useEffect(() => { setPage(0); }, [filter, sortKey, sortAsc, tab]);

  function openTab(next: Tab, patch: Partial<FindingFilter> = {}) {
    setTab(next);
    setFilter({ ...EMPTY_FILTER, ...patch });
    setSelectedId(undefined);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) { setSortAsc((asc) => !asc); return; }
    setSortKey(key);
    setSortAsc(true);
  }

  function exportFindings(format: "csv" | "markdown") {
    if (!result) return;
    const content = format === "csv" ? findingsToCsv(visible) : findingsToMarkdown(visible, timestamp(result.snapshot.scannedAt), result.snapshot.mode);
    downloadTextFile(`artifact-finder-${tab}.${format === "csv" ? "csv" : "md"}`, content, format === "csv" ? "text/csv" : "text/markdown");
  }

  const sortHeader = (key: SortKey, label: string) => <button role="columnheader" onClick={() => toggleSort(key)}>{label}{sortKey === key ? (sortAsc ? " ▲" : " ▼") : ""}</button>;

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">EAF</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Environment Artifact Finder</h1></div>
      <div className="topbar-actions">
        <span className="read-only"><span className="status-dot" />Read-only — recommends, never deletes</span>
        <button className="button secondary" onClick={scanLive} disabled={loading}>{loading ? "Scanning…" : "Scan environment"}</button>
      </div>
    </header>

    {(message || (loading && progress)) && <div className="notice">
      <span className="notice-icon">i</span>
      <span>{loading && progress ? progress : message}</span>
      {!loading && message && <button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button>}
    </div>}

    <Disclaimer />

    <section className="summary-strip">
      <p className="summary-caption">
        {result ? <>Scan of <strong>{live ? "this environment" : "the sample environment"}</strong> at {timestamp(result.snapshot.scannedAt)} — {summary.tablesScanned} tables read{summary.tablesUnavailable ? `, ${summary.tablesUnavailable} not available` : ""}. Click a count to see those findings.</> : "Scanning…"}
      </p>
      <div className="summary-tiles">
        {CONFIDENCE_ORDER.map((confidence) => (
          <button key={confidence} type="button" className={`stat-tile ${confidence}`} onClick={() => openTab("findings", { confidence })}>
            <strong>{findings.filter((f) => f.confidence === confidence && f.category === "A").length}</strong><span>{CONFIDENCE_LABELS[confidence]} confidence</span>
          </button>
        ))}
        <button type="button" className="stat-tile housekeeping" onClick={() => openTab("housekeeping")}>
          <strong>{summary.byCategory.B}</strong><span>Housekeeping</span>
        </button>
        <div className="stat-tile estimate">
          <span className="eyebrow">If every High-confidence item were cleaned up</span>
          <strong>{summary.highConfidenceRecords} record{summary.highConfidenceRecords === 1 ? "" : "s"} would be removed</strong>
          {summary.highValueCount > 0 && <span className="estimate-note">{summary.highValueCount} may be a billed phone number. Check with your telephony provider first.</span>}
        </div>
        <div className="summary-actions">
          <button className="button secondary" onClick={() => exportFindings("csv")} disabled={!result}>Export CSV</button>
          <button className="button secondary" onClick={() => exportFindings("markdown")} disabled={!result}>Export Markdown</button>
        </div>
      </div>
    </section>

    <nav className="tabs" role="tablist">
      {([["summary", "Summary"], ["findings", `Findings (${categoryCounts.A})`], ["housekeeping", `Housekeeping (${categoryCounts.B})`], ["coverage", "Coverage"]] as [Tab, string][]).map(([key, label]) => (
        <button key={key} role="tab" aria-selected={tab === key} className={`tab ${tab === key ? "active" : ""}`} onClick={() => openTab(key)}>{label}</button>
      ))}
    </nav>

    {tab === "summary" && <section className="panel-grid">
      <div className="panel">
        <p className="eyebrow">By entity</p>
        <h2>Where the candidates are</h2>
        <div className="data-table entity-table" role="table">
          <div className="data-head" role="row"><span>Entity</span><span>High</span><span>Medium</span><span>Low</span><span>Total</span></div>
          {summary.byEntity.map((e) => (
            <button key={e.table} role="row" className="data-row" onClick={() => openTab(e.table === "userquery" || e.table === "bulkdeleteoperation" ? "housekeeping" : "findings", { table: e.table })}>
              <span className="cell-strong">{e.label}<small>{e.table}</small></span><span className="num high">{e.high || "—"}</span><span className="num medium">{e.medium || "—"}</span><span className="num low">{e.low || "—"}</span><span className="num">{e.total}</span>
            </button>
          ))}
          {!summary.byEntity.length && <div className="scenario-empty"><p>No findings</p></div>}
        </div>
      </div>
      <div className="panel">
        <p className="eyebrow">By check</p>
        <h2>Why they were flagged</h2>
        <ul className="check-list">
          {byCheck.map(([checkId, count]) => {
            const def = CHECKS[checkId as keyof typeof CHECKS];
            return <li key={checkId}>
              <button className="link-row" onClick={() => openTab(def.category === "B" ? "housekeeping" : "findings", { search: def.title })}>
                <span><strong>{def.title}</strong><small>{def.description}</small></span><span className="num">{count}</span>
              </button>
            </li>;
          })}
        </ul>
        {!!result && (result.skipped.length > 0 || result.snapshot.warnings.length > 0) && <>
          <p className="eyebrow section-gap">Not fully checked</p>
          <ul className="plain-list">{[...result.snapshot.warnings, ...result.skipped].map((w) => <li key={w}>{w}</li>)}</ul>
        </>}
        <p className="muted section-gap">Confidence: <strong>High</strong> means every known relationship was checked and none points to the record. <strong>Medium</strong> means the conclusion is inferred from routing logic, or part of the data couldn't be read. <strong>Low</strong> means it's a usage or housekeeping heuristic. Each finding says which applies, and why.</p>
      </div>
    </section>}

    {(tab === "findings" || tab === "housekeeping") && <section className="workspace">
      <aside className="sidebar">
        <div className="section-heading"><div><p className="eyebrow">Filters</p><h2>{tab === "findings" ? "Artifacts" : "Housekeeping"}</h2></div><span className="count">{visible.length}/{categoryFindings.length}</span></div>
        <label className="search"><span>⌕</span><input placeholder="Search name, entity or reason" value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} /></label>
        <div className="filter-group">
          <span className="filter-label">Entity</span>
          <select value={filter.table} onChange={(e) => setFilter((f) => ({ ...f, table: e.target.value }))}>
            <option value="all">All entities</option>
            {entityOptions.map((t) => <option key={t} value={t}>{tableLabel(t)}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">Confidence</span>
          <select value={filter.confidence} onChange={(e) => setFilter((f) => ({ ...f, confidence: e.target.value as FindingFilter["confidence"] }))}>
            <option value="all">All levels</option>
            {CONFIDENCE_ORDER.map((c) => <option key={c} value={c}>{CONFIDENCE_LABELS[c]}</option>)}
          </select>
        </div>
        {tab === "findings" && <div className="filter-group">
          <span className="filter-label">Check type</span>
          <select value={filter.checkType} onChange={(e) => setFilter((f) => ({ ...f, checkType: e.target.value as FindingFilter["checkType"] }))}>
            <option value="all">All types</option>
            {CHECK_TYPES_BY_CATEGORY.A.map((c) => <option key={c} value={c}>{CHECK_TYPE_LABELS[c]}</option>)}
          </select>
        </div>}
        <p className="sidebar-note">{tab === "findings"
          ? "Category A: records nothing active uses (structural), records that are wired in but can never do anything (functional), and references to deleted or deactivated records (broken)."
          : "Category B: judged by age, status and ownership rather than references, so always Low confidence."}</p>
        <div className="sidebar-footer"><span className="shield">◇</span><span>Read-only: this tool never creates, updates or deletes any Dataverse record.</span></div>
      </aside>

      <section className="content">
        <div className="data-table findings-table" role="table" aria-label="Findings">
          <div className="data-head" role="row">{sortHeader("entity", "Entity")}{sortHeader("name", "Name")}{sortHeader("reason", "Why it's flagged")}{sortHeader("confidence", "Confidence")}</div>
          {paged.length ? paged.map((f) => (
            <button role="row" key={f.id} className={`data-row ${f.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(f.id)}>
              <span className="cell-muted">{tableLabel(f.table)}</span>
              <span className="cell-strong">{f.recordName}{f.highValueNote && f.marksDead && <small className="high-value">Possibly billed</small>}</span>
              <span>{f.title}<small>{CHECK_TYPE_LABELS[f.checkType]}</small></span>
              <span>{confidencePill(f.confidence)}</span>
            </button>
          )) : <div className="scenario-empty"><span>◔</span><p>No findings match these filters</p></div>}
        </div>
        {visible.length > PAGE_SIZE && <div className="pagination">
          <button className="button secondary" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={currentPage === 0}>◀ Prev</button>
          <span className="pagination-status">Page {currentPage + 1} of {totalPages} ({visible.length} findings)</span>
          <button className="button secondary" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}>Next ▶</button>
        </div>}
      </section>

      <aside className="inspector">
        {selected ? <FindingDetail finding={selected} live={live} /> : <div className="scenario-empty"><span>◇</span><p>No finding selected</p><small>Click a row to see the evidence behind it, what still points to it, and what to check before removing it.</small></div>}
      </aside>
    </section>}

    {tab === "coverage" && <section className="panel coverage-panel">
      <p className="eyebrow">Coverage</p>
      <h2>What was scanned, and how far each check could go</h2>
      <p className="muted">A table the scan couldn't read only affects that table's checks. When a table that could reference another one is missing, “nothing references it” findings on that other table drop to Medium, and the evidence says why. Tables with no known relationship are listed as “not evaluated”, not flagged record by record.</p>
      <div className="data-table coverage-table" role="table">
        <div className="data-head" role="row"><span>Table</span><span>Schema</span><span>Status</span><span>Rows</span><span>Reference check</span></div>
        {coverage.map((c) => <CoverageRow key={c.table} coverage={c} />)}
      </div>
    </section>}
  </main>;
}

function FindingDetail({ finding, live }: { finding: Finding; live: boolean }): React.ReactElement {
  return <div className="detail">
    <p className="eyebrow">{tableLabel(finding.table)} · {finding.table}</p>
    <h2>{finding.recordName}</h2>
    <p className="record-id">{finding.recordId}</p>
    <div className="detail-pills">{confidencePill(finding.confidence)}<span className="type-pill">{CHECK_TYPE_LABELS[finding.checkType]}</span><span className="type-pill">Category {finding.category}</span></div>

    <p className="detail-label">Why it's flagged</p>
    <p className="detail-text"><strong>{finding.title}.</strong> {finding.explanation}</p>
    {finding.highValueNote && finding.marksDead && <p className="high-value-callout">{finding.highValueNote}</p>}

    <p className="detail-label">Confidence: {CONFIDENCE_LABELS[finding.confidence]}</p>
    <p className="detail-text muted">{finding.confidenceReason}</p>

    <p className="detail-label">Evidence</p>
    <ul className="evidence-list">{finding.evidence.map((e) => <li key={e}>{e}</li>)}</ul>

    {finding.related.length > 0 && <>
      <p className="detail-label">Related records that still exist</p>
      <ul className="related-list">{finding.related.map((r) => {
        const url = live ? recordUrl(r.table, r.id) : undefined;
        return <li key={`${r.table}:${r.id}:${r.relation}`}>
          <small>{r.relation}</small>
          {url ? <a href={url} target="_blank" rel="noreferrer">{r.name}</a> : <span>{r.name}</span>}
          <span className="related-state">{tableLabel(r.table)}{r.active ? "" : " · deactivated"}</span>
        </li>;
      })}</ul>
    </>}

    <p className="detail-label">Suggested next step</p>
    <p className="detail-fix">{finding.nextStep}</p>
    {live && recordUrl(finding.table, finding.recordId) && <a className="link-button" href={recordUrl(finding.table, finding.recordId)} target="_blank" rel="noreferrer">Open this record ↗</a>}
    <p className="detail-disclaimer">Review before removing: this tool can't see every place a record might be used.</p>
  </div>;
}

function CoverageRow({ coverage: c }: { coverage: TableCoverage }): React.ReactElement {
  const available = c.inbound.filter((e) => e.available).length;
  const structural = c.check === "generic"
    ? (c.status !== "ok" ? "—" : c.structural?.evaluated ? `${available}/${c.inbound.length} relationships checked` : "Not evaluated")
    : c.check === "rule" ? "Rule-based (see README)" : c.check === "housekeeping" ? "Housekeeping" : "Evidence only";
  return <details className={`coverage-row ${c.status}`}>
    <summary role="row">
      <span className="cell-strong">{c.label}<small>{c.table}</small></span>
      <span><span className={`schema-pill ${c.verification}`}>{VERIFICATION_LABELS[c.verification]}</span></span>
      <span className={`status-text ${c.status}`}>{TABLE_STATUS_LABELS[c.status]}</span>
      <span className="num">{c.status === "ok" ? c.rowCount : "—"}</span>
      <span>{structural}</span>
    </summary>
    <div className="coverage-detail">
      <p>{c.notes}</p>
      {c.message && <p className="muted">{c.message}</p>}
      {c.structural?.reason && <p className="muted">{c.structural.reason}</p>}
      {c.inbound.length > 0 && <ul className="plain-list">{c.inbound.map((e) => <li key={`${e.from}.${e.field}`}>
        <strong>{e.description}</strong> — {e.from}.{e.field} ({e.kind === "content" ? "ids mentioned in text" : e.semantics === "parent" ? "belongs to" : "lookup"}, {VERIFICATION_LABELS[e.verification].toLowerCase()}){e.available ? "" : ` — not checked: ${e.reason}`}
      </li>)}</ul>}
      {c.structural && c.structural.gaps.length > 0 && <ul className="plain-list gaps">{c.structural.gaps.map((g) => <li key={g}>{g}</li>)}</ul>}
      {c.droppedColumns.length > 0 && <p className="muted">Columns not available here: {c.droppedColumns.join(", ")}.</p>}
      {c.status === "ok" && c.discovery === "unavailable" && <p className="muted">Relationship metadata couldn't be read for this table.</p>}
    </div>
  </details>;
}
