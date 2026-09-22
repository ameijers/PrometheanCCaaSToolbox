import { loadAgentRoster, loadAllRoles, loadCurrentUserDomain } from "../src/dataverse";

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
    // No team-role assignment / team membership by default — the person running the tool passes
    // whichever role ids they picked directly, so these two are only ever "empty" unless a specific
    // test wires up a team.
    teamroles: () => ({ entities: [] }),
    teammembership: () => ({ entities: [] }),
    systemuser: () => ({ entities: [{ systemuserid: USER_A, fullname: "Ada Lovelace", domainname: "ada@contoso.com", isdisabled: false, accessmode: 0 }] }),
    msdyn_liveworkstream: () => ({ entities: [] }),
    queue: () => ({ entities: [{ queueid: QUEUE_ID, name: "Support Queue", statecode: 0 }] }),
    bookableresource: () => ({ entities: [] }),
    msdyn_agentstatus: () => ({ entities: [{ _msdyn_agentid_value: USER_A, msdyn_isagentloggedin: true, modifiedon: "2026-01-01T00:00:00Z", msdyn_currentpresenceid: { msdyn_name: "Available" } }] }),
    ...overrides
  };
}

describe("loadAgentRoster", () => {
  // The roster is gated entirely by whichever role ids the caller passes in (App.tsx resolves these
  // from the person's live role-picker selection — see config.ts's RoleSelection) — queue membership
  // is deliberately NOT a trigger for inclusion any more (see dataverse.ts's comment on
  // loadCandidateUserIds for why: live testing showed queues can contain users who were never meant
  // to be agents at all, producing a roster full of "failing" checks for people who were never going
  // to receive calls).
  test("returns no agents when nobody holds a relevant role, even if they're queue members", async () => {
    installXrm(baseHandlers({ role: () => ({ entities: [] }), systemuserroles: () => ({ entities: [] }) }));
    const { agents } = await loadAgentRoster([ROLE_ID]);
    expect(agents).toEqual([]);
  });

  test("builds an agent record from role + user rows", async () => {
    installXrm(baseHandlers());
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
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
    const { agents } = await loadAgentRoster([ROLE_ID]);
    expect(agents.map((a) => a.id)).toEqual([USER_B]);
    expect(agents[0].queueMemberships).toEqual({ known: true, value: [] });
  });

  // dataverse.ts itself has no notion of "Agent" vs "Supervisor" vs "Admin" — that grouping lives
  // entirely in App.tsx's live role picker (see config.ts's RoleSelection); this layer just takes
  // whichever role ids it's given, whatever the caller considers them to mean.
  test("surfaces a holder of any role id passed in, not just a hardcoded 'agent' role", async () => {
    const SUPERVISOR_ROLE_ID = "55555555-aaaa-5555-aaaa-555555555555";
    installXrm(baseHandlers({
      queuemembership: () => ({ entities: [] }),
      role: () => ({ entities: [{ roleid: SUPERVISOR_ROLE_ID, name: "Omnichannel Supervisor" }] }),
      systemuserroles: () => ({ entities: [{ systemuserid: USER_B, roleid: SUPERVISOR_ROLE_ID }] }),
      systemuser: () => ({ entities: [{ systemuserid: USER_B, fullname: "Grace Hopper", isdisabled: false, accessmode: 0 }] })
    }));
    const { agents: [agent] } = await loadAgentRoster([SUPERVISOR_ROLE_ID]);
    expect(agent.id).toBe(USER_B);
    expect(agent.securityRoles).toEqual({ known: true, value: ["Omnichannel Supervisor"] });
  });

  // Confirmed live against academyexperiment (see IMPLEMENTATION_STATUS.md "Round 9"): a real team
  // ("Sales-Supervisor") held a renamed Supervisor role directly, with no individual user in that
  // environment holding the same role — so without reading team-role grants, a user who only gets
  // agent access via their team would never appear on the roster at all, regardless of which roles
  // were selected. `teamroles` is the entity's logical name, and (unlike its EntitySetName,
  // "teamrolescollection", which only matters for raw REST calls) that's what belongs in an
  // `Xrm.WebApi` call — see IMPLEMENTATION_STATUS.md "Round 11" for the live mix-up this caused.
  describe("roles granted via Dataverse Team membership", () => {
    const TEAM_ID = "66666666-aaaa-6666-aaaa-666666666666";

    test("surfaces a user who holds the role only via team membership, with no direct role assignment", async () => {
      installXrm(baseHandlers({
        queuemembership: () => ({ entities: [] }),
        systemuserroles: () => ({ entities: [] }),
        teamroles: () => ({ entities: [{ teamid: TEAM_ID, roleid: ROLE_ID }] }),
        teammembership: () => ({ entities: [{ systemuserid: USER_B, teamid: TEAM_ID }] }),
        systemuser: () => ({ entities: [{ systemuserid: USER_B, fullname: "Ada Team-Member", isdisabled: false, accessmode: 0 }] })
      }));
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.id).toBe(USER_B);
      expect(agent.securityRoles).toEqual({ known: true, value: ["Customer Service Agent"] });
    });

    test("merges a user's own direct role(s) with role(s) granted via their team, de-duplicated", async () => {
      const OTHER_ROLE_ID = "77777777-aaaa-7777-aaaa-777777777777";
      installXrm(baseHandlers({
        role: () => ({ entities: [{ roleid: ROLE_ID, name: "Customer Service Agent" }, { roleid: OTHER_ROLE_ID, name: "Basic User" }] }),
        systemuserroles: () => ({ entities: [{ systemuserid: USER_A, roleid: ROLE_ID }, { systemuserid: USER_A, roleid: OTHER_ROLE_ID }] }),
        teamroles: () => ({ entities: [{ teamid: TEAM_ID, roleid: ROLE_ID }] }),
        // USER_A both holds ROLE_ID directly AND belongs to a team that also grants it — the merged
        // list should still show it once, plus the directly-held OTHER_ROLE_ID.
        teammembership: () => ({ entities: [{ systemuserid: USER_A, teamid: TEAM_ID }] })
      }));
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.securityRoles.known).toBe(true);
      if (agent.securityRoles.known) expect([...agent.securityRoles.value].sort()).toEqual(["Basic User", "Customer Service Agent"]);
    });

    // The mock server here doesn't simulate real $filter evaluation (it returns canned data
    // regardless of the query, same as every other handler in this file) — so "a team's role isn't
    // relevant" is verified by asserting on the actual query sent, not by returning mismatched data
    // and hoping the client-side code happens to ignore it.
    test("filters team-role lookups by the relevant role ids being searched for", async () => {
      installXrm(baseHandlers({
        queuemembership: () => ({ entities: [] }),
        systemuserroles: () => ({ entities: [] }),
        teamroles: (query: string) => {
          expect(query).toContain(`roleid eq ${ROLE_ID}`);
          return { entities: [] };
        }
      }));
      const { agents } = await loadAgentRoster([ROLE_ID]);
      expect(agents).toEqual([]);
    });
  });

  test("follows @odata.nextLink to page through queue membership results (both users are candidates via role here, not queue membership)", async () => {
    let calls = 0;
    installXrm(baseHandlers({
      queuemembership: (query: string) => {
        calls += 1;
        if (!query.includes("page2")) return { entities: [{ queueid: QUEUE_ID, systemuserid: USER_A }], nextLink: "https://org.crm.dynamics.com/api/data/v9.2/queuememberships?page2" };
        return { entities: [{ queueid: QUEUE_ID, systemuserid: USER_B }] };
      },
      systemuserroles: () => ({ entities: [{ systemuserid: USER_A, roleid: ROLE_ID }, { systemuserid: USER_B, roleid: ROLE_ID }] }),
      systemuser: () => ({ entities: [{ systemuserid: USER_A, fullname: "Ada Lovelace", isdisabled: false, accessmode: 0 }, { systemuserid: USER_B, fullname: "Bob Babbage", isdisabled: false, accessmode: 0 }] }),
      msdyn_agentstatus: () => ({ entities: [] })
    }));
    const { agents } = await loadAgentRoster([ROLE_ID]);
    expect(calls).toBe(2);
    expect(agents.map((a) => a.id).sort()).toEqual([USER_A, USER_B].sort());
    const byId = new Map(agents.map((a) => [a.id, a]));
    expect(byId.get(USER_A)?.queueMemberships).toEqual({ known: true, value: [{ queueId: QUEUE_ID, queueName: "Support Queue", queueActive: true, reachableByActiveVoiceWorkstream: false, reachingWorkstreamNames: [] }] });
    expect(byId.get(USER_B)?.queueMemberships).toEqual({ known: true, value: [{ queueId: QUEUE_ID, queueName: "Support Queue", queueActive: true, reachableByActiveVoiceWorkstream: false, reachingWorkstreamNames: [] }] });
  });

  test("degrades a table to unknown on permission-denied without crashing the whole load", async () => {
    installXrm(baseHandlers({
      bookableresource: () => { const error: any = new Error("Principal user is missing prvReadBookableResource privilege (0x80040220)"); throw error; }
    }));
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
    expect(agent.skills.known).toBe(false);
    if (!agent.skills.known) expect(agent.skills.reason).toMatch(/skills/i);
    // Other fields keep working even though skills failed.
    expect(agent.disabled).toEqual({ known: true, value: false });
  });

  test("degrades workstream reachability (and therefore queue memberships) to unknown when routing tables are unreadable", async () => {
    installXrm(baseHandlers({
      msdyn_liveworkstream: () => { const error: any = new Error("Principal user is missing privilege (0x80040220)"); throw error; }
    }));
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
    expect(agent.queueMemberships.known).toBe(false);
  });

  // msdyn_agentstatus.msdyn_isblockedbysomeprofile, confirmed live against academyexperiment (see
  // IMPLEMENTATION_STATUS.md "Round 7") — read from the same row as presence, not an independent
  // query, and no separate admin "opt-out" toggle was found to exist in this product.
  describe("capacityBlocked (from msdyn_agentstatus.msdyn_isblockedbysomeprofile)", () => {
    test("reports false when the agent's status row says they aren't blocked", async () => {
      installXrm(baseHandlers());
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.capacityBlocked).toEqual({ known: true, value: false });
    });

    test("reports true when the agent is currently blocked from new work by capacity", async () => {
      installXrm(baseHandlers({
        msdyn_agentstatus: () => ({ entities: [{ _msdyn_agentid_value: USER_A, msdyn_isagentloggedin: true, msdyn_isblockedbysomeprofile: true, modifiedon: "2026-01-01T00:00:00Z", msdyn_currentpresenceid: { msdyn_name: "Available" } }] })
      }));
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.capacityBlocked).toEqual({ known: true, value: true });
    });

    test("defaults to false (not unknown) when the agent has no msdyn_agentstatus row at all", async () => {
      installXrm(baseHandlers({ msdyn_agentstatus: () => ({ entities: [] }) }));
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.capacityBlocked).toEqual({ known: true, value: false });
    });

    test("is unknown when msdyn_agentstatus can't be read at all (same failure as presence)", async () => {
      installXrm(baseHandlers({
        msdyn_agentstatus: () => { const error: any = new Error("Principal user is missing privilege (0x80040220)"); throw error; }
      }));
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.capacityBlocked.known).toBe(false);
      expect(agent.presence.known).toBe(false);
    });
  });

  // Confirmed directly by a real environment's administrator: this product has no separate
  // per-agent channel toggle at all — "channels" is derived from queue/workstream reachability
  // (the same data queueMemberships already uses), not an independent read.
  describe("channels are derived from queue/workstream reachability, not read independently", () => {
    test("reports no channels when nothing routes to the agent's queue (the default fixture: no voice workstreams)", async () => {
      installXrm(baseHandlers());
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.channels).toEqual({ known: true, value: [] });
    });

    test("reports Voice when the agent belongs to a queue an active voice workstream reaches", async () => {
      const WORKSTREAM_ID = "99999999-bbbb-9999-bbbb-999999999999";
      const CONFIG_ID = "aaaaaaaa-bbbb-aaaa-bbbb-aaaaaaaaaaaa";
      installXrm(baseHandlers({
        msdyn_liveworkstream: (query: string) => {
          if (query.includes("$expand=msdyn_defaultqueue")) return { entities: [{ msdyn_liveworkstreamid: WORKSTREAM_ID, msdyn_defaultqueue: { queueid: QUEUE_ID } }] };
          return { entities: [{ msdyn_liveworkstreamid: WORKSTREAM_ID, msdyn_name: "Inbound Voice", statecode: 0, msdyn_direction: 0, msdyn_enablevoicev2: true }] };
        },
        msdyn_routingconfiguration: () => ({ entities: [{ msdyn_routingconfigurationid: CONFIG_ID, msdyn_isactiveconfiguration: true }] }),
        msdyn_routingconfigurationstep: () => ({ entities: [] })
      }));
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.channels).toEqual({ known: true, value: ["Voice"] });
    });

    test("is unknown when the underlying routing configuration can't be read", async () => {
      installXrm(baseHandlers({ msdyn_liveworkstream: () => { const error: any = new Error("Principal user is missing privilege (0x80040220)"); throw error; } }));
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.channels.known).toBe(false);
    });
  });

  // Confirmed live against academyexperiment (see IMPLEMENTATION_STATUS.md "Round 7"): none of a
  // real environment's inbound voice workstreams had a Skill identification routing step at all
  // (confirmed against the real msdyn_type option set), which is what made this check permanently
  // "Not verifiable" — the step's absence is itself a confirmed fact read from data already fetched
  // for queue targeting, not a gap. A step being present but unparseable stays genuinely unknown.
  describe("required skills per queue distinguish 'no skill step configured' from 'step exists but unparseable'", () => {
    const WORKSTREAM_ID = "cccccccc-1111-cccc-1111-cccccccc1111";
    const CONFIG_ID = "dddddddd-1111-dddd-1111-dddddddd1111";

    function withSteps(steps: any[]) {
      return baseHandlers({
        msdyn_liveworkstream: (query: string) => {
          if (query.includes("$expand=msdyn_defaultqueue")) return { entities: [{ msdyn_liveworkstreamid: WORKSTREAM_ID, msdyn_defaultqueue: { queueid: QUEUE_ID } }] };
          return { entities: [{ msdyn_liveworkstreamid: WORKSTREAM_ID, msdyn_name: "Inbound Voice", statecode: 0, msdyn_direction: 0, msdyn_enablevoicev2: true }] };
        },
        msdyn_routingconfiguration: () => ({ entities: [{ msdyn_routingconfigurationid: CONFIG_ID, msdyn_isactiveconfiguration: true }] }),
        msdyn_routingconfigurationstep: () => ({ entities: steps })
      });
    }

    test("required: [] (confirmed, not unknown) when the reaching workstream has no Skill identification step at all", async () => {
      installXrm(withSteps([]));
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.queueSkillRequirements).toEqual({ known: true, value: [{ queueId: QUEUE_ID, queueName: "Support Queue", required: [] }] });
    });

    test("required: null (genuinely undetermined) when a Skill identification step exists but has no ruleset attached at all", async () => {
      // A structurally incomplete configuration (step added, no decision ruleset wired to it) —
      // distinct from the "no step at all" case above, which is a confirmed non-requirement, not an
      // incomplete one. This tool's best-effort ruleset parser (see README's "Low confidence" note
      // on this specific field) can only ever run once a ruleset actually exists to parse.
      installXrm(withSteps([{ msdyn_type: 192350001 }]));
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.queueSkillRequirements).toEqual({ known: true, value: [{ queueId: QUEUE_ID, queueName: "Support Queue", required: null }] });
    });

    test("required: [...] when a Skill identification step's ruleset parses to actual skill requirements", async () => {
      const RULESET_ID = "ffffffff-1111-ffff-1111-ffffffff1111";
      const rulesetXml = `<decision hit-policy="all" version="1"><rules><rule id="r1" name="skill"><action><setattribute><lhs type="attribute">characteristic</lhs><rhs type="staticvalue">{"name":"Dutch","proficiency":"Intermediate"}</rhs></setattribute></action></rule></rules></decision>`;
      installXrm({
        ...withSteps([{ msdyn_type: 192350001, _msdyn_rulesetid_value: RULESET_ID }]),
        msdyn_decisionruleset: () => ({ entities: [{ msdyn_decisionrulesetid: RULESET_ID, msdyn_rulesetdefinition: rulesetXml }] })
      });
      const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
      expect(agent.queueSkillRequirements).toEqual({
        known: true,
        value: [{ queueId: QUEUE_ID, queueName: "Support Queue", required: [{ name: "Dutch", minProficiencyLabel: "Intermediate", minProficiencyRank: undefined }] }]
      });
    });
  });

  // Confirmed live against academyexperiment (two rounds of correction — see
  // IMPLEMENTATION_STATUS.md): capacity comes from bookableresource -> the
  // msdyn_bookableresourcecapacityprofile join table -> msdyn_capacityprofile, NOT
  // systemuser.msdyn_capacity (that field was confirmed to exist but sit outside this
  // relationship entirely, and was empty on a real agent who still had profiles assigned).
  test("reports the agent's capacity-profile assignments via bookableresource -> msdyn_bookableresourcecapacityprofile -> msdyn_capacityprofile", async () => {
    const RESOURCE_ID = "88888888-8888-8888-8888-888888888888";
    installXrm(baseHandlers({
      bookableresource: () => ({ entities: [{ bookableresourceid: RESOURCE_ID, _userid_value: USER_A }] }),
      msdyn_bookableresourcecapacityprofile: (query: string) => {
        expect(query).toContain("_msdyn_bookableresourceid_value");
        expect(query).toContain("$expand=msdyn_capacityprofileid($select=msdyn_name,msdyn_defaultmaxunits)");
        return {
          entities: [
            { _msdyn_bookableresourceid_value: RESOURCE_ID, msdyn_maxunits: null, msdyn_capacityprofileid: { msdyn_name: "Default voice inbound", msdyn_defaultmaxunits: 1 } },
            { _msdyn_bookableresourceid_value: RESOURCE_ID, msdyn_maxunits: 5, msdyn_capacityprofileid: { msdyn_name: "Default voice outbound", msdyn_defaultmaxunits: 1 } }
          ]
        };
      }
    }));
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
    // First profile's join row has no override, so it falls back to the profile's own default (1).
    // Second profile's join row overrides the default (5) with its own value.
    expect(agent.agentCapacity).toEqual({
      known: true,
      value: [
        { profileName: "Default voice inbound", effectiveUnits: 1 },
        { profileName: "Default voice outbound", effectiveUnits: 5 }
      ]
    });
  });

  test("reports an empty capacity-profile list (not unknown) when the agent has a bookable resource but no profile assignments", async () => {
    const RESOURCE_ID = "99999999-9999-9999-9999-999999999999";
    installXrm(baseHandlers({
      bookableresource: () => ({ entities: [{ bookableresourceid: RESOURCE_ID, _userid_value: USER_A }] }),
      msdyn_bookableresourcecapacityprofile: () => ({ entities: [] })
    }));
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
    expect(agent.agentCapacity).toEqual({ known: true, value: [] });
  });

  test("derives work-item unit cost from a \"Unit based\" reaching workstream's msdyn_capacityrequired", async () => {
    const WORKSTREAM_ID = "55555555-5555-5555-5555-555555555555";
    const CONFIG_ID = "66666666-6666-6666-6666-666666666666";
    // No routing-configuration-step targets this queue directly, but it IS the workstream's
    // fallback queue (msdyn_defaultqueue) — that's how reachability is established here.
    installXrm(baseHandlers({
      msdyn_liveworkstream: (query: string) => {
        if (query.includes("$expand=msdyn_defaultqueue")) return { entities: [{ msdyn_liveworkstreamid: WORKSTREAM_ID, msdyn_defaultqueue: { queueid: QUEUE_ID } }] };
        return { entities: [{ msdyn_liveworkstreamid: WORKSTREAM_ID, msdyn_name: "Inbound Voice", statecode: 0, msdyn_direction: 0, msdyn_enablevoicev2: true, msdyn_capacityrequired: 100, msdyn_capacityformat: 192350000 /* Unit based */ }] };
      },
      msdyn_routingconfiguration: () => ({ entities: [{ msdyn_routingconfigurationid: CONFIG_ID, msdyn_isactiveconfiguration: true }] }),
      msdyn_routingconfigurationstep: () => ({ entities: [] })
    }));
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
    expect(agent.workItemUnitCost).toEqual({ known: true, value: 100 });
    expect(agent.hasProfileBasedReachableWorkstream).toEqual({ known: true, value: false });
    expect(agent.queueMemberships).toEqual({
      known: true,
      value: [{ queueId: QUEUE_ID, queueName: "Support Queue", queueActive: true, reachableByActiveVoiceWorkstream: true, reachingWorkstreamNames: ["Inbound Voice"] }]
    });
  });

  // Confirmed live against academyexperiment: a real environment had every inbound voice
  // workstream set to "Profile based" (msdyn_capacityformat) rather than "Unit based" — under that
  // format, msdyn_capacityrequired (30, in that real case) is NOT meaningfully comparable to the
  // agent's own capacity number, and treating it as if it were produced a false "capacity too low"
  // failure for a real agent whose capacity was actually sufficient.
  test("does NOT surface msdyn_capacityrequired as a unit cost from a \"Profile based\" reaching workstream", async () => {
    const WORKSTREAM_ID = "77777777-aaaa-7777-aaaa-777777777777";
    const CONFIG_ID = "88888888-aaaa-8888-aaaa-888888888888";
    installXrm(baseHandlers({
      msdyn_liveworkstream: (query: string) => {
        if (query.includes("$expand=msdyn_defaultqueue")) return { entities: [{ msdyn_liveworkstreamid: WORKSTREAM_ID, msdyn_defaultqueue: { queueid: QUEUE_ID } }] };
        return { entities: [{ msdyn_liveworkstreamid: WORKSTREAM_ID, msdyn_name: "Contoso Voice", statecode: 0, msdyn_direction: 0, msdyn_enablevoicev2: true, msdyn_capacityrequired: 30, msdyn_capacityformat: 192360000 /* Profile based */ }] };
      },
      msdyn_routingconfiguration: () => ({ entities: [{ msdyn_routingconfigurationid: CONFIG_ID, msdyn_isactiveconfiguration: true }] }),
      msdyn_routingconfigurationstep: () => ({ entities: [] })
    }));
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
    expect(agent.workItemUnitCost).toEqual({ known: true, value: null });
    expect(agent.hasProfileBasedReachableWorkstream).toEqual({ known: true, value: true });
  });

  // Confirmed live against academyexperiment: systemuser.msdyn_defaultpresenceiduser (the original
  // guess) is a "default" preference field, not live status, and was confirmed empty on a real
  // agent who was actively logged in — a real false "may never have signed in" result. The actual
  // live status is msdyn_agentstatus.msdyn_currentpresenceid + msdyn_isagentloggedin.
  test("reports the agent's current presence via msdyn_agentstatus (not systemuser.msdyn_defaultpresenceiduser)", async () => {
    installXrm(baseHandlers({
      msdyn_agentstatus: (query: string) => {
        expect(query).toContain("_msdyn_agentid_value");
        expect(query).toContain("msdyn_isagentloggedin");
        expect(query).toContain("$expand=msdyn_currentpresenceid($select=msdyn_name)");
        return { entities: [{ _msdyn_agentid_value: USER_A, msdyn_isagentloggedin: true, modifiedon: "2026-09-16T08:31:50Z", msdyn_currentpresenceid: { msdyn_name: "Available" } }] };
      }
    }));
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
    expect(agent.presence).toEqual({ known: true, value: { name: "Available", isLoggedIn: true, allowsAssignment: true, capturedOn: "2026-09-16T08:31:50Z" } });
  });

  test("reports a not-logged-in agent's presence, distinct from no record at all", async () => {
    installXrm(baseHandlers({
      msdyn_agentstatus: () => ({ entities: [{ _msdyn_agentid_value: USER_A, msdyn_isagentloggedin: false, modifiedon: "2026-09-16T08:31:50Z", msdyn_currentpresenceid: { msdyn_name: "Offline" } }] })
    }));
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
    expect(agent.presence).toEqual({ known: true, value: { name: "Offline", isLoggedIn: false, allowsAssignment: false, capturedOn: "2026-09-16T08:31:50Z" } });
  });

  test("reports null (not unknown) presence when the agent has no msdyn_agentstatus row at all", async () => {
    installXrm(baseHandlers({ msdyn_agentstatus: () => ({ entities: [] }) }));
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
    expect(agent.presence).toEqual({ known: true, value: null });
  });

  // Confirmed via EntityDefinitions metadata against academyexperiment: bookableresourcecharacteristic's
  // lookup to its owning resource is logical name "resource" (not "bookableresourceid"), and its
  // expand navigation properties to characteristic/ratingvalue use PascalCase schema names.
  test("reports the agent's skills via bookableresource/_resource_value/Characteristic/RatingValue", async () => {
    const RESOURCE_ID = "77777777-7777-7777-7777-777777777777";
    installXrm(baseHandlers({
      bookableresource: () => ({ entities: [{ bookableresourceid: RESOURCE_ID, _userid_value: USER_A }] }),
      bookableresourcecharacteristic: (query: string) => {
        expect(query).toContain("_resource_value");
        expect(query).toContain("$expand=Characteristic($select=name),RatingValue($select=name,value)");
        return { entities: [{ _resource_value: RESOURCE_ID, Characteristic: { name: "Dutch" }, RatingValue: { name: "Advanced", value: 3 } }] };
      }
    }));
    const { agents: [agent] } = await loadAgentRoster([ROLE_ID]);
    expect(agent.skills).toEqual({ known: true, value: [{ characteristicId: "Dutch", name: "Dutch", proficiencyLabel: "Advanced", proficiencyRank: 3 }] });
  });

});

