import { parseCsv } from "../src/csv";
import { demoSource, resetDemo } from "../src/demoData";
import { Catalog } from "../src/model";
import { resolvePlan } from "../src/resolve";
import { templateCsv } from "../src/template";
import { validateCsv } from "../src/validate";

let catalog: Catalog;
beforeEach(async () => { resetDemo(); catalog = await demoSource.loadCatalog(); });

function resolve(lines: string[]) {
  return resolvePlan(validateCsv(parseCsv(lines.join("\n"))), catalog);
}
const errors = (plan: ReturnType<typeof resolve>) => plan.issues.filter((i) => i.severity === "error");
const warnings = (plan: ReturnType<typeof resolve>) => plan.issues.filter((i) => i.severity === "warning");

describe("resolvePlan", () => {
  test("the example against the sample environment: everything resolves, only the channel-less workstream is flagged", () => {
    const plan = resolvePlan(validateCsv(parseCsv(templateCsv())), catalog);
    expect(errors(plan)).toEqual([]);
    expect(warnings(plan).map((w) => w.workstream)).toEqual(["Escalations – Voice"]);
    const sales = plan.workstreams[0];
    expect(sales.refs.defaultQueue).toBe(catalog.queues[0].id);
    expect(sales.refs.capacityProfile?.name).toBe("Default voice inbound");
    expect(sales.channels[0].refs).toMatchObject({ phoneNumber: catalog.phoneNumbers[0].id, language: { localeCode: "nl-NL" } });
    expect(sales.channels[0].refs.holdMusic).toBeDefined();
    expect(plan.workstreams[2].refs.capacityProfile).toBeUndefined(); // Unit capacity
    expect(plan.workstreams[3].refs.capacityProfile?.name).toBe("Default voice outbound");
  });

  test("an existing workstream name is an error (case-insensitive)", () => {
    const plan = resolve(["workstream_name", "contoso voice"]);
    expect(errors(plan)[0]).toMatchObject({ column: "workstream_name" });
    expect(errors(plan)[0].message).toMatch(/already exists/);
  });

  test("unknown and ambiguous references", () => {
    const plan = resolve([
      "workstream_name,default_queue,capacity_profile,channel_name,language,hold_music,operating_hours",
      "WS,Billing,Nope,A,xx-XX,Silence,Weekends"
    ]);
    const byColumn = Object.fromEntries(errors(plan).map((e) => [e.column, e.message]));
    expect(byColumn.default_queue).toMatch(/2 queue records are named "Billing"/);
    expect(byColumn.capacity_profile).toMatch(/No capacity profile named "Nope"/);
    expect(byColumn.language).toMatch(/isn't a language/);
    expect(byColumn.hold_music).toMatch(/No music named "Silence"/);
    expect(byColumn.operating_hours).toMatch(/No operating hours named "Weekends"/);
  });

  test("capacity profile can be given by unique name", () => {
    const plan = resolve(["workstream_name,capacity_profile", "WS,msdyn_escalationprofile"]);
    expect(plan.workstreams[0].refs.capacityProfile?.name).toBe("Escalation profile");
  });

  test("phone numbers: unknown and inactive are errors; direction mismatch and reuse are warnings", () => {
    const plan = resolve([
      "workstream_name,direction,channel_name,language,phone_number",
      "In,Inbound,A,en-US,+31600000000",
      "In,,B,en-US,+31207654321",
      "In,,C,en-US,+18005550100",
      "In,,D,en-US,+13159956114"
    ]);
    expect(errors(plan).map((e) => e.line)).toEqual([2, 3]);
    expect(errors(plan)[0].message).toMatch(/leave phone_number blank/);
    expect(errors(plan)[1].message).toMatch(/deactivated/);
    const numberWarnings = warnings(plan).filter((w) => w.column === "phone_number");
    expect(numberWarnings.map((w) => w.line)).toEqual([4, 5]);
    expect(numberWarnings[0].message).toMatch(/isn't enabled for inbound/);
    expect(numberWarnings[1].message).toMatch(/already used by "Contoso Voice Channel"/);
  });

  test("a channel without a number resolves with no number reference and no problem", () => {
    const plan = resolve(["workstream_name,default_queue,channel_name,language,tts_voice", "WS,Callbacks,A,en-US,en-US-AvaMultilingualNeural"]);
    expect(plan.issues).toEqual([]);
    expect(plan.workstreams[0].channels[0].refs.phoneNumber).toBeUndefined();
  });

  test("an existing channel name is a warning, naming its workstream", () => {
    const plan = resolve(["workstream_name,default_queue,channel_name,language,tts_voice", "WS,Callbacks,Contoso Voice Channel,en-US,en-US-AvaMultilingualNeural"]);
    expect(warnings(plan)[0].message).toMatch(/already exists \(on "Contoso Voice"\)/);
  });
});
