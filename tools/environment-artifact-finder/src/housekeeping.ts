import { SCAN_SETTINGS } from "./config";
import { CHECKS, CheckId, Finding, RecordRow, Snapshot, normalizeId } from "./model";
import { tableLabel } from "./referenceMap";

// Category B: records with no meaningful "nothing references them" test, judged by age, status and
// ownership instead. Always Low confidence, and shown on their own tab — the reasoning and risk
// are different from the reference-graph findings.

// bulkdeleteoperation.statecode 3 = Completed; statuscode 30/31/32 = Succeeded/Failed/Canceled
// (standard Dataverse option sets).
const BULK_DELETE_COMPLETED = 3;
const BULK_DELETE_STATUS: Record<number, string> = { 30: "Succeeded", 31: "Failed", 32: "Canceled" };

function finding(row: RecordRow, checkId: CheckId, confidenceReason: string, explanation: string, evidence: string[], nextStep: string): Finding {
  const def = CHECKS[checkId];
  return {
    id: `${checkId}:${row.table}:${row.id}`,
    checkId,
    table: row.table,
    recordId: row.id,
    recordName: row.name,
    category: def.category,
    checkType: def.checkType,
    confidence: "low",
    confidenceReason,
    title: def.title,
    explanation,
    evidence,
    nextStep,
    related: [],
    marksDead: false
  };
}

function bulkDeleteFindings(snapshot: Snapshot, now: Date): Finding[] {
  const table = snapshot.tables.bulkdeleteoperation;
  if (!table || table.status !== "ok") return [];
  const threshold = SCAN_SETTINGS.bulkDeleteAgeDays;
  return table.rows.flatMap((row) => {
    if (row.raw.statecode !== BULK_DELETE_COMPLETED || row.raw.isrecurring === true) return [];
    const finishedOn = String(row.raw.modifiedon ?? row.raw.createdon ?? "");
    const finished = Date.parse(finishedOn);
    if (!finished) return [];
    const ageDays = Math.floor((now.getTime() - finished) / 86_400_000);
    if (ageDays <= threshold) return [];
    const status = BULK_DELETE_STATUS[row.raw.statuscode as number] ?? "Completed";
    return [finding(row, "housekeeping.bulkDeleteOld",
      `Age-based housekeeping (older than ${threshold} days), not a reference check.`,
      `Bulk-delete job “${row.name}” finished (${status.toLowerCase()}) ${ageDays} days ago and doesn't recur.`,
      [`Status: ${status}.`, `Last changed: ${finishedOn.slice(0, 10)} (${ageDays} days ago).`, `Recurring: no.`, `Records deleted: ${row.raw.successcount ?? "?"}, failures: ${row.raw.failurecount ?? "?"}.`],
      "Keep it if you still need the job's history or failure details for an audit; otherwise it can be removed in Settings → Data management → Bulk record deletion.")];
  });
}

// Whitespace and case are ignored; anything else (column order, filters) makes a view different.
export function normalizeFetchXml(xml: unknown): string {
  return typeof xml === "string" ? xml.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim().toLowerCase() : "";
}

function userQueryFindings(snapshot: Snapshot): Finding[] {
  const table = snapshot.tables.userquery;
  if (!table || table.status !== "ok") return [];
  const inScope = new Set(SCAN_SETTINGS.userQueryTables);
  const users = snapshot.tables.systemuser;
  const disabledUsers = new Map((users?.status === "ok" ? users.rows : []).filter((u) => u.raw.isdisabled === true).map((u) => [u.id, u.name]));
  const saved = snapshot.tables.savedquery;
  const defaults = new Map<string, RecordRow>();
  (saved?.status === "ok" ? saved.rows : []).filter((v) => v.raw.isdefault === true && (v.raw.querytype === 0 || v.raw.querytype === undefined)).forEach((v) => defaults.set(String(v.raw.returnedtypecode), v));

  const findings: Finding[] = [];
  table.rows.forEach((view) => {
    const entity = String(view.raw.returnedtypecode ?? "");
    if (!inScope.has(entity)) return;
    const onTable = `Personal view on ${tableLabel(entity)} (${entity}).`;
    const ownerId = normalizeId(view.raw._ownerid_value);
    if (ownerId && disabledUsers.has(ownerId)) {
      findings.push(finding(view, "housekeeping.userQueryDisabledOwner",
        "Ownership heuristic: a disabled owner can't use the view, but it may be shared with others.",
        `Saved view “${view.name}” is owned by ${disabledUsers.get(ownerId)}, whose account is disabled.`,
        [onTable, `Owner: ${disabledUsers.get(ownerId)} (disabled).`, "No 'last used' information is available through Dataverse reads."],
        "Check whether it's shared with anyone still active; if so, reassign it to them, otherwise it can be removed."));
    }
    const defaultView = defaults.get(entity);
    if (defaultView && normalizeFetchXml(view.raw.fetchxml) && normalizeFetchXml(view.raw.fetchxml) === normalizeFetchXml(defaultView.raw.fetchxml)) {
      findings.push(finding(view, "housekeeping.userQueryDuplicatesDefault",
        "Content comparison: the query is identical to the default view, ignoring whitespace. Column layout isn't compared.",
        `Saved view “${view.name}” returns exactly what the default “${defaultView.name}” view returns.`,
        [onTable, `Query identical to system view “${defaultView.name}”.`],
        "Ask the owner whether they rely on a different column layout; if not, the default view does the same job."));
    }
    if (!view.active) {
      findings.push(finding(view, "housekeeping.userQueryInactive",
        "State-based: the view is deactivated. The owner may still want it back.",
        `Saved view “${view.name}” is deactivated.`,
        [onTable, "State: deactivated."],
        "Ask the owner whether it's still needed; otherwise it can be removed."));
    }
  });
  return findings;
}

export function housekeepingFindings(snapshot: Snapshot, now: Date): Finding[] {
  return [...bulkDeleteFindings(snapshot, now), ...userQueryFindings(snapshot)];
}
