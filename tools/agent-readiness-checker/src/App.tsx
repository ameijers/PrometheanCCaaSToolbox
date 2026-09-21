import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { evaluateAgents, summarize } from "./aggregate";
import { DEMO_AGENTS } from "./demoData";
import { loadAgentRoster } from "./dataverse";
import { bulkToCsv, bulkToMarkdown, detailToCsv, detailToMarkdown, downloadTextFile } from "./export";
import { AgentReadiness, AgentRecord, CATEGORY_LABELS, CHECK_ORDER, CheckStatus, OVERALL_STATUS_LABELS, OverallStatus } from "./model";

const STATUS_ICON: Record<CheckStatus, string> = { pass: "✓", warn: "!", fail: "✕", unknown: "?" };
const OVERALL_ICON: Record<OverallStatus, string> = { ready: "✓", warning: "!", notReady: "✕", notVerifiable: "?" };
// Sort/severity order used both for the status filter dropdown and the "worst first" sort option.
const OVERALL_ORDER: OverallStatus[] = ["notReady", "warning", "notVerifiable", "ready"];

type SortKey = "name" | "status" | "failed" | "topIssue";

function timestamp(): string {
  return new Date().toLocaleString();
}

function statusPill(status: OverallStatus): React.ReactElement {
  return <span className={`overall-pill ${status}`}><span aria-hidden="true">{OVERALL_ICON[status]}</span> {OVERALL_STATUS_LABELS[status]}</span>;
}

function checkStatusBadge(status: CheckStatus): React.ReactElement {
  const label = status === "pass" ? "Pass" : status === "warn" ? "Warning" : status === "fail" ? "Fail" : "Not verifiable";
  return <span className={`check-badge ${status}`}><span aria-hidden="true">{STATUS_ICON[status]}</span> {label}</span>;
}

function distinctSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function App(): React.ReactElement {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [message, setMessage] = useState("Demo data is shown until a Dataverse connection is available.");
  const [agents, setAgents] = useState<AgentRecord[]>(DEMO_AGENTS);
  const [lastLoaded, setLastLoaded] = useState<string>(timestamp());

  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OverallStatus | "all">("all");
  const [queueFilter, setQueueFilter] = useState<string>("all");
  const [workstreamFilter, setWorkstreamFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortAsc, setSortAsc] = useState(true);

  const results = useMemo(() => evaluateAgents(agents), [agents]);
  const summary = useMemo(() => summarize(results), [results]);

  const queueNames = useMemo(() => distinctSorted(agents.flatMap((a) => (a.queueMemberships.known ? a.queueMemberships.value.map((m) => m.queueName) : []))), [agents]);
  const workstreamNames = useMemo(() => distinctSorted(agents.flatMap((a) => (a.queueMemberships.known ? a.queueMemberships.value.flatMap((m) => m.reachingWorkstreamNames) : []))), [agents]);

  const filtered = useMemo(() => {
    return results.filter((r) => {
      if (statusFilter !== "all" && r.overallStatus !== statusFilter) return false;
      if (searchQuery && !r.agentName.toLowerCase().includes(searchQuery.toLowerCase()) && !(r.domainName ?? "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
      const agent = agents.find((a) => a.id === r.agentId);
      const memberships = agent?.queueMemberships.known ? agent.queueMemberships.value : [];
      if (queueFilter !== "all" && !memberships.some((m) => m.queueName === queueFilter)) return false;
      if (workstreamFilter !== "all" && !memberships.some((m) => m.reachingWorkstreamNames.includes(workstreamFilter))) return false;
      return true;
    });
  }, [results, agents, statusFilter, searchQuery, queueFilter, workstreamFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.agentName.localeCompare(b.agentName);
      else if (sortKey === "status") cmp = OVERALL_ORDER.indexOf(a.overallStatus) - OVERALL_ORDER.indexOf(b.overallStatus);
      else if (sortKey === "failed") cmp = a.failedCount - b.failedCount;
      else if (sortKey === "topIssue") cmp = (a.topIssue ?? "").localeCompare(b.topIssue ?? "");
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortAsc]);

  const selected = results.find((r) => r.agentId === selectedAgentId);
  useEffect(() => { if (selectedAgentId && !results.some((r) => r.agentId === selectedAgentId)) setSelectedAgentId(undefined); }, [results, selectedAgentId]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) { setSortAsc((asc) => !asc); return; }
    setSortKey(key);
    setSortAsc(true);
  }

  async function connect() {
    setLoading(true);
    setProgressMessage("Connecting to the current Dataverse session…");
    setMessage("");
    try {
      const roster = await loadAgentRoster((progress) => setProgressMessage(progress.message));
      setConnected(true);
      setAgents(roster);
      setLastLoaded(timestamp());
      setMessage(roster.length ? "Connected. Reading is read-only; no data is modified." : "Connected, but no agents were found (no queue members and no agent-role holders in this environment).");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read this Dataverse environment.");
    } finally {
      setLoading(false);
      setProgressMessage("");
    }
  }

  async function refresh() {
    if (!connected) return;
    setLoading(true);
    setProgressMessage("Refreshing…");
    try {
      const roster = await loadAgentRoster((progress) => setProgressMessage(progress.message));
      setAgents(roster);
      setLastLoaded(timestamp());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to refresh.");
    } finally {
      setLoading(false);
      setProgressMessage("");
    }
  }

  function exportBulk(format: "csv" | "markdown") {
    const content = format === "csv" ? bulkToCsv(sorted) : bulkToMarkdown(sorted);
    downloadTextFile(`agent-readiness-bulk.${format === "csv" ? "csv" : "md"}`, content, format === "csv" ? "text/csv" : "text/markdown");
  }

  function exportDetail(format: "csv" | "markdown") {
    if (!selected) return;
    const content = format === "csv" ? detailToCsv(selected) : detailToMarkdown(selected);
    const safeName = selected.agentName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    downloadTextFile(`agent-readiness-${safeName}.${format === "csv" ? "csv" : "md"}`, content, format === "csv" ? "text/csv" : "text/markdown");
  }

  const checksByCategory = useMemo(() => {
    if (!selected) return [];
    return CHECK_ORDER.map((category) => selected.checks.find((c) => c.category === category)).filter((c): c is NonNullable<typeof c> => !!c);
  }, [selected]);

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">ARC</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Agent Readiness Checker</h1></div>
      <div className="topbar-actions">
        <span className="read-only"><span className="status-dot" />Read-only mode</span>
        <button className="button secondary" onClick={connect} disabled={loading}>{loading ? "Connecting…" : "Connect environment"}</button>
      </div>
    </header>
    {(message || (loading && progressMessage)) && <div className="notice">
      <span className="notice-icon">i</span>
      <span>{loading && progressMessage ? progressMessage : message}</span>
      {!loading && message && <button className="icon-button" aria-label="Dismiss notice" onClick={() => setMessage("")}>×</button>}
    </div>}

    <section className="summary-strip">
      <div className="stat-tile ready"><strong>{summary.ready}</strong><span>Ready</span></div>
      <div className="stat-tile warning"><strong>{summary.warning}</strong><span>Warning</span></div>
      <div className="stat-tile notReady"><strong>{summary.notReady}</strong><span>Not ready</span></div>
      <div className="stat-tile notVerifiable"><strong>{summary.notVerifiable}</strong><span>Not verifiable</span></div>
      <div className="stat-tile top-issue">
        <span className="eyebrow">Most common failing check</span>
        <strong>{summary.mostCommonFailingCheck ? `${summary.mostCommonFailingCheck.title} (${summary.mostCommonFailingCheck.count})` : "None — no failing checks"}</strong>
      </div>
      <div className="summary-actions">
        <button className="button secondary" onClick={refresh} disabled={loading || !connected}>Refresh</button>
        <button className="button secondary" onClick={() => exportBulk("csv")}>Export CSV</button>
        <button className="button secondary" onClick={() => exportBulk("markdown")}>Export Markdown</button>
      </div>
    </section>

    <section className="workspace">
      <aside className="sidebar">
        <div className="section-heading"><div><p className="eyebrow">Filters</p><h2>Agents</h2></div><span className="count">{sorted.length}/{results.length}</span></div>
        <label className="search"><span>⌕</span><input placeholder="Search name or domain" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>

        <div className="filter-group">
          <span className="filter-label">Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as OverallStatus | "all")}>
            <option value="all">All statuses</option>
            {OVERALL_ORDER.map((status) => <option key={status} value={status}>{OVERALL_STATUS_LABELS[status]}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">Queue</span>
          <select value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)}>
            <option value="all">All queues</option>
            {queueNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">Workstream</span>
          <select value={workstreamFilter} onChange={(event) => setWorkstreamFilter(event.target.value)}>
            <option value="all">All workstreams</option>
            {workstreamNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>

        <div className="sidebar-footer"><span className="shield">◇</span><span>Read-only — this tool never creates, updates, or deletes any Dataverse record. Last loaded {lastLoaded}.</span></div>
      </aside>

      <section className="content">
        <div className="content-header">
          <div><p className="eyebrow">Bulk view</p><h2>Agent list</h2><p className="muted">Click an agent to see the full readiness checklist.</p></div>
        </div>
        <div className="agent-table" role="table" aria-label="Agent readiness">
          <div className="agent-table-head" role="row">
            <button role="columnheader" className="sortable" onClick={() => toggleSort("name")}>Agent{sortKey === "name" ? (sortAsc ? " ▲" : " ▼") : ""}</button>
            <button role="columnheader" className="sortable" onClick={() => toggleSort("status")}>Status{sortKey === "status" ? (sortAsc ? " ▲" : " ▼") : ""}</button>
            <button role="columnheader" className="sortable" onClick={() => toggleSort("failed")}>Failed{sortKey === "failed" ? (sortAsc ? " ▲" : " ▼") : ""}</button>
            <button role="columnheader" className="sortable" onClick={() => toggleSort("topIssue")}>Top issue{sortKey === "topIssue" ? (sortAsc ? " ▲" : " ▼") : ""}</button>
          </div>
          {sorted.length ? sorted.map((r) => (
            <button role="row" key={r.agentId} className={`agent-row ${r.agentId === selectedAgentId ? "selected" : ""}`} onClick={() => setSelectedAgentId(r.agentId)}>
              <span role="cell" className="agent-name"><strong>{r.agentName}</strong>{r.domainName && <small>{r.domainName}</small>}</span>
              <span role="cell">{statusPill(r.overallStatus)}</span>
              <span role="cell" className="failed-count">{r.failedCount}</span>
              <span role="cell" className="top-issue-cell">{r.topIssue ?? "—"}</span>
            </button>
          )) : <div className="scenario-empty"><span>◔</span><p>No agents match these filters</p></div>}
        </div>
      </section>

      <aside className="inspector">
        {selected ? <>
          <div className="section-heading"><div><p className="eyebrow">Agent detail</p><h2>{selected.agentName}</h2></div></div>
          {statusPill(selected.overallStatus)}
          {selected.domainName && <p className="muted">{selected.domainName}</p>}
          <div className="detail-export">
            <button className="button secondary" onClick={() => exportDetail("csv")}>Export CSV</button>
            <button className="button secondary" onClick={() => exportDetail("markdown")}>Export Markdown</button>
          </div>
          <div className="checklist">
            {checksByCategory.map((check) => <div className={`check-item ${check.status}`} key={check.category}>
              <div className="check-item-head"><span className="check-category">{CATEGORY_LABELS[check.category]}</span>{checkStatusBadge(check.status)}</div>
              <strong className="check-title">{check.title}</strong>
              <p className="check-evidence">{check.evidence}</p>
              <p className="check-explanation muted">{check.explanation}</p>
              {check.suggestedFix && <p className="check-fix"><strong>Suggested fix:</strong> {check.suggestedFix}</p>}
            </div>)}
          </div>
        </> : <div className="scenario-empty"><span>◇</span><p>No agent selected</p><small>Click a row in the agent list to see its full readiness checklist.</small></div>}
      </aside>
    </section>
  </main>;
}
