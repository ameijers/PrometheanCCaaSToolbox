import { AgentReadiness, CATEGORY_LABELS, OVERALL_STATUS_LABELS } from "./model";

// Pure string-building functions, kept separate from the browser-only download trigger below so
// they're testable in plain Node/Jest without a DOM.

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

export function bulkToCsv(results: AgentReadiness[]): string {
  const header = csvRow(["Agent", "Domain name", "Overall status", "Failed", "Warnings", "Not verifiable", "Top issue"]);
  const rows = results.map((r) => csvRow([r.agentName, r.domainName ?? "", OVERALL_STATUS_LABELS[r.overallStatus], r.failedCount, r.warnCount, r.unknownCount, r.topIssue ?? ""]));
  return [header, ...rows].join("\n");
}

export function bulkToMarkdown(results: AgentReadiness[]): string {
  const header = "| Agent | Domain name | Overall status | Failed | Warnings | Not verifiable | Top issue |\n| --- | --- | --- | --- | --- | --- | --- |";
  const rows = results.map((r) => `| ${r.agentName} | ${r.domainName ?? ""} | ${OVERALL_STATUS_LABELS[r.overallStatus]} | ${r.failedCount} | ${r.warnCount} | ${r.unknownCount} | ${r.topIssue ?? ""} |`);
  return [`# Agent readiness — bulk export`, "", header, ...rows].join("\n");
}

export function detailToCsv(result: AgentReadiness): string {
  const header = csvRow(["Category", "Status", "Check", "Evidence", "Explanation", "Suggested fix"]);
  const rows = result.checks.map((c) => csvRow([CATEGORY_LABELS[c.category], c.status, c.title, c.evidence, c.explanation, c.suggestedFix ?? ""]));
  return [csvRow([`Agent: ${result.agentName}`]), csvRow([`Overall status: ${OVERALL_STATUS_LABELS[result.overallStatus]}`]), "", header, ...rows].join("\n");
}

export function detailToMarkdown(result: AgentReadiness): string {
  const header = "| Category | Status | Check | Evidence | Explanation | Suggested fix |\n| --- | --- | --- | --- | --- | --- |";
  const rows = result.checks.map((c) => `| ${CATEGORY_LABELS[c.category]} | ${c.status} | ${c.title} | ${c.evidence.replace(/\|/g, "\\|")} | ${c.explanation.replace(/\|/g, "\\|")} | ${(c.suggestedFix ?? "").replace(/\|/g, "\\|")} |`);
  return [`# ${result.agentName} — readiness detail`, "", `**Overall status:** ${OVERALL_STATUS_LABELS[result.overallStatus]}`, "", header, ...rows].join("\n");
}

// Client-side-only download — no server involved, matching every other export/save-file action in
// this toolbox. Not covered by Jest (testEnvironment is Node, no DOM); the pure functions above,
// which this just writes to a Blob, carry the real test coverage.
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
