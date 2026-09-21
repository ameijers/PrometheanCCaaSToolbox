# Agent Readiness Checker

Part of the [Promethean CCaaS Toolbox](../../Readme.md). For step-by-step usage instructions and screenshots, see the [manual](manual.md).

## What it does

Agent Readiness Checker answers the question **"why isn't this agent receiving calls?"** for **Dynamics 365 Contact Center** (unified routing) administrators. Pick an agent (or scan the whole roster) and it evaluates them against every prerequisite for receiving voice work — account status, security roles, channel enablement, queue membership, whether an active workstream can actually reach them, capacity, skills, presence, and unified-routing exclusion — and reports which checks pass, warn, fail, or couldn't be verified, each with the actual evidence found, why it matters, and a plain-language suggested fix.

Typical uses:
- An agent says they're not getting calls — find the actual structural reason (disabled account, missing role, wrong queue, insufficient capacity, missing skill…) instead of guessing.
- Sweep the whole roster after an onboarding batch or a routing-configuration change to catch agents who were set up incorrectly.
- Confirm a specific fix actually resolved the issue by re-running the check.

## Key features

- **Bulk view:** every agent with an overall status (Ready / Warning / Not ready / Not verifiable), failed-check count, and a one-line top issue. Searchable by name/domain, filterable by status/queue/workstream, sortable by every column.
- **Detail view:** the full 9-check checklist for one agent, grouped by category, each with its status, the actual evidence read, why the check matters, and a suggested fix.
- **Summary header:** counts across the environment plus the single most common failing check, so a systemic problem (e.g. "half the roster is missing a security role") is obvious at a glance.
- **Overall status rule:** any failing check → Not ready; else any warning → Warning; else any unverifiable check → Not verifiable; else Ready.
- Export both views to CSV and Markdown, client-side, no server involved.
- A fully working offline demo mode with 21 hand-authored sample agents covering every check outcome — no Dataverse connection required to see the tool in action.

This is a **strictly read-only** tool: it never creates, updates, or deletes any Dataverse record. A static test (`tests/readOnly.test.ts`) fails the build if any Xrm.WebApi write method ever appears in `src/`.

## How it works

