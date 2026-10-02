// The model shared by the row-based provisioning tools (Team Builder, User Setup, Queue Membership).
// Each CSV row becomes a PlanItem with a list of actions. An action that's already in place is
// "noChange" and is never written; the rest run in order, and an action whose dependency failed or was
// skipped is skipped too. That makes every tool safe to run again with the same file.

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  message: string;
  line?: number;
  column?: string;
  item?: string;
}

export interface ActionContext {
  // Ids returned by earlier actions of the same item, by action key.
  id(key: string): string;
}

export interface PlannedAction {
  key: string;
  label: string;      // "Create team", "Assign role", "Add to queue", …
  target: string;     // what it's about: a role name, a queue name, …
  status: "todo" | "noChange";
  reason?: string;    // why it's noChange, e.g. "Already assigned"
  dependsOn?: string; // key of an earlier action of the same item
  run?: (ctx: ActionContext) => Promise<string | void>;
}

export interface PlanItem {
  key: string;
  line: number;
  title: string;
  facts: string[];
  actions: PlannedAction[];
}

export interface Plan {
  items: PlanItem[];
  issues: Issue[];
  rowCount: number;
}

export function errorCount(issues: Issue[]): number {
  return issues.filter((i) => i.severity === "error").length;
}

export function actionCounts(plan: Plan): { todo: number; noChange: number } {
  let todo = 0;
  let noChange = 0;
  plan.items.forEach((item) => item.actions.forEach((a) => (a.status === "todo" ? todo++ : noChange++)));
  return { todo, noChange };
}

// --- results ---------------------------------------------------------------------------------------

export type ActionStatus = "done" | "noChange" | "failed" | "skipped";

export interface ActionResult {
  key: string;
  label: string;
  target: string;
  status: ActionStatus;
  id?: string;
  error?: string;
  at?: string;
}

export type ItemOutcome = "done" | "noChange" | "partial" | "failed";

export interface ItemResult {
  key: string;
  title: string;
  outcome: ItemOutcome;
  actions: ActionResult[];
}
