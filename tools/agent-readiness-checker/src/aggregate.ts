import { runAllChecks } from "./checks";
import { AgentRecord, AgentReadiness, CheckCategory, CheckResult, OverallStatus, ReadinessSummary } from "./model";

// Overall status rule, exactly as specified: any fail => Not ready; else any warn => Warning;
// else any unknown => Not verifiable (pass details are preserved on the individual checks, this
// just reflects that the *overall* picture can't be fully confirmed); else Ready.
export function overallStatus(checks: CheckResult[]): OverallStatus {
  if (checks.some((c) => c.status === "fail")) return "notReady";
  if (checks.some((c) => c.status === "warn")) return "warning";
  if (checks.some((c) => c.status === "unknown")) return "notVerifiable";
  return "ready";
}

// The "top issue" is the first failing check in CHECK_ORDER (diagnosis-funnel order), falling back
// to the first warning, so the bulk view's one-line summary points at the most actionable problem
// rather than just whatever happened to be evaluated last.
function topIssue(checks: CheckResult[]): string | undefined {
  const fail = checks.find((c) => c.status === "fail");
  if (fail) return fail.title;
  const warn = checks.find((c) => c.status === "warn");
  if (warn) return warn.title;
  const unk = checks.find((c) => c.status === "unknown");
  return unk?.title;
}

export function evaluateAgent(agent: AgentRecord): AgentReadiness {
  const checks = runAllChecks(agent);
  return {
    agentId: agent.id,
    agentName: agent.name,
    domainName: agent.domainName,
    overallStatus: overallStatus(checks),
    checks,
    failedCount: checks.filter((c) => c.status === "fail").length,
    warnCount: checks.filter((c) => c.status === "warn").length,
    unknownCount: checks.filter((c) => c.status === "unknown").length,
    topIssue: topIssue(checks)
  };
}

export function evaluateAgents(agents: AgentRecord[]): AgentReadiness[] {
  return agents.map(evaluateAgent);
}

export function summarize(results: AgentReadiness[]): ReadinessSummary {
  const counts: Record<CheckCategory, { title: string; count: number }> = {} as Record<CheckCategory, { title: string; count: number }>;
  results.forEach((result) => {
    result.checks.filter((c) => c.status === "fail").forEach((c) => {
      const entry = counts[c.category] ?? { title: c.title, count: 0 };
      entry.count += 1;
      counts[c.category] = entry;
    });
  });
  const mostCommon = (Object.entries(counts) as [CheckCategory, { title: string; count: number }][])
    .sort((a, b) => b[1].count - a[1].count)[0];

  return {
    total: results.length,
    ready: results.filter((r) => r.overallStatus === "ready").length,
    warning: results.filter((r) => r.overallStatus === "warning").length,
    notReady: results.filter((r) => r.overallStatus === "notReady").length,
    notVerifiable: results.filter((r) => r.overallStatus === "notVerifiable").length,
    mostCommonFailingCheck: mostCommon ? { category: mostCommon[0], title: mostCommon[1].title, count: mostCommon[1].count } : undefined
  };
}
