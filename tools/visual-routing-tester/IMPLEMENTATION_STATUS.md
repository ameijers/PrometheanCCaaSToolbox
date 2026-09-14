# Visual Routing Tester — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md) for the tool overview. This document covers Visual Routing Tester's technical implementation specifically — future tools should get their own status doc alongside it under `tools/<tool>/`.

## Architecture

- Plain HTML/CSS/React (TypeScript) app, deployed as three Dataverse **web resources** (`index.html`, `bundle.js`, `style.css`) — not a PCF control, not a Custom Page. A PCF control binds a reusable component to a single field/form/view; this tool is a standalone full-page diagnostic app with no data binding to any one record or column, which is a web-resource-shaped problem, not a PCF-shaped one.
- Hosted via a classic Site Map subarea (`Type="Web resource"`) inside a model-driven app, so it appears as ordinary navigation — no custom entity, no record to open.
- Repo layout: `tools/visual-routing-tester/{src,tests,webresource,css}`, with shared build tooling (`webpack.config.js`, `tsconfig.json`, `jest.config.cjs`, `package.json`) at the repo root. This is the first tool in what will become a multi-tool "Promethean CCaaS Toolbox" — `webpack.config.js` uses one named entry per tool (`routingtester` today), each building to its own `dist/webresource/<tool>/bundle.js`; adding a tool is one more entry line.
- Everything reads Dataverse read-only through `Xrm.WebApi` (resolved from `window`, `window.parent`, or `window.top` to support iframe/web-resource hosting) plus one direct `fetch` against the Web API for a single unbound function (`LocalTimeFromUtcTime`) that `Xrm.WebApi` has no wrapper for. The tool never writes to Dataverse.

## Complete

