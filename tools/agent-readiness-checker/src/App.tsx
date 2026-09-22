import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { evaluateAgents, summarize } from "./aggregate";
import { DEFAULT_ROLE_GROUPS, ROLE_GROUP_SUGGESTION_KEYWORDS, RoleGroup, RoleSelection, matchesRoleGroup, setActiveAgentRoleNames } from "./config";
import { DEMO_AGENTS } from "./demoData";
import { loadAgentRoster, loadAllRoles, loadCurrentUserDomain } from "./dataverse";
import { bulkToCsv, bulkToMarkdown, detailToCsv, detailToMarkdown, downloadTextFile } from "./export";
import { AgentReadiness, AgentRecord, CATEGORY_LABELS, CHECK_ORDER, CheckStatus, OVERALL_STATUS_LABELS, OverallStatus } from "./model";

interface RoleInfo { roleId: string; name: string; }

// Remembers the person's role picks in this browser so they aren't re-asked every session — scoped
// automatically per Dataverse org, since this web resource is served from (and localStorage is
// scoped to) that org's own origin. Never assumed to still be valid without checking against a fresh
// live role list first (see connect()) — roles can be renamed or deleted after the fact.
const ROLE_SELECTION_STORAGE_KEY = "agentReadinessChecker.roleSelection.v1";

function loadSavedSelection(): RoleSelection | undefined {
  try {
    const raw = window.localStorage.getItem(ROLE_SELECTION_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as RoleSelection : undefined;
  } catch {
    return undefined;
  }
}

function saveSelection(selection: RoleSelection): void {
  try { window.localStorage.setItem(ROLE_SELECTION_STORAGE_KEY, JSON.stringify(selection)); } catch { /* not fatal — the picker still works this session, it just won't be remembered next time */ }
}

// Security roles are business-unit-scoped in Dataverse — every business unit gets its own copy of
// each role, sharing the same name but a distinct roleid — so the `role` table this tool reads can
// (and, live, did) contain several rows for what a person thinks of as one role, e.g. four
// "Customer Service Agent" rows in a four-business-unit environment. RoleSelection therefore stores
// a role NAME per group, not a specific roleid: the name is the stable, business-unit-independent
// thing the person is actually choosing, and resolveRoleIds (below) expands it back to every
// business unit's copy at query time — otherwise picking one specific roleid would silently miss
// every candidate whose role happens to be the copy from a different business unit.
function distinctRoleNames(roles: RoleInfo[]): string[] {
  return [...new Set(roles.map((r) => r.name))];
}

// Picks one likely-relevant role name per group as a starting point for the person to review. Tries
// DEFAULT_ROLE_GROUPS's named candidates first, in order (e.g. "Omnichannel Agent" before the more
// generic "Customer Service Agent") — an exact, case-insensitive name match is a stronger signal than
// a substring, so it takes priority over the alphabetically-first result the loose keyword match would
// otherwise pick (which skews toward whichever unrelated role happens to sort first, e.g. a "Customer
// Service ..." role alphabetically preceding the actually-relevant "Omnichannel ..." one). Only when
// none of a group's named candidates exist live does it fall back to config.ts's
// ROLE_GROUP_SUGGESTION_KEYWORDS substring match, which is what actually survives a renamed/cloned
// role (e.g. "D365CC-Omnichannel-Supervisor" still contains "supervisor" — see IMPLEMENTATION_STATUS.md
// "Round 9"). Applied immediately so "Connect" only takes one click, but always shown afterward via the
// notice so the person knows to double-check it via "Configure roles…" rather than assuming it's
// guaranteed correct.
function suggestSelection(roles: RoleInfo[]): RoleSelection {
  const selection: RoleSelection = {};
  DEFAULT_ROLE_GROUPS.forEach((group) => {
    const named = group.roleNames
      .map((candidate) => roles.find((r) => r.name.toLowerCase() === candidate.toLowerCase()))
      .find((match): match is RoleInfo => !!match);
    const keyword = ROLE_GROUP_SUGGESTION_KEYWORDS[group.key];
    const match = named ?? (keyword ? roles.find((r) => r.name.toLowerCase().includes(keyword)) : undefined);
    if (match) selection[group.key] = match.name;
  });
  return selection;
}

function roleGroupsFromSelection(selection: RoleSelection): RoleGroup[] {
  return DEFAULT_ROLE_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    roleNames: selection[group.key] ? [selection[group.key]] : []
  }));
}