describe("loadAllRoles", () => {
  // Confirmed live in academyexperiment: Dataverse marks retired system roles "(Deprecated) X" and,
  // in at least one case, "X(Deprecated)" — neither should ever be offered as a pick in the live role
  // picker (see App.tsx), so loadAllRoles excludes both shapes case-insensitively.
  test("excludes roles Dataverse marks (Deprecated), in either name position", async () => {
    installXrm({
      role: () => ({
        entities: [
          { roleid: "1", name: "Omnichannel agent" },
          { roleid: "2", name: "(Deprecated) Metadata Store Reader" },
          { roleid: "3", name: "Survey Services Administrator(Deprecated)" },
          { roleid: "4", name: "System Administrator" }
        ]
      })
    });
    const roles = await loadAllRoles();
    expect(roles.map((r) => r.name)).toEqual(["Omnichannel agent", "System Administrator"]);
  });
});

describe("loadCurrentUserDomain", () => {
  // App.tsx's preferred "home domain" for the Agent-list sort — a live lookup of the connected
  // user's own domain via Xrm.Utility.getGlobalContext(), not Xrm.WebApi.retrieveMultipleRecords, so
  // it needs its own mock shape rather than installXrm's retrieveMultipleRecords-only handlers.
  afterEach(() => { delete (global as any).Xrm; });

  test("returns the connected user's email domain, lowercased", async () => {
    (global as any).Xrm = {
      Utility: { getGlobalContext: () => ({ userSettings: { userId: `{${USER_A}}` } }) },
      WebApi: {
        retrieveRecord: async (logicalName: string, id: string) => {
          expect(logicalName).toBe("systemuser");
          expect(id).toBe(USER_A);
          return { domainname: "Alexander.Meijers@Contoso.com" };
        }
      }
    };
    expect(await loadCurrentUserDomain()).toBe("contoso.com");
  });

  test("returns undefined (not a thrown error) when there's no Xrm session at all", async () => {
    expect(await loadCurrentUserDomain()).toBeUndefined();
  });

  test("returns undefined when the user record can't be read", async () => {
    (global as any).Xrm = {
      Utility: { getGlobalContext: () => ({ userSettings: { userId: USER_A } }) },
      WebApi: { retrieveRecord: async () => { throw new Error("no permission"); } }
    };
    expect(await loadCurrentUserDomain()).toBeUndefined();
  });
});
