# Agent Readiness Checker

Part of the [Promethean CCaaS Toolbox](../../Readme.md). For step-by-step usage instructions and screenshots, see the [manual](manual.md).

## What it does

Agent Readiness Checker answers the question **"why isn't this agent receiving calls?"** for **Dynamics 365 Contact Center** (unified routing) administrators. Pick an agent (or scan the whole roster) and it evaluates them against every prerequisite for receiving voice work — account status, security roles, channel enablement, queue membership, whether an active workstream can actually reach them, capacity, skills, presence, and whether they're currently blocked from new work by capacity — and reports which checks pass, warn, fail, or couldn't be verified, each with the actual evidence found, why it matters, and a plain-language suggested fix.

Typical uses:
- An agent says they're not getting calls — find the actual structural reason (disabled account, missing role, wrong queue, insufficient capacity, missing skill…) instead of guessing.
- Sweep the whole roster after an onboarding batch or a routing-configuration change to catch agents who were set up incorrectly.
- Confirm a specific fix actually resolved the issue by re-running the check.

## Key features

- **Bulk view:** every agent with an overall status (Ready / Warning / Not ready / Not verifiable), failed-check count, and a one-line top issue. Searchable by name/domain, filterable by status/queue/workstream/role group, sortable by every column, paginated (5 per page). The summary strip's counts describe exactly what's currently filtered, and each count is clickable to filter the list by that status.
- **Live role picker:** connecting is one click — it loads immediately using a remembered or best-guess role selection, never a forced setup step. A **"Configure roles…"** link (next to the sidebar's Role filter) opens a small popup with one dropdown per group — Agent / Supervisor / Omnichannel Admin — to pick exactly which of this environment's *actual*, alphabetized security roles each one means. Nothing is guessed from a fixed name list once you've confirmed a pick, since real orgs rename and clone out-of-box roles (see "How it works" below); your picks are remembered in the browser.
- **Detail view:** the full 9-check checklist for one agent, grouped by category, each with its status, the actual evidence read, why the check matters, and a suggested fix.
- **Summary header:** counts across the environment plus the single most common failing check, so a systemic problem (e.g. "half the roster is missing a security role") is obvious at a glance.
- **Overall status rule:** any failing check → Not ready; else any warning → Warning; else any unverifiable check → Not verifiable; else Ready.
- Export both views to CSV and Markdown, client-side, no server involved.
- A fully working offline demo mode with 25 hand-authored sample agents covering every check outcome — no Dataverse connection required to see the tool in action.

This is a **strictly read-only** tool: it never creates, updates, or deletes any Dataverse record. A static test (`tests/readOnly.test.ts`) fails the build if any Xrm.WebApi write method ever appears in `src/`.

## How it works

Same shape as the other two tools: a plain HTML/CSS/React (TypeScript) app, deployed as a trio of Dataverse web resources and hosted via its own Site Map subarea — see the [toolbox README](../../Readme.md#architecture) for why this toolbox defaults to web resources over PCF controls.

Architecture is deliberately layered so the actual diagnostic logic needs neither React nor a live Dataverse connection to test:
- **`dataverse.ts`** — the only file that touches `Xrm.WebApi`. Builds an `AgentRecord` per agent, where every field that depends on schema this tool couldn't fully verify is wrapped in a `Field<T>` (`{ known: true, value }` or `{ known: false, reason }`) instead of ever silently guessing.
- **`checks.ts`** — 9 pure functions (no I/O), one per check category, each taking an `AgentRecord` and returning one `CheckResult`. Fully unit-tested.
- **`aggregate.ts`** — the overall-status rule and roster-wide summary, also pure and tested.
- **`demoData.ts`** — 25 hand-authored `AgentRecord`s exercising every check outcome, used until "Connect environment" is clicked.
- **`export.ts`** — pure CSV/Markdown string builders (tested) plus a thin, untested browser-only download trigger.
- **`App.tsx`** — the UI, consuming only the above.

"Agent" is defined as anyone holding at least one of the roles picked in the live role picker (Agent / Supervisor / Omnichannel Admin), **directly or via a Dataverse Team** the role is assigned to — Dataverse grants a role to every member of a team it's assigned to, not just users with their own direct role assignment, and a real environment was found (see `IMPLEMENTATION_STATUS.md` "Round 9") where a team held a role no individual user held directly. Queue membership alone is deliberately **not** enough to appear on the roster: an earlier version also included any queue member, but live testing showed queues can contain users who were never meant to be agents at all (e.g. incidental/legacy queue membership), producing a roster full of "failing" checks for people who were never going to receive calls.

Role *names* are never guessed against live data — an even earlier version shipped with a fixed list of common out-of-box role names (`config.ts`'s `DEFAULT_ROLE_GROUPS`), but live testing found an environment where the Omnichannel Supervisor role had been renamed to `D365CC-Omnichannel-Supervisor`, which no fixed name list could ever match, and connecting reported "no agents found" even though the environment was fully staffed. The tool now fetches every real role from the connected environment and asks you to pick which ones count as Agent/Supervisor/Omnichannel Admin (loosely pre-checking likely matches by keyword as a starting point); `DEFAULT_ROLE_GROUPS` is used only for that initial suggestion and for demo mode's hand-authored data, never applied directly to a live roster. The UI's role-group checkboxes (all checked by default, driven by whatever you picked) let you narrow the roster further, e.g. to just Agents.

For which queues an active inbound voice workstream can actually reach, this tool reuses (read-only import, no changes made to that tool) [Visual Routing Tester](../visual-routing-tester/README.md)'s already-verified `msdyn_liveworkstream`/routing-configuration schema and its pure `parseDecisionXml` rule-XML parser, rather than re-deriving that from scratch.

## Schema assumptions — please read before trusting live results

Unlike the other two tools, most of this tool's schema shipped **unverified** against a live environment (see `IMPLEMENTATION_STATUS.md` for why) and was corrected afterward as live access became available — every row below is now confirmed against a live environment except the exact JSON shape of a per-queue skill requirement, which stays an honest best-effort guess. Two rows were resolved not by finding the "right" table but by confirming no independent one exists — see Rounds 6 and 7. Every field degrades gracefully to **"Not verifiable"** in the UI if the underlying query fails — it never crashes and never presents a guess as a confirmed fact — but the confidence table matters for judging how much to trust a "pass" or "fail" you see:

| Data | Table(s) / column(s) used | Confidence | Notes |
| --- | --- | --- | --- |
| Account enabled/access mode | `systemuser`: `isdisabled`, `accessmode` | **High** — standard Dataverse | |
| Security roles | `systemuserroles` (direct) + `teammembership`/`teamrolescollection` (via Dataverse Team) — merged into one de-duplicated list, `role` for names | **High** — standard Dataverse tables, team-role grant path confirmed live (see IMPLEMENTATION_STATUS.md "Round 9") | Which role *names* count as Agent/Supervisor/Admin is chosen live, per environment, via the in-app role picker (see "How it works" above) — never guessed from a fixed list |
| Queue membership | `queuemembership`: `queueid`, `systemuserid` | **High** — standard Dataverse, same `queue` table Visual Routing Tester already verified | |
| Workstream reachability | `msdyn_liveworkstream`, `msdyn_routingconfiguration(step)`, `msdyn_decisionruleset` | **High** — reused from Visual Routing Tester's live-verified schema | |
| Skills (agent's own) | `bookableresource` (`_userid_value`), `bookableresourcecharacteristic` (lookup `resource`, expand `Characteristic($select=name)`/`RatingValue($select=name,value)`), `characteristic`, `ratingvalue` | **High** — confirmed live against `academyexperiment` via EntityDefinitions metadata | The lookup to the owning resource is named `resource`, not `bookableresourceid` as first guessed, and the `$expand` navigation properties use PascalCase schema names (`Characteristic`, `RatingValue`) — simple value fields don't work this way, but lookup navigation properties often don't match their lowercase `_value` alias casing |
| Required skills per queue | **Whether** a queue's reaching workstream(s) have a Skill identification routing step at all (type code `192350001`) is **High** confidence — confirmed live against `academyexperiment` (see IMPLEMENTATION_STATUS.md "Round 7"): a real environment's three inbound voice workstreams had *none*, which is itself the answer, not a gap. **What** a step, when one exists, actually requires is parsed by looking for a set-attribute whose name contains "characteristic"/"skill" | **High** (step presence) / **Low** (parsed content when a step exists) | A queue with no Skill identification step at all gets `required: []` (confirmed, not a guess) — never `unknown` for that reason alone. `required: null` (unknown) is now reserved for the genuinely rarer case of a step that exists but has no ruleset attached, or whose ruleset this tool's parser doesn't recognize |
| Agent capacity | `bookableresource` (`_userid_value`) → `msdyn_bookableresourcecapacityprofile` (lookup `msdyn_bookableresourceid`, own `msdyn_maxunits` override) → `msdyn_capacityprofile` (expand `msdyn_capacityprofileid($select=msdyn_name,msdyn_defaultmaxunits)`) | **High** — confirmed live against `academyexperiment` (three rounds of correction — see IMPLEMENTATION_STATUS.md) | Capacity is **per-profile, not a single number** — a real agent had separate "Default voice inbound" and "Default voice outbound" assignments. `systemuser.msdyn_capacity` (this tool's first *and* second guess) exists but sits outside this relationship entirely and was confirmed empty on an agent who still had profiles assigned in the admin UI — do not use it. The check picks whichever assigned profile's name mentions "inbound", falling back to the smallest effective value across all of them |
| Work-item unit cost | `msdyn_liveworkstream.msdyn_capacityrequired`, gated by `msdyn_capacityformat` (option set, confirmed live: `192350000` = "Unit based", `192360000` = "Profile based") | **High** — confirmed live against `academyexperiment` (four rounds of correction — see IMPLEMENTATION_STATUS.md) | `msdyn_capacityrequired` is only used as a comparable unit cost when the workstream's format is "Unit based" — under "Profile based" (confirmed to be **every** inbound voice workstream in a real environment) it is not meaningfully comparable to the agent's capacity at all, and a non-zero capacity-profile assignment is sufficient on its own. Getting this wrong produced a real false "capacity too low" failure |
| Presence | `msdyn_agentstatus` (lookup `msdyn_agentid` → the agent; `msdyn_isagentloggedin` boolean; expand `msdyn_currentpresenceid($select=msdyn_name)` → `msdyn_presence`); "allows assignment" inferred from the status **name** (e.g. "Available" vs. "Away"/"Busy"/"Offline") | **High** (the table, lookups, and login flag) / **Medium** (the "allows assignment" name-based inference, still a heuristic) — confirmed live against `academyexperiment` | Two wrong guesses before this: `msdyn_presenceid` doesn't exist, and `systemuser.msdyn_defaultpresenceiduser` exists but is a **default/preference** setting, not live status — confirmed empty on a real agent who was actively logged in, which produced a false "may never have signed in" result. `msdyn_agentstatus` is the real live-status table, distinct from both |
| Per-agent channel enablement | Derived from the same queue-membership + workstream-reachability data as the Queue membership / Workstream reachability checks — no independent table read | **High** — confirmed directly by a real environment's own administrator (see IMPLEMENTATION_STATUS.md "Round 6") | This product has **no separate per-agent channel toggle at all**; voice access is entirely implicit in queue/workstream routing. Two schema hypotheses (a "Channel Profile" table/relationship) were investigated and ruled out — a real, queryable N:N relationship exists (`systemuser` ↔ `msdyn_channelprofile`) but the environment's admin confirmed nothing by that name appears anywhere in the channel-management UI, and the table was empty in every environment checked |
| Unified routing state (blocked from new work by capacity) | `msdyn_agentstatus.msdyn_isblockedbysomeprofile` — read from the same row as presence, not a separate query | **High** — confirmed live against `academyexperiment` (see IMPLEMENTATION_STATUS.md "Round 7") | No separate "explicitly excluded/opted out" admin toggle was found to exist in this product after a broad search across `systemuser`/`bookableresource` for anything matching exclu/optout/workdistribution/routing-related names. This field is a different, genuinely useful signal instead: whether the agent is, right now, blocked from any new work because they're at the ceiling of every capacity profile assigned to them — a live condition (like presence) that self-clears, not a structural misconfiguration, so it warns rather than fails |

**If you can confirm the actual action/JSON shape a skill-identification step uses to set required skills in your own environment** (the one remaining "Low" confidence item), updating `extractRequiredSkills` in `dataverse.ts` to match will turn that from an occasional `unknown` into genuinely useful — the check logic and UI already fully support it, only the parser needs correcting.

## Build, test, and run locally (no Dataverse connection needed)

```powershell
npm install
npm test
npm run demo:agentreadiness
```

Then open `http://localhost:5434/index.html` to explore the demo mode's 25 sample agents (or run `npm run build` yourself and `npx serve dist/webresource/agentreadiness -l 5434`).

## Deploy to a Dataverse environment

```powershell
pwsh ./scripts/deploy.ps1 -Tool agentreadiness -CreateIfMissing
```

Use `-CreateIfMissing` the first time (creates the three web resources and adds them to the solution); omit it for routine redeploys. See the [toolbox README](../../Readme.md#deployment) for how deployment is configured. **The Site Map subarea is not created by the deploy script** — see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#site-map-subarea) for the exact steps to add it, same as the other two tools.
