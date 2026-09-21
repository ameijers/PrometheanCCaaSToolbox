# Agent Readiness Checker — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md) for the tool overview, including the full schema-assumptions confidence table. This is the toolbox's third tool.

## Purpose

Answer "why isn't this agent receiving calls?" by evaluating one agent (or the whole roster) against every structural prerequisite for receiving voice work through unified routing, with plain-language evidence and a suggested fix for each failure.

## Architecture

- Same shape as the other two tools: plain HTML/CSS/React (TypeScript), deployed as a Dataverse web resource trio, hosted via its own Site Map subarea. `tools/agent-readiness-checker/{src,tests,webresource,css}`, built via the shared root `webpack.config.js` (entry key `agentreadiness`) and deployed via the shared root `scripts/deploy.ps1` (`-Tool agentreadiness`).
- Read-only against Dataverse — see `tests/readOnly.test.ts`, a static guard that fails if any Xrm.WebApi write method (`createRecord`/`updateRecord`/`deleteRecord`/etc.) ever appears in `src/`.
- Layered so the actual diagnostic logic is testable without React or a live connection: `model.ts` (types, including the `Field<T>` "known value or explicit unreadable-reason" wrapper) → `checks.ts` (9 pure check functions) → `aggregate.ts` (overall-status rule + roster summary) → `dataverse.ts` (the only file touching `Xrm.WebApi`) → `App.tsx` (UI). `demoData.ts` and `export.ts` sit alongside, also pure/tested where feasible.
- Reuses (read-only import; no changes made to that tool) Visual Routing Tester's live-verified `msdyn_liveworkstream`/routing-configuration schema and its pure `ruleXml.ts` decision-XML parser, to determine which queues an active inbound voice workstream can actually reach.

## Why this tool's schema confidence is lower than the other two

Visual Routing Tester and Context Variable Monitor were both built and verified against a live, populated Contact Center environment (`academyexperiment.crm.dynamics.com`) during development — every table/column claim in their `IMPLEMENTATION_STATUS.md` is a confirmed finding, not a guess.

This tool's build session attempted the same approach — this repo already has an authenticated `pac`/`az` CLI session against that same environment, the same technique `scripts/deploy.ps1` itself uses to get a token — but the sandbox's permission layer blocked materializing a Dataverse access token as a "credential materialization" risk, and per the operator's own instructions that block was not routed around. So the account/security-role/queue-membership/workstream-reachability schema here is either reused from the other two tools' **confirmed** findings, or standard/well-documented Dataverse schema (systemuser, systemuserroles, role, queuemembership — all long-standing, stable core tables). Everything more Contact-Center-specific and newer (skills, presence, per-agent channel enablement) remains **unverified** and explicitly labeled as such in the README's confidence table, with every one of those fields wrapped so a schema mismatch degrades to "Not verifiable" in the UI rather than a silent wrong answer.

Capacity was originally in that unverified bucket too, but got corrected the same session — see below.

## Real-schema findings (confirmed against a live, populated environment)

After the build session shipped with a guessed capacity schema (a separate `msdyn_agentcapacityprofile` "capacity profile" entity, matching how administrators commonly talk about the concept), the person operating this session had live maker-portal access and checked it directly. The guess was wrong, and the real shape is simpler:

- **There is no separate "capacity profile" entity.** `systemuser.msdyn_Capacity` is a plain whole number directly on the user record — confirmed via Tables → systemuser → Columns in the maker portal.
- **The per-conversation cost lives on the workstream, not a routing step.** `msdyn_liveworkstream.msdyn_CapacityRequired` is a **required** whole-number column (display name "Capacity") — confirmed via Tables → Work Stream → Columns. Related columns seen on the same table (`msdyn_capacityformat`, `msdyn_blockcapacityforconsult`, `msdyn_blockcapacityforwrapup(inseconds)`, `msdyn_enabletotalconversationlimit`) were not needed for this tool's comparison but are there if a future check wants them.
- This significantly *simplified* `dataverse.ts` rather than complicating it: no `$expand` needed (it's a value field, not a lookup), no separate profile-name evidence to carry around, and `workItemUnitCost` — originally shipped as permanently `unknown` in live mode because no source was found — is now fully derived (the minimum `msdyn_CapacityRequired` across an agent's reachable voice workstreams).
- Lesson for future discovery on this tool: a plausible-sounding admin-UI concept name ("capacity profile") does not reliably predict the underlying entity shape. Checking Tables → Columns directly, even just via the maker portal UI with no CLI/token access at all, resolved this in a couple of minutes once someone with access looked.