// Every roleid across every business unit that shares one of the selected names — what actually
// gets sent to dataverse.ts, since role assignment itself is still by specific roleid.
function resolveRoleIds(roles: RoleInfo[], selection: RoleSelection): string[] {
  const names = new Set(Object.values(selection).filter(Boolean));
  return roles.filter((r) => names.has(r.name)).map((r) => r.roleId);
}

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

function emailDomain(domainName: string | undefined): string | undefined {
  return domainName?.split("@")[1]?.toLowerCase();
}

// Fallback "home domain" for the Agent-list name-sort grouping (see homeDomain below), used only when
// the live connected-user lookup (dataverse.ts's loadCurrentUserDomain) isn't available — demo mode,
// or any failure of that lookup. The most-common-domain-among-the-roster heuristic was this tool's
// first attempt at this feature (Round 16) and is noticeably less reliable live: a roster mixing real
// agents with application/service accounts (Copilot IVR bots, routing apps, etc., which often share
// one Dataverse-generated synthetic domain) can have those non-interactive accounts outnumber real
// human agents and skew a pure-frequency guess toward the wrong "home".
function majorityDomain(agents: { domainName?: string }[]): string | undefined {
  const counts = new Map<string, number>();
  agents.forEach((a) => {
    const domain = emailDomain(a.domainName);
    if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  });
  let best: string | undefined;
  let bestCount = 0;
  counts.forEach((count, domain) => { if (count > bestCount) { best = domain; bestCount = count; } });
  return best;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// True if this agent should be shown given which role-group checkboxes are checked. Checking none
// of them is treated as "no filter" (show everyone) rather than "show nobody" — an empty selection
// reading as "hide everything" would be a confusing trap, not a useful state. An agent whose roles
// couldn't be read is always shown regardless of the filter — "don't know" must never silently look
// like "doesn't match any checked group".
function matchesRoleGroupFilter(agent: AgentRecord | undefined, checkedKeys: Set<string>, activeRoleGroups: RoleGroup[]): boolean {
  if (checkedKeys.size === 0) return true;
  if (!agent || !agent.securityRoles.known) return true;
  const roles = agent.securityRoles.value;
  return activeRoleGroups.some((group) => checkedKeys.has(group.key) && matchesRoleGroup(roles, group));
}

const PAGE_SIZE = 5;

export function App(): React.ReactElement {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [message, setMessage] = useState("Demo data is shown until a Dataverse connection is available.");
  const [agents, setAgents] = useState<AgentRecord[]>(DEMO_AGENTS);
  const [lastLoaded, setLastLoaded] = useState<string>(timestamp());
  // The connected user's own email domain — the preferred reference point for grouping the Agent-list
  // name sort (see App.tsx's homeDomain below and dataverse.ts's loadCurrentUserDomain). undefined in
  // demo mode (no live session to ask) and on any live lookup failure — either way the sort falls back
  // to majorityDomain() rather than breaking.
  const [connectedUserDomain, setConnectedUserDomain] = useState<string | undefined>(undefined);

  // Every real security role in the connected environment (id + name), the person's current
  // Agent/Supervisor/Admin picks among them (by role id — see config.ts's RoleSelection), and the
  // live-resolved RoleGroup[] (role NAMES, not ids) those picks translate to — the latter is what
  // actually drives the "Security roles" check and the sidebar's role-group filter. Defaults to
  // DEFAULT_ROLE_GROUPS so demo mode (which never goes through the picker) behaves the same as
  // before a live connection exists.
  const [allRoles, setAllRoles] = useState<RoleInfo[]>([]);
  const [roleSelection, setRoleSelection] = useState<RoleSelection>({});
  const [activeRoleGroups, setActiveRoleGroups] = useState<RoleGroup[]>(DEFAULT_ROLE_GROUPS);
  // The picker is a modal (see the "Configure roles…" link in the sidebar) — it edits its own draft
  // copy of the selection so Cancel discards changes cleanly, and only touches roleSelection (and
  // reloads the roster) once "Save & load agents" is clicked.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftSelection, setDraftSelection] = useState<RoleSelection>({});

  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OverallStatus | "all">("all");
  const [queueFilter, setQueueFilter] = useState<string>("all");
  const [workstreamFilter, setWorkstreamFilter] = useState<string>("all");
  // Which role groups (Agent / Supervisor / Omnichannel Admin) to show. Defaults to all of them
  // checked, matching the roster this tool loads in the first place (see dataverse.ts's
  // candidate-set query) — unchecking one narrows the list further. Group keys are stable regardless
  // of live vs. demo mode, so DEFAULT_ROLE_GROUPS is a safe source for them here even though the
  // underlying role NAMES (activeRoleGroups, above) can differ once connected.
  const [roleGroupFilter, setRoleGroupFilter] = useState<Set<string>>(() => new Set(DEFAULT_ROLE_GROUPS.map((g) => g.key)));
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);

  const results = useMemo(() => evaluateAgents(agents), [agents]);
  const homeDomain = useMemo(() => connectedUserDomain ?? majorityDomain(agents), [connectedUserDomain, agents]);

  const queueNames = useMemo(() => distinctSorted(agents.flatMap((a) => (a.queueMemberships.known ? a.queueMemberships.value.map((m) => m.queueName) : []))), [agents]);
  const workstreamNames = useMemo(() => distinctSorted(agents.flatMap((a) => (a.queueMemberships.known ? a.queueMemberships.value.flatMap((m) => m.reachingWorkstreamNames) : []))), [agents]);

  // Every filter EXCEPT the status filter itself — used to compute the summary strip's counts, so
  // clicking a count tile can act as a status filter without the strip's own numbers changing
  // underneath the click (if it filtered by the active status too, every other tile would drop to 0
  // the moment one was selected, which reads as "broken" rather than "filtered").
  const filteredExceptStatus = useMemo(() => {
    return results.filter((r) => {
      const agent = agents.find((a) => a.id === r.agentId);
      if (!matchesRoleGroupFilter(agent, roleGroupFilter, activeRoleGroups)) return false;
      if (searchQuery && !r.agentName.toLowerCase().includes(searchQuery.toLowerCase()) && !(r.domainName ?? "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
      const memberships = agent?.queueMemberships.known ? agent.queueMemberships.value : [];
      if (queueFilter !== "all" && !memberships.some((m) => m.queueName === queueFilter)) return false;
      if (workstreamFilter !== "all" && !memberships.some((m) => m.reachingWorkstreamNames.includes(workstreamFilter))) return false;
      return true;
    });
  }, [results, agents, searchQuery, queueFilter, workstreamFilter, roleGroupFilter, activeRoleGroups]);

  // The summary strip's counts and "most common failing check" describe this same set — the search
  // box, and the queue/workstream/role-group filters, not the full unfiltered roster — so the numbers
  // above the table always add up to what the table actually shows below them.
  const summary = useMemo(() => summarize(filteredExceptStatus), [filteredExceptStatus]);

  const filtered = useMemo(() => filteredExceptStatus.filter((r) => statusFilter === "all" || r.overallStatus === statusFilter), [filteredExceptStatus, statusFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        // Same-domain-as-the-roster's-majority agents first (alphabetically), everyone from a
        // different domain after (also alphabetically) — see majorityDomain's comment above.
        const aOther = homeDomain && emailDomain(a.domainName) && emailDomain(a.domainName) !== homeDomain ? 1 : 0;
        const bOther = homeDomain && emailDomain(b.domainName) && emailDomain(b.domainName) !== homeDomain ? 1 : 0;
        cmp = aOther !== bOther ? aOther - bOther : a.agentName.localeCompare(b.agentName);
      }
      else if (sortKey === "status") cmp = OVERALL_ORDER.indexOf(a.overallStatus) - OVERALL_ORDER.indexOf(b.overallStatus);
      else if (sortKey === "failed") cmp = a.failedCount - b.failedCount;
      else if (sortKey === "topIssue") cmp = (a.topIssue ?? "").localeCompare(b.topIssue ?? "");
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortAsc, homeDomain]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paged = useMemo(() => sorted.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE), [sorted, currentPage]);
  // Any change to what's included/how it's ordered can move the current page out of range (or
  // just make "page 3" mean something different) — snap back to page 1 whenever that happens.
  useEffect(() => { setPage(0); }, [searchQuery, statusFilter, queueFilter, workstreamFilter, roleGroupFilter, sortKey, sortAsc]);

  const selected = results.find((r) => r.agentId === selectedAgentId);
  useEffect(() => { if (selectedAgentId && !results.some((r) => r.agentId === selectedAgentId)) setSelectedAgentId(undefined); }, [results, selectedAgentId]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) { setSortAsc((asc) => !asc); return; }
    setSortKey(key);
    setSortAsc(true);
  }

  // Loads the roster for a specific role selection, against a specific live role list — used by
  // connect() (with either a remembered or a freshly-suggested selection), by "Refresh" (reusing
  // whatever's already active), and by the "Configure roles…" modal's "Save & load agents". State is
  // only committed once the load has actually succeeded (everything below the await) — otherwise a
  // failed load would leave role-group state pointing at a new selection while `agents` silently
  // stayed on the old (possibly still-demo) roster, mismatching the two.
  async function applySelectionAndLoad(roles: RoleInfo[], selection: RoleSelection, isSuggestion = false) {
    setLoading(true);
    setProgressMessage("Loading agents…");
    try {
      const relevantRoleIds = resolveRoleIds(roles, selection);
      const { agents: roster } = await loadAgentRoster(relevantRoleIds, (progress) => setProgressMessage(progress.message));
      const groups = roleGroupsFromSelection(selection);
      setActiveRoleGroups(groups);
      // Lets checks.ts's pure, parameter-only checkSecurityRoles keep comparing against the live
      // selection without needing Dataverse/picker awareness of its own — see config.ts.
      setActiveAgentRoleNames(groups.find((g) => g.key === "agent")?.roleNames ?? []);
      setAgents(roster);
      setLastLoaded(timestamp());
      saveSelection(selection);
      setRoleSelection(selection);
      setPickerOpen(false);
      if (roster.length) {
        setMessage(isSuggestion ? "Connected using suggested roles — click “Configure roles…” in the sidebar if this doesn't look right." : "Connected. Reading is read-only; no data is modified.");
      } else {
        setMessage("No one matched the selected roles, directly or via a team — click “Configure roles…” in the sidebar to adjust.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read this Dataverse environment.");
    } finally {
      setLoading(false);
      setProgressMessage("");
    }
  }

  // One click connects and loads the roster — using a remembered selection if one still matches a
  // real role in this environment, otherwise the best keyword-based suggestion applied right away
  // (never a forced review step first; the notice above just nudges toward "Configure roles…" so an
  // imperfect guess is easy to notice and fix, not silently trusted). Reconciled per GROUP, not as one
  // all-or-nothing choice between "the whole saved object" and "the whole suggestion": a saved
  // selection from an earlier, less-informed session (or one where only one group was ever picked)
  // could otherwise permanently shadow a better default for every other group, since any single still-
  // valid saved name used to be enough to make the entire saved object win over a fresh suggestion.
  function reconcileSelection(saved: RoleSelection | undefined, roles: RoleInfo[]): { selection: RoleSelection; anySuggested: boolean } {
    const suggested = suggestSelection(roles);
    const selection: RoleSelection = {};
    let anySuggested = false;
    DEFAULT_ROLE_GROUPS.forEach((group) => {
      const savedName = saved?.[group.key];
      const savedStillValid = !!savedName && roles.some((r) => r.name === savedName);
      if (savedStillValid) {
        selection[group.key] = savedName!;
      } else if (suggested[group.key]) {
        selection[group.key] = suggested[group.key];
        anySuggested = true;
      }
    });
    return { selection, anySuggested };
  }

  async function connect() {
    setLoading(true);
    setProgressMessage("Connecting to the current Dataverse session…");
    setMessage("");
    try {
      // Independent reads — run in parallel. The user-domain lookup is best-effort (see
      // loadCurrentUserDomain's comment): its own failure is swallowed there, never here, so it can
      // never block a connection that would otherwise succeed.
      const [roles, userDomain] = await Promise.all([loadAllRoles(), loadCurrentUserDomain()]);
      setAllRoles(roles);
      setConnectedUserDomain(userDomain);
      setConnected(true);
      const { selection, anySuggested } = reconcileSelection(loadSavedSelection(), roles);
      await applySelectionAndLoad(roles, selection, anySuggested);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read this Dataverse environment.");
      setLoading(false);
      setProgressMessage("");
    }
  }

  async function refresh() {
    if (!connected) return;
    await applySelectionAndLoad(allRoles, roleSelection);
  }

  function openRolePicker() {
    setDraftSelection(roleSelection);
    setPickerOpen(true);
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

  // The inspector's "Needs attention" list — every non-pass check (fail/warn/unknown all carry a
  // suggestedFix; see model.ts's CheckResult comment), so this is a short, purely actionable subset of
  // checksByCategory rather than a second copy of its full evidence (which the checklist below already
  // shows in full) — see IMPLEMENTATION_STATUS.md "Round 18" for why the panel changed shape.
  const attentionChecks = useMemo(() => checksByCategory.filter((c) => c.status !== "pass"), [checksByCategory]);

  // Deduplicated for the picker's dropdowns — allRoles itself can contain the same role name several
  // times (once per business unit; see distinctRoleNames's comment above).
  const roleNameOptions = useMemo(() => distinctRoleNames(allRoles), [allRoles]);

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

    {pickerOpen && <div className="modal-backdrop" onClick={() => setPickerOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Configure roles" onClick={(event) => event.stopPropagation()}>
        <div className="content-header">
          <div>
            <p className="eyebrow">Setup</p>
            <h2>Which role means Agent / Supervisor / Omnichannel Admin?</h2>
            <p className="muted">
              Pick the one real security role in this environment each represents — these are fetched live, nothing here is guessed.
              This includes anyone holding a picked role either directly or via a Dataverse Team it's assigned to. Your picks are remembered in this browser.
            </p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={() => setPickerOpen(false)}>×</button>
        </div>
        <div className="role-picker-fields">
          {DEFAULT_ROLE_GROUPS.map((group) => (
            <div className="filter-group" key={group.key}>
              <span className="filter-label">{group.label}</span>
              <select
                value={draftSelection[group.key] ?? ""}
                onChange={(event) => setDraftSelection((current) => {
                  const next = { ...current };
                  if (event.target.value) next[group.key] = event.target.value; else delete next[group.key];
                  return next;
                })}
              >
                <option value="">— none —</option>
                {roleNameOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="role-picker-actions">
          <button className="button secondary" onClick={() => setPickerOpen(false)}>Cancel</button>
          <button className="button primary" onClick={() => applySelectionAndLoad(allRoles, draftSelection)} disabled={loading}>{loading ? "Loading…" : "Save & load agents"}</button>
        </div>
      </div>
    </div>}

    <section className="summary-strip">
      <p className="summary-caption">
        Status of <strong>{summary.total}</strong> agent{summary.total === 1 ? "" : "s"}{searchQuery || queueFilter !== "all" || workstreamFilter !== "all" || roleGroupFilter.size < DEFAULT_ROLE_GROUPS.length ? " matching your current search/filters" : ""} — click a count to filter the list below.
      </p>
      <div className="summary-tiles">
        {(["ready", "warning", "notReady", "notVerifiable"] as const).map((status) => (
          <button
            key={status}
            type="button"
            className={`stat-tile ${status} ${statusFilter === status ? "active" : ""}`}
            onClick={() => setStatusFilter((current) => (current === status ? "all" : status))}
            aria-pressed={statusFilter === status}
          >
            <strong>{summary[status]}</strong><span>{OVERALL_STATUS_LABELS[status]}</span>
          </button>
        ))}
        <div className="stat-tile top-issue">
          <span className="eyebrow">Most common failing check</span>
          <strong>{summary.mostCommonFailingCheck ? `${summary.mostCommonFailingCheck.title} (${summary.mostCommonFailingCheck.count})` : "None — no failing checks"}</strong>
        </div>
        <div className="summary-actions">
          <button className="button secondary" onClick={refresh} disabled={loading || !connected}>Refresh</button>
          <button className="button secondary" onClick={() => exportBulk("csv")}>Export CSV</button>
          <button className="button secondary" onClick={() => exportBulk("markdown")}>Export Markdown</button>
        </div>
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
        <div className="filter-group">
          <span className="filter-label">Role</span>
          {DEFAULT_ROLE_GROUPS.map((group) => (
            <label className="checkbox-field" key={group.key}>
              <input
                type="checkbox"
                checked={roleGroupFilter.has(group.key)}
                onChange={(event) => setRoleGroupFilter((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(group.key); else next.delete(group.key);
                  return next;
                })}
              />
              <span>{group.label}</span>
            </label>
          ))}
          {connected && <button className="link-button" onClick={openRolePicker}>Configure roles…</button>}
        </div>

        <div className="sidebar-footer"><span className="shield">◇</span><span>Read-only — this tool never creates, updates, or deletes any Dataverse record. Last loaded {lastLoaded}.</span></div>
      </aside>

      <section className="content">
        <div className="content-header">
          <div><p className="eyebrow">Bulk view</p><h2>Agent list</h2><p className="muted">Click an agent to see their information and full readiness checklist below.</p></div>
        </div>
        <div className="agent-table" role="table" aria-label="Agent readiness">
          <div className="agent-table-head" role="row">
            <button role="columnheader" className="sortable" onClick={() => toggleSort("name")}>Agent{sortKey === "name" ? (sortAsc ? " ▲" : " ▼") : ""}</button>
            <button role="columnheader" className="sortable" onClick={() => toggleSort("status")}>Status{sortKey === "status" ? (sortAsc ? " ▲" : " ▼") : ""}</button>
            <button role="columnheader" className="sortable" onClick={() => toggleSort("failed")}>Failed{sortKey === "failed" ? (sortAsc ? " ▲" : " ▼") : ""}</button>
            <button role="columnheader" className="sortable" onClick={() => toggleSort("topIssue")}>Top issue{sortKey === "topIssue" ? (sortAsc ? " ▲" : " ▼") : ""}</button>
          </div>
          {paged.length ? paged.map((r) => (
            <button role="row" key={r.agentId} className={`agent-row ${r.agentId === selectedAgentId ? "selected" : ""}`} onClick={() => setSelectedAgentId(r.agentId)}>
              <span role="cell" className="agent-name"><strong>{r.agentName}</strong>{r.domainName && <small>{r.domainName}</small>}</span>
              <span role="cell">{statusPill(r.overallStatus)}</span>
              <span role="cell" className="failed-count">{r.failedCount}</span>
              <span role="cell" className="top-issue-cell">{r.topIssue ?? "—"}</span>
            </button>
          )) : <div className="scenario-empty"><span>◔</span><p>No agents match these filters</p></div>}
        </div>
        {sorted.length > 0 && <div className="pagination">
          <button className="button secondary" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={currentPage === 0}>◀ Prev</button>
          <span className="pagination-status">Page {currentPage + 1} of {totalPages} ({sorted.length} agent{sorted.length === 1 ? "" : "s"})</span>
          <button className="button secondary" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}>Next ▶</button>
        </div>}

        {selected && <div className="outcome-panel">
          <div className="content-header">
            <div><p className="eyebrow">Outcome</p><h2>{selected.agentName} — readiness checklist</h2></div>
            <div className="detail-export">
              <button className="button secondary" onClick={() => exportDetail("csv")}>Export CSV</button>
              <button className="button secondary" onClick={() => exportDetail("markdown")}>Export Markdown</button>
            </div>
          </div>
          <div className="checklist">
            {checksByCategory.map((check) => <div className={`check-item ${check.status}`} key={check.category}>
              <div className="check-item-head"><span className="check-category">{CATEGORY_LABELS[check.category]}</span>{checkStatusBadge(check.status)}</div>
              <strong className="check-title">{check.title}</strong>
              {check.evidenceItems?.length ? <ul className="check-evidence-list">{check.evidenceItems.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="check-evidence">{check.evidence}</p>}
              {check.suggestedFix && <p className="check-fix"><strong>Suggested fix:</strong> {check.suggestedFix}</p>}
              <details className="check-why"><summary>Why this matters</summary><p className="muted">{check.explanation}</p></details>
            </div>)}
          </div>
        </div>}
      </section>

      <aside className="inspector">
        {selected ? <>
          <p className="eyebrow">Agent information</p>
          <div className="agent-card">
            <span className="agent-avatar" aria-hidden="true">{initialsOf(selected.agentName)}</span>
            <div className="agent-card-meta">
              <h2>{selected.agentName}</h2>
              {selected.domainName && <p className="agent-domain">{selected.domainName}</p>}
            </div>
          </div>
          <div className="agent-status-row">
            {statusPill(selected.overallStatus)}
            {selected.failedCount > 0 && <span className="mini-count fail">{selected.failedCount} failed</span>}
            {selected.warnCount > 0 && <span className="mini-count warn">{selected.warnCount} warning</span>}
            {selected.unknownCount > 0 && <span className="mini-count unknown">{selected.unknownCount} unverifiable</span>}
          </div>
          <p className="eyebrow inspector-section-heading">Needs attention</p>
          {attentionChecks.length ? <div className="agent-info-list">
            {attentionChecks.map((check) => <div className={`agent-info-row ${check.status}`} key={check.category}>
              <span className={`agent-info-status ${check.status}`} aria-hidden="true">{STATUS_ICON[check.status]}</span>
              <div className="agent-info-body">
                <span className="agent-info-label">{CATEGORY_LABELS[check.category]}</span>
                <span className="agent-info-title">{check.title}</span>
                {check.suggestedFix && <p className="agent-info-fix"><strong>Suggested fix:</strong> {check.suggestedFix}</p>}
              </div>
            </div>)}
          </div> : <p className="agent-info-clear"><span aria-hidden="true">✓</span> No action needed — every check passes.</p>}
        </> : <div className="scenario-empty"><span>◇</span><p>No agent selected</p><small>Click a row in the agent list to see their information here, and their full readiness checklist below.</small></div>}
      </aside>
    </section>
  </main>;
}
