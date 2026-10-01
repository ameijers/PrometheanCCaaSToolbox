import { AssignmentMethod, QueueType, Visibility } from "./queueSchema";

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  message: string;
  line?: number;
  column?: string;
  queue?: string;
}

// One queue from the CSV, after parsing and defaults.
export interface QueueSpec {
  line: number;
  name: string;
  type: QueueType;
  assignmentMethod: AssignmentMethod;
  priority: number;
  visibility: Visibility;
  operatingHours?: string;
  description?: string;
  members: string[]; // sign-in names as written in the CSV
}

export interface ParsedPlan {
  queues: QueueSpec[];
  issues: Issue[];
  rowCount: number;
}

export interface NamedRecord { id: string; name: string; }

export interface UserRecord {
  id: string;
  fullName: string;
  signIn: string;   // domainname
  email?: string;   // internalemailaddress
  disabled: boolean;
}

// What the environment holds, read before review.
export interface Catalog {
  queueNames: string[];        // every queue, any kind — a new name must not collide
  operatingHours: NamedRecord[];
  users: UserRecord[];
}

export interface ResolvedQueue extends QueueSpec {
  refs: { operatingHours?: string; members: UserRecord[] };
}

export interface ResolvedPlan {
  queues: ResolvedQueue[];
  issues: Issue[];
  rowCount: number;
}

export function errorCount(issues: Issue[]): number {
  return issues.filter((i) => i.severity === "error").length;
}

// --- execution results -----------------------------------------------------------------------------

export type StepStatus = "created" | "failed" | "skipped";

export interface StepResult {
  kind: "queue" | "member";
  label: string;
  name: string;
  status: StepStatus;
  id?: string;
  error?: string;
  at?: string;
}

export type QueueOutcome = "created" | "partial" | "failed";

export interface QueueResult {
  name: string;
  queueId?: string;
  outcome: QueueOutcome;
  steps: StepResult[];
  notes: string[];
}