**If a future session has live query access, the remaining highest-value targets are**: the skill-requirement action shape on the skill-identification routing step, the presence lookup field, and (if one actually exists) a real per-agent channel-enablement source — then update `dataverse.ts` accordingly. The check functions and UI need no changes; only the queries do.

## Complete

- 9 independent, unit-tested check functions covering account, security roles, channel enablement, queue membership, workstream reachability, capacity, skills, presence, and unified-routing exclusion — each returns pass/warn/fail/unknown with evidence, an explanation, and (except on pass) a suggested fix.
- Overall-status aggregation (fail > warn > unknown > pass) and a roster-wide summary (counts per status, most common failing check).
- Bulk view (search/sort/filter by status, queue, workstream) and detail view (full checklist grouped by category), both exportable to CSV and Markdown client-side.
- Data layer with paging (`@odata.nextLink`) and batched by-id reads to avoid N+1 queries against a large roster; "agent" is defined as the union of queue members and agent-role holders, so a role-holder never added to a queue is still surfaced.
- Every low-confidence field is isolated behind its own try/catch so one bad schema guess degrades only that field to "unknown" rather than failing the whole load.
- Demo mode: 21 hand-authored agents exercising every check's pass/warn/fail/unknown outcomes, including all seven explicitly required failure scenarios (disabled account, missing security role, voice channel disabled, queue membership only in an unused queue, no capacity configured, capacity too low for the work item, missing required skill).
- Automated tests: 134 passing across the whole repo (this tool's share: `checks.test.ts`, `aggregate.test.ts`, `dataverse.test.ts` with mocked `Xrm.WebApi` including paging, permission-denied cases, and the live-confirmed capacity/unit-cost derivation end-to-end, `export.test.ts`, `demoData.test.ts` asserting the sample data's outcome coverage, `readOnly.test.ts`).
- Capacity and work-item unit cost, both confirmed against a live environment (see above) — no longer "Not attempted" guesses.

## Still open / not yet verified

- **Skills-requirement parsing, presence, per-agent channels, unified-routing exclusion** — see the README's confidence table. These are the tool's honest limitations, not bugs; each degrades to "Not verifiable" rather than guessing.
- **Required-role config is a starting guess** (`src/config.ts`'s `REQUIRED_SECURITY_ROLE_NAMES`) — out-of-box role names vary by SKU/environment and by what an org renamed or cloned them to. Edit that file to match your environment's actual agent role name(s).
- **Very large rosters** — batched by-id reads (25 ids per OR-filter batch) and paging are implemented, but this hasn't been load-tested against a genuinely large (1000+ agent) environment.
- **Teams** — this tool evaluates individual `systemuser` agents only; team-based queue assignment or capacity is out of scope.
- **Chat/other channel workstreams** — deliberately scoped to inbound voice, matching the toolbox's existing tools and the original "why isn't this agent receiving calls" (voice) ask.

## Site Map subarea

Not created by the deploy script (same as the other two tools). The packaged solution's Site Map lives only inside the exported solution zip in `power_platform_solution/`, not as editable source in this repo, so add it manually after `deploy.ps1 -Tool agentreadiness -CreateIfMissing` has created the three web resources:

1. In the maker portal ([make.powerapps.com](https://make.powerapps.com)), open the **PrometheanCCaaSToolbox** solution.
2. Open the **Promethean CCaaS Toolbox** app's Site Map in the Site Map designer (App → Site map → Edit).
3. In the existing **Tools** group (the one already containing "Visual Routing Tester" and "Context Variable Monitor"), add a new **Subarea**:
   - **Title:** `Agent Readiness Checker`
   - **Type:** Web Resource
   - **Web Resource:** `pct_/tools/agentreadiness/index.html`
   - Leave Client/Availability/Sku the same as the existing two subareas (All clients, available offline).
4. Save and Publish the Site Map, then Publish the app.
5. Open the app and confirm the new subarea loads `http://<org>/.../pct_/tools/agentreadiness/index.html`.

## Build & test locally

```powershell
npm test
npm run demo:agentreadiness
```

Then open `http://localhost:5434/index.html`. No Dataverse connection needed to explore the demo mode.

## Deploy

```powershell
pwsh ./scripts/deploy.ps1 -Tool agentreadiness -CreateIfMissing
```

Not run against a real environment as part of this build session (per the task's own instruction) — the config was added to `deploy.config.json` and the script's existing logic reused as-is, unmodified.
