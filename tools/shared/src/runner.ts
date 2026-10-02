import { toCsv } from "../../voice-workstream-builder/src/csv";
import { RUN_HEADERS, RunInfo, logTime, runColumns } from "../../voice-workstream-builder/src/runLog";
import { ActionResult, ActionStatus, Issue, ItemOutcome, ItemResult, Plan } from "./model";

// Runs a plan item by item, action by action. "noChange" actions are reported, never run. An action
// whose dependency didn't succeed is skipped; independent actions still run, so one failed role
// doesn't stop the queue memberships of the same row. Nothing is ever deleted.

export interface RunProgress {
  done: number;
  total: number;
  message: string;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

function outcomeOf(actions: ActionResult[]): ItemOutcome {
  const did = actions.some((a) => a.status === "done");
  const bad = actions.some((a) => a.status === "failed" || a.status === "skipped");
  if (!bad) return did ? "done" : "noChange";
  return did ? "partial" : "failed";
}

export async function runPlan(plan: Plan, onProgress?: (p: RunProgress) => void): Promise<ItemResult[]> {
  const total = plan.items.reduce((n, i) => n + i.actions.filter((a) => a.status === "todo").length, 0);
  let done = 0;
  const results: ItemResult[] = [];

  for (const item of plan.items) {
    const ids = new Map<string, string>();
    const statuses = new Map<string, ActionStatus>();
    const actions: ActionResult[] = [];
    for (const action of item.actions) {
      const base = { key: action.key, label: action.label, target: action.target };
      if (action.status === "noChange") {
        actions.push({ ...base, status: "noChange", error: action.reason });
        statuses.set(action.key, "noChange");
        continue;
      }
      const dependency = action.dependsOn ? statuses.get(action.dependsOn) : undefined;
      if (action.dependsOn && dependency !== "done" && dependency !== "noChange") {
        actions.push({ ...base, status: "skipped", error: "Not done because an earlier step of this row didn't succeed." });
        statuses.set(action.key, "skipped");
        done++;
        continue;
      }
      onProgress?.({ done, total, message: `${item.title}: ${action.label.toLowerCase()} ${action.target}` });
      try {
        const id = await action.run!({ id: (key) => { const v = ids.get(key); if (!v) throw new Error(`Internal: ${key} has no id.`); return v; } });
        if (id) ids.set(action.key, id);
        actions.push({ ...base, status: "done", id: id || undefined, at: new Date().toISOString() });
        statuses.set(action.key, "done");
      } catch (error) {
        actions.push({ ...base, status: "failed", error: errorMessage(error), at: new Date().toISOString() });
        statuses.set(action.key, "failed");
      }
      done++;
    }
    results.push({ key: item.key, title: item.title, outcome: outcomeOf(actions), actions });
  }
  onProgress?.({ done: total, total, message: "Done" });
  return results;
}

// --- log -------------------------------------------------------------------------------------------

const STATUS: Record<ActionStatus, string> = { done: "Done", noChange: "Already in place", failed: "Failed", skipped: "Skipped" };
const OUTCOME: Record<ItemOutcome, string> = { done: "Done", noChange: "Nothing to do", partial: "Partly done", failed: "Not done" };

export function runLogCsv(results: ItemResult[], issues: Issue[], run: RunInfo, itemLabel: string): string {
  const base = runColumns(run);
  const rows: string[][] = [];
  results.forEach((r) => r.actions.forEach((a) => rows.push([...base, r.title, OUTCOME[r.outcome], a.label, a.target, STATUS[a.status], a.id ?? "", logTime(a.at), a.error ?? ""])));
  issues.filter((i) => i.severity === "warning").forEach((i) => rows.push([...base, i.item ?? "", "", "Review warning", i.column ?? "", "", "", "", `${i.line ? `Line ${i.line}: ` : ""}${i.message}`]));
  return toCsv([...RUN_HEADERS, itemLabel, "Outcome", "Action", "Target", "Status", "Record id", "Time", "Details"], rows);
}

export function issuesToCsv(issues: Issue[], itemLabel: string): string {
  return toCsv(["Severity", "Line", "Column", itemLabel, "Problem"], issues.map((i) => [i.severity === "error" ? "Error" : "Warning", i.line ? String(i.line) : "", i.column ?? "", i.item ?? "", i.message]));
}