Same shape as the other two tools: a plain HTML/CSS/React (TypeScript) app, deployed as a trio of Dataverse web resources and hosted via its own Site Map subarea — see the [toolbox README](../../Readme.md#architecture) for why this toolbox defaults to web resources over PCF controls.

Architecture is deliberately layered so the actual diagnostic logic needs neither React nor a live Dataverse connection to test:
- **`dataverse.ts`** — the only file that touches `Xrm.WebApi`. Builds an `AgentRecord` per agent, where every field that depends on schema this tool couldn't fully verify is wrapped in a `Field<T>` (`{ known: true, value }` or `{ known: false, reason }`) instead of ever silently guessing.
- **`checks.ts`** — 9 pure functions (no I/O), one per check category, each taking an `AgentRecord` and returning one `CheckResult`. Fully unit-tested.
- **`aggregate.ts`** — the overall-status rule and roster-wide summary, also pure and tested.
- **`demoData.ts`** — 21 hand-authored `AgentRecord`s exercising every check outcome, used until "Connect environment" is clicked.
- **`export.ts`** — pure CSV/Markdown string builders (tested) plus a thin, untested browser-only download trigger.
- **`App.tsx`** — the UI, consuming only the above.

"Agent" is defined as the union of everyone with at least one `queuemembership` row and everyone holding one of the configured agent security roles (see `config.ts`) — not just queue members, so a user who holds an agent role but was never added to a queue (a real, common misconfiguration) still shows up on the roster instead of being silently excluded.

For which queues an active inbound voice workstream can actually reach, this tool reuses (read-only import, no changes made to that tool) [Visual Routing Tester](../visual-routing-tester/README.md)'s already-verified `msdyn_liveworkstream`/routing-configuration schema and its pure `parseDecisionXml` rule-XML parser, rather than re-deriving that from scratch.

## Schema assumptions — please read before trusting live results

Unlike the other two tools, most of this tool's schema was **not** verified against a live, populated environment before shipping (see `IMPLEMENTATION_STATUS.md` for why). Every field below degrades gracefully to **"Not verifiable"** in the UI if the underlying query fails — it never crashes and never presents a guess as a confirmed fact — but the confidence table matters for judging how much to trust a "pass" or "fail" you see:

| Data | Table(s) / column(s) used | Confidence | Notes |
| --- | --- | --- | --- |
| Account enabled/access mode | `systemuser`: `isdisabled`, `accessmode` | **High** — standard Dataverse | |
| Security roles | `systemuserroles`, `role` | **High** — standard Dataverse | Required role *names* are environment-specific — edit `src/config.ts` |
| Queue membership | `queuemembership`: `queueid`, `systemuserid` | **High** — standard Dataverse, same `queue` table Visual Routing Tester already verified | |
| Workstream reachability | `msdyn_liveworkstream`, `msdyn_routingconfiguration(step)`, `msdyn_decisionruleset` | **High** — reused from Visual Routing Tester's live-verified schema | |
| Skills (agent's own) | `bookableresource` (`_userid_value`), `bookableresourcecharacteristic`, `characteristic`, `ratingvalue` | **Medium** — standard Field Service/Universal Resource Scheduling schema that unified routing's skill-based routing documentation says it reuses, but not independently confirmed here | |
| Required skills per queue | Parsed from a reaching workstream's skill-identification routing step (type code `192350001`) looking for a set-attribute whose name contains "characteristic"/"skill" | **Low** — the exact action/JSON shape is unconfirmed; commonly resolves to "undetermined" for a given queue rather than a wrong answer | Falls back to `unknown` per queue, never a guessed pass/fail |
| Agent capacity | `systemuser.msdyn_Capacity` (plain whole number) | **High** — confirmed live against `academyexperiment` | There is **no separate reusable "capacity profile" entity** in this product, despite the name administrators commonly use for the concept — the original guess (a separate `msdyn_agentcapacityprofile` table) was wrong and has been removed |
| Work-item unit cost | `msdyn_liveworkstream.msdyn_CapacityRequired` (required whole number) | **High** — confirmed live against `academyexperiment` | Per-agent value used is the smallest `msdyn_CapacityRequired` among that agent's reachable voice workstreams |
| Presence | `systemuser` lookup `msdyn_presenceid` → `msdyn_presence` (`msdyn_name`); "allows assignment" inferred from the status **name** (e.g. "Available" vs. "Away"/"Busy"/"Offline") | **Low** | |
| Per-agent channel enablement | — | **Not attempted** | No defensible table/column found; always reported `unknown`. Queue membership + workstream reachability are the reliable proxy for practical voice access |
| Unified-routing exclusion/opt-out | — | **Not attempted** | No defensible source found; always reported `unknown`, same as this tool's own guidance for treating a licence check as unverifiable |

**If you can confirm the actual schema for any "Low"/"Not attempted" row in your own environment**, updating `dataverse.ts` to match will turn those checks from routinely-`unknown` into genuinely useful — the check logic and UI already fully support it, only the query needs correcting.

## Build, test, and run locally (no Dataverse connection needed)

```powershell
npm install
npm test
npm run demo:agentreadiness
```

Then open `http://localhost:5434/index.html` to explore the demo mode's 21 sample agents (or run `npm run build` yourself and `npx serve dist/webresource/agentreadiness -l 5434`).

## Deploy to a Dataverse environment

```powershell
pwsh ./scripts/deploy.ps1 -Tool agentreadiness -CreateIfMissing
```

Use `-CreateIfMissing` the first time (creates the three web resources and adds them to the solution); omit it for routine redeploys. See the [toolbox README](../../Readme.md#deployment) for how deployment is configured. **The Site Map subarea is not created by the deploy script** — see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#site-map-subarea) for the exact steps to add it, same as the other two tools.
