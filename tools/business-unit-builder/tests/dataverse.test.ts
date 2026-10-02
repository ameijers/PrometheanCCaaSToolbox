import { dataverseSource, recordUrl } from "../src/dataverse";

function install(rows: Record<string, Record<string, unknown>[]> = {}) {
  const reads: { table: string; query: string }[] = [];
  const creates: { table: string; payload: Record<string, unknown> }[] = [];
  (global as any).Xrm = {
    Utility: { getGlobalContext: () => ({ getClientUrl: () => "https://org.crm.dynamics.com", userSettings: { userName: "Admin User" } }) },
    WebApi: {
      retrieveMultipleRecords: async (table: string, query: string) => { reads.push({ table, query }); return { entities: rows[table] ?? [] }; },
      createRecord: async (table: string, payload: Record<string, unknown>) => { creates.push({ table, payload }); return { id: "{AAAAAAAA-0000-0000-0000-000000000001}" }; }
    }
  };
  return { reads, creates };
}

afterEach(() => { delete (global as any).Xrm; });

describe("dataverseSource", () => {
  test("loadCatalog reads every business unit with its parent and state", async () => {
    install({ businessunit: [
      { businessunitid: "r", name: "Root", isdisabled: false, _parentbusinessunitid_value: null },
      { businessunitid: "c", name: "Child", isdisabled: true, _parentbusinessunitid_value: "r" }
    ] });
    expect(await dataverseSource.loadCatalog()).toEqual({ units: [
      { id: "r", name: "Root", parentId: undefined, disabled: false },
      { id: "c", name: "Child", parentId: "r", disabled: true }
    ] });
  });

  test("createUnit creates a businessunit and returns a clean id", async () => {
    const { creates } = install();
    expect(await dataverseSource.createUnit({ name: "A" })).toBe("aaaaaaaa-0000-0000-0000-000000000001");
    expect(creates).toEqual([{ table: "businessunit", payload: { name: "A" } }]);
  });

  test("hasDefaultTeam looks for the new unit's default team", async () => {
    const { reads } = install({ team: [{ teamid: "t" }] });
    expect(await dataverseSource.hasDefaultTeam("u1")).toBe(true);
    expect(reads[0].query).toContain("isdefault eq true and _businessunitid_value eq u1");
  });

  test("current user and record links", () => {
    install();
    expect(dataverseSource.currentUser()).toBe("Admin User");
    expect(recordUrl("u1")).toBe("https://org.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=businessunit&id=u1");
  });
});
