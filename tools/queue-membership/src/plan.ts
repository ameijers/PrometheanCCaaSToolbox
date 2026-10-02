import { ParsedCsv } from "../../voice-workstream-builder/src/csv";
import { findOne, readRows } from "../../shared/src/columns";
import { Plan, PlanItem, PlannedAction } from "../../shared/src/model";
import { MembershipCatalog } from "./model";
import { COLUMNS } from "./template";

// Each row adds one user to one or more advanced queues. The user must already be a bookable resource
// (User Setup does that); without one, routing can't assign them work, so that's an error. Queues the
// user is already a member of are "noChange".

export interface MembershipWriter {
  addToQueue(queueId: string, userId: string): Promise<void>;
}

export function buildMembershipPlan(csv: ParsedCsv, catalog: MembershipCatalog, writer: MembershipWriter): Plan {
  const { rows, issues } = readRows(csv, COLUMNS, "user");
  const items: PlanItem[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row) => {
    const wanted = row.cell("user");
    const line = row.line;
    const error = (column: string, message: string) => issues.push({ severity: "error", line, column, item: wanted || undefined, message });
    const warning = (column: string, message: string) => issues.push({ severity: "warning", line, column, item: wanted || undefined, message });
    if (!wanted) return error("user", "user is empty. Every row needs the sign-in name or email of a user.");

    const found = findOne(catalog.users, wanted, (u) => [u.signIn, u.email]);
    if (found.count > 1) return error("user", `${found.count} users match "${wanted}". Use the sign-in name.`);
    const user = found.record;
    if (!user) return error("user", `"${wanted}" isn't in this environment. Set the user up first (synced from Entra ID, then User Setup).`);
    if (user.disabled || !user.interactive) return error("user", `${user.fullName} is disabled or isn't an interactive user.`);
    if (seen.has(user.id)) return error("user", `${user.fullName} is also on line ${seen.get(user.id)}. Put all queues for one user on one row.`);
    seen.set(user.id, line);

    const resource = catalog.resources.find((r) => r.userId === user.id);
    if (!resource) error("user", `${user.fullName} isn't a bookable resource yet, so routing can't assign them work. Run User Setup for this user first.`);
    else if (!resource.active) error("user", `${user.fullName}'s bookable resource is deactivated.`);
    else if (!resource.profileCount) warning("user", `${user.fullName} has no capacity profile, so routing can't assign them work yet. Add one with User Setup.`);

    const queueNames = row.list("queues");
    if (!queueNames.length) error("queues", "queues is empty. List at least one queue.");
    const actions: PlannedAction[] = [];
    queueNames.forEach((name) => {
      const q = findOne(catalog.queues, name, (x) => [x.name]);
      if (q.count > 1) return error("queues", `${q.count} queues are named "${name}".`);
      if (!q.record) return error("queues", `No queue named "${name}" exists.`);
      const queue = q.record;
      if (!queue.advanced) return error("queues", `"${queue.name}" isn't an advanced (unified routing) queue.`);
      if (!queue.active) return error("queues", `"${queue.name}" is deactivated.`);
      actions.push(queue.memberIds.includes(user.id)
        ? { key: `queue:${queue.id}`, label: "Add to queue", target: queue.name, status: "noChange", reason: "Already a member" }
        : { key: `queue:${queue.id}`, label: "Add to queue", target: queue.name, status: "todo", run: async () => { await writer.addToQueue(queue.id, user.id); } });
    });

    items.push({ key: user.id, line, title: user.fullName, facts: [user.signIn, resource ? "Bookable resource" : "Not a bookable resource"], actions: resource && resource.active ? actions : [] });
  });

  return { items, issues, rowCount: csv.records.length };
}