- **Real two-stage routing pipeline**, matching how Unified Routing actually works (not how the original README guessed it worked): **Work classification** (enrichment — sets attributes, doesn't pick a queue) runs first, then **Route to Queue** (picks a destination queue — or, on the legacy path, an agent directly — and can condition on whatever classification just set) runs second and feeds into queue overflow.
- Routing-configuration-step types read from `msdyn_routingconfigurationstep.msdyn_type`: Enrichment (`192350000`), Queue identification (`192350002`). Skill/Agent-group identification (`192350001`/`192350003`) is deliberately **not** parsed — skill-based in-queue routing isn't simulable in a useful way, so the tool only surfaces a warning when a workstream configures it, rather than fabricating behavior.
- Dependency-free DMN-style decision-table XML parser (`src/ruleXml.ts`) for `msdyn_decisionruleset.msdyn_rulesetdefinition`: quote-aware regex (so `operator=">="` doesn't break tag matching), hit-policy (`first`/`all`) extraction, nested `<logical>` condition groups, and percentage-based weighted-distribution actions (`<upsertrecords><target>percentagebaseddistribution</target><records><record>...` — a single rule routing to several queues by weighted random split).
- Hit-policy–aware evaluation: `"first"` stops at the first matching rule; `"all"` evaluates every rule with a later match overriding an earlier one for the same output. This genuinely differs per ruleset in real data (a workstream's classification ruleset used `"first"` while its queue-routing ruleset used `"all"`), so it's read from each ruleset's own XML, never assumed.
- Two context-variable condition prefixes recognized: `msdyn_ocliveworkitem.<name>` (system fields) and `liveworkitemcontext.<Name>` (custom context variables) — both confirmed against real condition XML.
- **Real operating-hours evaluation.** A queue's actual calendar is fetched and flattened (`src/dataverse.ts`'s `loadOperatingHoursByOpHourId`): the outer weekly-recurrence rule (`FREQ=WEEKLY;BYDAY=...`, an optional `INTERVAL`, and a validity date range) plus the separate "inner calendar" rule that holds the actual daily time window (`offset`/`duration` in minutes) it points to via `_innercalendarid_value`. A pure, fully unit-tested function (`src/operatingHours.ts`) then checks a given local time against those rules. The local time itself comes from Dataverse's own `LocalTimeFromUtcTime` unbound function (called via a same-origin `fetch`, since `Xrm.WebApi` has no wrapper for unbound functions) — this avoids shipping a guessed Windows-timezone-id → UTC-offset table.
- Simulation inputs:
  - IVR context values (real `msdyn_ocliveworkstreamcontextvariable` rows, typed Text/Number/Boolean/Entity Reference).
  - A global **simulation time** (date + time picker), which drives any operating-hours overflow condition.
  - **Per-queue** simulated overflow values (wait time, queue size, operating-hours override) — scoped per queue, not shared globally, because a call can overflow ("Queue Transfer") from one queue into another mid-simulation and each queue's own state must be independent. These live inline in each queue's own expandable card in the diagram, not in the always-visible sidebar, so the UI stays bounded no matter how many queues a workstream reaches.
- Full routing diagram: entry → classification (enrichment) → route-to-queue rules (with a distinct fallback/no-match node) → reachable queues, including queues **only** reachable via an overflow Queue Transfer (not just direct routing-rule/fallback targets — this closure is computed via a small BFS over each queue's own overflow-rule transfer targets) → outcome nodes for all eight real overflow-action outcomes, with unreachable outcomes visually dimmed. Pan/zoom, independent search-and-highlight by name, click-to-inspect detail drawer on every node type.
- Simulation trace supports instant (Run), animated (Play), and manual step-by-step (Step/Back) reveal, chaining through "Queue Transfer" overflow outcomes to a different queue (bounded to 5 hops, with a warning if hit), using each queue's own simulated values rather than leaking one queue's values into the next.
- **Saved scenarios**: captures IVR values, every queue's simulated overflow inputs, and the simulation time together; scoped per workstream (only scenarios saved under the currently selected workstream are shown); explicit Save/Load buttons (name field + Save; each row has Load and delete) instead of a browser `prompt()` dialog. Browser-`localStorage` only — not synced to Dataverse or shared between users/devices.
- Persistent "Configuration warnings" panel surfaces load-time issues (no workstreams found, a rule pointing at a missing queue, an unparseable ruleset or calendar shape, a workstream using an assignment step type this tool doesn't parse) even before a simulation is run, plus a banner when the selected workstream is inactive.
- Text trace export.
- Automated test coverage through `npm test`: **33 tests** across three suites — `ruleXml.test.ts` (XML parsing against real ruleset XML captured from the live environment, including the percentage-distribution shape), `evaluator.test.ts` (rule ordering, hit-policy first/all, OR/AND logic, direct-to-agent routing, weighted-target selection, Queue Transfer chaining with per-queue value isolation, the loop-guard, `notNull` guard semantics, context-variable validation), and `operatingHours.test.ts` (weekday/time-window matching, validFrom/validTo bounds, interval-week recurrence, multiple daily windows).

## Real-schema findings (confirmed against a live, populated environment)

These came from directly querying a live Dynamics 365 Contact Center environment (Contoso Voice/Sales/Parts demo data), not from documentation:

- Classification/routing rules live in `msdyn_liveworkstream` → its active `msdyn_routingconfiguration` → ordered `msdyn_routingconfigurationstep` rows → the `msdyn_decisionruleset` each step references. The legacy `msdyn_ocruleitem` table is only used as a fallback when a workstream has no active routing configuration at all.
- `msdyn_decisionruleset.msdyn_rulesetdefinition` is XML (a DMN-style decision table), not JSON.
- An overflow rule's action sets `overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid` to a GUID; that `msdyn_overflowactionconfig` record's `msdyn_overflowactiontype` is the real outcome — eight real values (Default, End Conversation, Transfer to Phone, Direct Callback, Voicemail, Queue Transfer, Remain In Queue, Scheduled Callback). "Queue Transfer" carries its target queue GUID in `msdyn_overflowactiondata`.
- Queues have two independent overflow rulesets: `msdyn_prequeueoverflowrulesetid` (evaluated before joining) and `msdyn_inqueueoverflowrulesetid` (evaluated while waiting) — both read; the evaluator tries pre-queue first, then in-queue.
- A queue's assignment method is just the `msdyn_assignmentstrategy` enum (Omnichannel Assignment / Round Robin / Custom Assignment Configuration / Longest Idle / No Assignment) — there is no per-queue conditional "assignment ruleset" in any environment checked.
- `msdyn_direction` = `0` is Inbound (`1` Outbound, `2` Direct Inbound, `3` Direct Outbound, `4` ProactiveOutbound).
- Context-variable datatypes are Text/Number/Boolean/Entity Reference only (`msdyn_datatype`: `192350000`/`192350001`/`192350002`/`192350100`) — no Date or Choice/OptionSet.
- A queue-routing rule can assign directly to an agent (legacy `msdyn_ocruleitem` path, `msdyn_assignedto` = Agent), bypassing queue routing entirely — the evaluator short-circuits straight to the Agent outcome.
- Overflow conditions reference system queue-state attributes (`queue_prequeue.estimatedwaittimeinminutes`, `queue_prequeue.currentqueuesize`, `queue_prequeue.iswithinoperatinghour`, `queue_inqueue.lapsedwaittime`) — never caller-supplied context variables. `queue_prequeue.*` is a live forecast checked **before** the caller joins (e.g. "if this caller joined right now, how long would they be predicted to wait" — not a delay before joining); `queue_inqueue.*` is the caller's own actual elapsed time once already waiting.
- A single Route-to-Queue rule can target several queues at once via a percentage-based weighted distribution (`queuedetails.queueid` + `queuedetails.percentage` per record) rather than a single `assign_to.queue` — the simulator picks one at random, weighted, and records the pick in the trace.
- A workstream's fallback queue (`msdyn_liveworkstream.msdyn_defaultqueue`) is used when no Route-to-Queue rule matches.
- A queue's operating hours are a two-level calendar: `queue._msdyn_operatinghourid_value` → `msdyn_operatinghour.msdyn_calendarid` → an outer `calendar_calendar_rules` entry (weekly recurrence pattern + timezone code + validity range) whose `_innercalendarid_value` points to a second calendar holding the actual daily `offset`/`duration` window.

## Known environment quirks worked around

Two Dataverse Web API quirks were found and fixed during live validation — worth documenting since they're non-obvious and could resurface with any newly-added `$select` field:

- **A plain `$select` can silently omit a lookup's value with no error.** `msdyn_liveworkstream.msdyn_defaultqueue` never returns `_msdyn_defaultqueue_value` when selected by its bare logical name in this environment — no error, the field is just missing from the response. Only `$expand=msdyn_defaultqueue($select=queueid)` reliably returns it. This is why the fallback queue appeared "missing" for a while even though the underlying data was always correct.
- **A misdeclared navigation-property name causes a 400 on an otherwise-valid attribute.** `queue.msdyn_prequeueoverflowrulesetid`'s own navigation property is registered as `msdyn_decisionrulesetid` instead of matching its logical name (confirmed by dumping the raw `$metadata` CSDL; its sibling `msdyn_inqueueoverflowrulesetid` is named correctly). Selecting the bare name 400s; selecting the underscored alias `_msdyn_prequeueoverflowrulesetid_value` works and returns the real data.
- A resilient `readSelect()` helper drops one column at a time and retries (with a user-facing warning) rather than failing an entire read when a single selected column turns out not to be queryable this way in a given environment/API version.

## Still open / not yet verified

- **Skill identification / Agent Group identification routing steps** — no environment checked has actually used one, so the exact XML action shape (what attribute it sets, presumably something like `assign_to.agentgroup`) is still unknown. Only a warning is surfaced; no data is fabricated for it. This is also a deliberate scope boundary, not just a gap: skill-based in-queue routing doesn't simulate usefully even if the shape were known.
- **A classification rule referencing a custom context variable via `liveworkitemcontext.<Name>` with a non-trivial operator** (contains/greater-than/etc., not just equals) — real examples so far cover the prefix and equals/contains, but not every operator combination.
- **Multiple simultaneously-matching rules under `hit-policy="all"` with genuinely conflicting outputs** — every real ruleset sampled either had independent conditions or a clear last-match-wins case; broader confirmation of the override behavior across more complex real rulesets would still strengthen confidence.
- **Holiday-schedule overrides on an operating-hours calendar** (`calendar._holidayschedulecalendarid_value`) — present in the schema, not yet observed populated in any real calendar checked, so not implemented; a calendar with one configured would currently be evaluated without accounting for holiday closures.

## Deploy

Via `scripts/deploy.ps1`, driven by `deploy.config.json` (no CI pipeline, no `pac solution` project — the earlier PCF-era `Solution/` folder was removed as stale). `deploy.config.json` names the target environment(s) (currently just `dev` → `academyexperiment.crm.dynamics.com`, unmanaged solution `ccaasvisualroutingtester`) and, per tool, which local files stage/build to which Dataverse web resource names. This is the durable, checked-in answer to "which solution do the tools deploy to" — it doesn't live only in a session's memory or a person's head.

```powershell
npm install
npm test
pwsh ./scripts/deploy.ps1 -Tool routingtester
```

The script builds, stages the non-webpack files (html/css), stamps a fresh `?v=` cache-buster automatically (nobody has to remember to bump one by hand), looks up each web resource's GUID live by name (GUIDs are never hardcoded — `webresourceset.name` is immutable but a resource could still be recreated), PATCHes content, publishes, and verifies by reading the live content back before declaring success. Add `-CreateIfMissing` the first time a new tool's web resources don't exist yet in the target environment (creates them and adds them to the solution); leave it off for routine redeploys.

## Run the UI locally (demo data, no Dataverse connection)

```powershell
npx serve dist/webresource/routingtester -l 5432
```

Then open `http://localhost:5432/index.html`. Re-run `npm run build` after any source change (no live-rebuild watch is wired up). The bundled demo data includes a Queue Transfer example (set "Current queue size before joining" ≥ 5 on the Netherlands priority queue and run) so that path is exercisable without a live connection.
