import { Catalog, Issue, ParsedPlan, ResolvedPlan, ResolvedQueue, UserRecord } from "./model";

// Matches every name in the parsed CSV to what the environment holds: operating hours by name, members
// by sign-in name (or email), and new queue names against every existing queue. Pure.

export function resolvePlan(parsed: ParsedPlan, catalog: Catalog): ResolvedPlan {
  const issues: Issue[] = [...parsed.issues];
  const existing = new Set(catalog.queueNames.map((n) => n.trim().toLowerCase()));

  const queues: ResolvedQueue[] = parsed.queues.map((q) => {
    const error = (column: string, message: string) => issues.push({ severity: "error", line: q.line, column, queue: q.name, message });
    const refs: ResolvedQueue["refs"] = { members: [] };

    if (existing.has(q.name.trim().toLowerCase())) error("queue_name", `A queue named "${q.name}" already exists. This tool only creates new queues; rename the row or remove it.`);

    if (q.operatingHours) {
      const matches = catalog.operatingHours.filter((h) => h.name.trim().toLowerCase() === q.operatingHours!.trim().toLowerCase());
      if (matches.length === 1) refs.operatingHours = matches[0].id;
      else if (matches.length > 1) error("operating_hours", `${matches.length} operating hours records are named "${q.operatingHours}", so it's not clear which one is meant.`);
      else error("operating_hours", `No operating hours named "${q.operatingHours}" exist in this environment.`);
    }

    q.members.forEach((member) => {
      const wanted = member.toLowerCase();
      const bySignIn = catalog.users.filter((u) => u.signIn.toLowerCase() === wanted);
      const matches: UserRecord[] = bySignIn.length ? bySignIn : catalog.users.filter((u) => u.email?.toLowerCase() === wanted);
      if (!matches.length) error("members", `No user with sign-in name or email "${member}" exists in this environment.`);
      else if (matches.length > 1) error("members", `${matches.length} users match "${member}". Use their sign-in name.`);
      else if (matches[0].disabled) error("members", `${member} (${matches[0].fullName}) is a disabled user.`);
      else refs.members.push(matches[0]);
    });

    return { ...q, refs };
  });

  return { queues, issues, rowCount: parsed.rowCount };
}
