import { parseCsv } from "../../voice-workstream-builder/src/csv";
import { demoSource, resetDemo } from "../src/demoData";
import { Catalog } from "../src/model";
import { queuePayload } from "../src/payload";
import { resolvePlan } from "../src/resolve";
import { exampleCsv } from "../src/template";
import { validateCsv } from "../src/validate";

let catalog: Catalog;
beforeEach(async () => { resetDemo(); catalog = await demoSource.loadCatalog(); });

const plan = (lines: string[]) => resolvePlan(validateCsv(parseCsv(lines.join("\n"))), catalog);
const errors = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "error");
const warnings = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.severity === "warning");

describe("validate and resolve", () => {
  test("the example resolves against the sample environment; only the member-less queue is flagged", () => {
    const p = resolvePlan(validateCsv(parseCsv(exampleCsv())), catalog);
    expect(errors(p)).toEqual([]);
    expect(warnings(p).map((w) => `${w.queue}:${w.column}`)).toEqual(["Case follow-up:members", "Case follow-up:visibility"]);
    expect(p.queues.map((q) => [q.name, q.type, q.assignmentMethod, q.priority, q.visibility, q.refs.members.length])).toEqual([
      ["Sales – NL", "Voice", "Least active", 1, "Private", 2],
      ["Sales – Priority customers", "Voice", "Highest capacity", 1, "Private", 1],
      ["Support – Overflow", "Voice", "Advanced round robin", 5, "Public", 3],
      ["Support – Chat", "Messaging", "Highest capacity", 2, "Private", 1],
      ["Case follow-up", "Record", "Advanced round robin", 10, "Private", 0]
    ]);
  });

  test("empty cells take the defaults", () => {
    const p = plan(["queue_name,members", "Q,anna@contoso.com"]);
    expect(p.queues[0]).toMatchObject({ type: "Voice", assignmentMethod: "Least active", priority: 1, visibility: "Private", operatingHours: undefined });
  });

  test("values are case-insensitive; headers accept variants", () => {
    const p = plan(["Queue Name,QUEUE-TYPE,assignment method,members", "Q,messaging,highest capacity,ANNA@contoso.com"]);
    expect(errors(p)).toEqual([]);
    expect(p.queues[0]).toMatchObject({ type: "Messaging", assignmentMethod: "Highest capacity" });
    expect(p.queues[0].refs.members[0].fullName).toBe("Anna de Vries");
  });

  test("invalid choices and priorities are errors", () => {
    const p = plan(["queue_name,queue_type,assignment_method,priority,visibility", "A,Email,Custom,0,Hidden", "B,,,high,", "C,,,1.5,"]);
    expect(errors(p).map((e) => `${e.line}:${e.column}`)).toEqual(["2:priority", "2:queue_type", "2:assignment_method", "2:visibility", "3:priority", "4:priority"]);
    expect(errors(p).find((e) => e.column === "assignment_method")!.message).toMatch(/Least active, Highest capacity, Advanced round robin/);
  });

  test("duplicate names in the file and existing queues are errors", () => {
    const p = plan(["queue_name,members", "New,anna@contoso.com", "new,anna@contoso.com", "contoso voice,anna@contoso.com"]);
    expect(errors(p).map((e) => [e.line, e.message.slice(0, 20)])).toEqual([[3, "\"new\" is also on lin"], [4, "A queue named \"conto"]]);
  });

  test("members: by sign-in name or email; unknown, disabled and repeated", () => {
    const p = plan(["queue_name,members", "Q,dana.smit@contoso.com|nobody@contoso.com|eva@contoso.com|anna@contoso.com|Anna@contoso.com"]);
    expect(p.queues[0].refs.members.map((m) => m.fullName)).toEqual(["Dana Smit", "Anna de Vries"]);
    expect(errors(p).map((e) => e.message)).toEqual([
      "No user with sign-in name or email \"nobody@contoso.com\" exists in this environment.",
      "eva@contoso.com (Eva Mulder) is a disabled user."
    ]);
    expect(warnings(p)[0].message).toMatch(/Listed more than once: Anna@contoso.com/);
  });

  test("operating hours must exist", () => {
    const p = plan(["queue_name,operating_hours,members", "Q,Weekends,anna@contoso.com", "R,workdays,anna@contoso.com"]);
    expect(errors(p).map((e) => e.line)).toEqual([2]);
    expect(p.queues[1].refs.operatingHours).toBe(catalog.operatingHours[0].id);
  });

  test("a private queue without members gets two warnings; file-level problems", () => {
    expect(warnings(plan(["queue_name", "Q"])).map((w) => w.column)).toEqual(["members", "visibility"]);
    expect(errors(plan(["name", "Q"]))[0].message).toMatch(/no queue_name column/);
    expect(errors(plan(["queue_name"]))[0].message).toMatch(/no rows/);
  });
});

describe("queuePayload", () => {
  test("an advanced queue with the verified option values", () => {
    const p = plan(["queue_name,queue_type,assignment_method,priority,visibility,operating_hours,description,members", "Q,Voice,Advanced round robin,3,Public,Workdays,Hello,anna@contoso.com"]);
    expect(queuePayload(p.queues[0])).toEqual({
      name: "Q",
      msdyn_isomnichannelqueue: true,
      msdyn_queuetype: 192350002,
      msdyn_assignmentstrategy: 192350001,
      msdyn_priority: 3,
      queueviewtype: 0,
      description: "Hello",
      "msdyn_operatinghourid@odata.bind": `/msdyn_operatinghours(${catalog.operatingHours[0].id})`
    });
  });

  test("defaults map to Voice, Least active (Longest Idle), Private", () => {
    const payload = queuePayload(plan(["queue_name", "Q"]).queues[0]);
    expect(payload).toMatchObject({ msdyn_queuetype: 192350002, msdyn_assignmentstrategy: 192350003, queueviewtype: 1, msdyn_priority: 1 });
    expect(payload).not.toHaveProperty("msdyn_operatinghourid@odata.bind");
    expect(payload).not.toHaveProperty("description");
  });
});
