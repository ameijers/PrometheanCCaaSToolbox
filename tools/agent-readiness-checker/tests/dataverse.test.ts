import { loadAgentRoster } from "../src/dataverse";

// Minimal mock of the subset of Xrm.WebApi.retrieveMultipleRecords this tool actually calls,
// dispatched by entity logical name. Each test wires up only the entities it cares about; anything
// else 404s like a table that genuinely doesn't exist in this "environment", so tests can verify
// per-field graceful degradation in isolation.
type Handler = (query: string) => { entities: any[]; nextLink?: string } | Promise<{ entities: any[]; nextLink?: string }>;

function installXrm(handlers: Partial<Record<string, Handler>>) {
  (global as any).Xrm = {
    WebApi: {
      retrieveMultipleRecords: async (logicalName: string, query: string) => {
        const handler = handlers[logicalName];
        if (!handler) {
          const error: any = new Error(`Resource not found for the segment '${logicalName}'.`);
          throw error;
        }
        return handler(query);
      }
    }
  };
}

afterEach(() => { delete (global as any).Xrm; });

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const ROLE_ID = "33333333-3333-3333-3333-333333333333";
const QUEUE_ID = "44444444-4444-4444-4444-444444444444";

function baseHandlers(overrides: Partial<Record<string, Handler>> = {}): Partial<Record<string, Handler>> {
  return {
    queuemembership: () => ({ entities: [{ queueid: QUEUE_ID, systemuserid: USER_A }] }),
    role: () => ({ entities: [{ roleid: ROLE_ID, name: "Customer Service Agent" }] }),
    systemuserroles: () => ({ entities: [{ systemuserid: USER_A, roleid: ROLE_ID }] }),
    systemuser: (query: string) => {
      if (query.includes("msdyn_capacityprofileid")) return { entities: [{ systemuserid: USER_A, msdyn_capacityprofileid: null }] };
      if (query.includes("msdyn_presenceid")) return { entities: [{ systemuserid: USER_A, msdyn_presenceid: { msdyn_name: "Available" } }] };
      return { entities: [{ systemuserid: USER_A, fullname: "Ada Lovelace", domainname: "ada@contoso.com", isdisabled: false, accessmode: 0 }] };
    },
    msdyn_liveworkstream: () => ({ entities: [] }),
    queue: () => ({ entities: [{ queueid: QUEUE_ID, name: "Support Queue", statecode: 0 }] }),
    bookableresource: () => ({ entities: [] }),
    ...overrides
  };
}

describe("loadAgentRoster", () => {
  test("returns no agents when there are no queue members and no agent-role holders", async () => {
    installXrm({ queuemembership: () => ({ entities: [] }), role: () => ({ entities: [] }) });
    const agents = await loadAgentRoster();
    expect(agents).toEqual([]);
  });

  test("builds an agent record from queue membership + role + user rows", async () => {
    installXrm(baseHandlers());
    const [agent] = await loadAgentRoster();
    expect(agent.id).toBe(USER_A);
    expect(agent.name).toBe("Ada Lovelace");
    expect(agent.disabled).toEqual({ known: true, value: false });
    expect(agent.securityRoles).toEqual({ known: true, value: ["Customer Service Agent"] });
    expect(agent.queueMemberships.known).toBe(true);
    if (agent.queueMemberships.known) {
      expect(agent.queueMemberships.value).toHaveLength(1);
      expect(agent.queueMemberships.value[0].queueName).toBe("Support Queue");
    }
  });

  test("surfaces a role-holder with no queue membership at all (a real misconfiguration this tool should catch)", async () => {
    installXrm(baseHandlers({
      queuemembership: () => ({ entities: [] }),
      systemuserroles: () => ({ entities: [{ systemuserid: USER_B, roleid: ROLE_ID }] }),
      systemuser: () => ({ entities: [{ systemuserid: USER_B, fullname: "Bob Babbage", isdisabled: false, accessmode: 0 }] })
    }));
    const agents = await loadAgentRoster();
    expect(agents.map((a) => a.id)).toEqual([USER_B]);
    expect(agents[0].queueMemberships).toEqual({ known: true, value: [] });
  });

  test("follows @odata.nextLink to page through queue membership results", async () => {
    let calls = 0;
    installXrm(baseHandlers({
      queuemembership: (query: string) => {
        calls += 1;
        if (!query.includes("page2")) return { entities: [{ queueid: QUEUE_ID, systemuserid: USER_A }], nextLink: "https://org.crm.dynamics.com/api/data/v9.2/queuememberships?page2" };
        return { entities: [{ queueid: QUEUE_ID, systemuserid: USER_B }] };
      },
      systemuser: (query: string) => {
        if (query.includes("msdyn_capacityprofileid") || query.includes("msdyn_presenceid")) return { entities: [] };
        return { entities: [{ systemuserid: USER_A, fullname: "Ada Lovelace", isdisabled: false, accessmode: 0 }, { systemuserid: USER_B, fullname: "Bob Babbage", isdisabled: false, accessmode: 0 }] };
      }
    }));
    const agents = await loadAgentRoster();
    expect(calls).toBe(2);
    expect(agents.map((a) => a.id).sort()).toEqual([USER_A, USER_B].sort());
  });

  test("degrades a table to unknown on permission-denied without crashing the whole load", async () => {
    installXrm(baseHandlers({
      bookableresource: () => { const error: any = new Error("Principal user is missing prvReadBookableResource privilege (0x80040220)"); throw error; }
    }));
    const [agent] = await loadAgentRoster();
    expect(agent.skills.known).toBe(false);
    if (!agent.skills.known) expect(agent.skills.reason).toMatch(/skills/i);
    // Other fields keep working even though skills failed.
    expect(agent.disabled).toEqual({ known: true, value: false });
  });

  test("degrades workstream reachability (and therefore queue memberships) to unknown when routing tables are unreadable", async () => {
    installXrm(baseHandlers({
      msdyn_liveworkstream: () => { const error: any = new Error("Principal user is missing privilege (0x80040220)"); throw error; }
    }));
    const [agent] = await loadAgentRoster();
    expect(agent.queueMemberships.known).toBe(false);
  });

  test("channels and unified routing exclusion are always reported as unknown (no verified schema)", async () => {
    installXrm(baseHandlers());
    const [agent] = await loadAgentRoster();
    expect(agent.channels.known).toBe(false);
    expect(agent.routingExclusion.known).toBe(false);
  });

  test("reports a capacity profile when the expand succeeds", async () => {
    installXrm(baseHandlers({
      systemuser: (query: string) => {
        if (query.includes("msdyn_capacityprofileid")) return { entities: [{ systemuserid: USER_A, msdyn_capacityprofileid: { msdyn_name: "Standard", msdyn_totalcapacity: 100 } }] };
        if (query.includes("msdyn_presenceid")) return { entities: [{ systemuserid: USER_A, msdyn_presenceid: null }] };
        return { entities: [{ systemuserid: USER_A, fullname: "Ada Lovelace", isdisabled: false, accessmode: 0 }] };
      }
    }));
    const [agent] = await loadAgentRoster();
    expect(agent.capacityProfile).toEqual({ known: true, value: { id: "Standard", name: "Standard", totalCapacity: 100 } });
  });
});
