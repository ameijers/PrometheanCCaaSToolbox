# Environment Artifact Finder — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md) for the tool overview and the full per-check/per-table reference. This is the toolbox's fourth tool.

## Purpose

A "what could I clean up?" report for Contact Center configuration. It finds records that nothing active uses anymore (structural orphans), records that are wired in but can never do anything (functional dead-ends), references that point to deleted or deactivated records (broken references), plus a separate housekeeping list (old bulk-delete jobs, stale saved views). It **only recommends**: it never writes, and every finding is framed as "candidate for review", because Dataverse read access can't see every place a record might be used.

## Step 0 — discovery and schema verification

Done before any check logic was written. Sources checked: the other three tools' data layers (`visual-routing-tester/src/dataverse.ts`, `agent-readiness-checker/src/dataverse.ts`, `context-variable-monitor/src/dataverse.ts`), their READMEs/IMPLEMENTATION_STATUS "real-schema findings", and the packaged solution zip.

**The solution zip holds no entity metadata.** `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_3.zip` contains only the toolbox's own web resources, the model-driven app and its Site Map (`customizations.xml`). There's no `cts_*` table definition or relationship metadata anywhere in the repo, so nothing about `cts_*` can be verified from repo contents.

### Verified in this repo (live-confirmed by an earlier tool)

| Table | Fields / relationships reused | Confirmed by |
| --- | --- | --- |
| `msdyn_liveworkstream` | `msdyn_name`, `statecode`, `msdyn_direction`, `msdyn_enablevoicev2` (the voice signal); `msdyn_defaultqueue` fallback queue **only via `$expand`** (a plain `$select` of its `_value` silently comes back empty) | VRT, ARC |
| `msdyn_routingconfiguration` | `_msdyn_liveworkstreamid_value` (parent workstream), `msdyn_isactiveconfiguration` | VRT, ARC |
| `msdyn_routingconfigurationstep` | `_msdyn_routingconfigurationid_value`, `_msdyn_rulesetid_value`, `msdyn_type` (`192350000` classification, `192350001` skill identification, `192350002` queue identification, `192350003` agent-group identification) | VRT, ARC |
| `msdyn_decisionruleset` | `msdyn_rulesetdefinition` (decision XML — parsed with VRT's `parseDecisionXml`), `msdyn_disabledrules`, `statecode`; queue targets are `assign_to.queue` / `queuedetails.queueid`; overflow rules point at `overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid` | VRT, ARC |
| `queue` | `_msdyn_operatinghourid_value`, `_msdyn_prequeueoverflowrulesetid_value`, `_msdyn_inqueueoverflowrulesetid_value`, `msdyn_isomnichannelqueue` | VRT |
| `msdyn_overflowactionconfig` | `msdyn_overflowactiontype` (formatted value "Queue Transfer"), `msdyn_overflowactiondata` (target queue id for a transfer) | VRT |
| `msdyn_operatinghour` | `msdyn_calendarid` | VRT |
| `msdyn_ocliveworkstreamcontextvariable` | `_msdyn_liveworkstreamid_value`, `msdyn_name`, `msdyn_isdisplayable`; used in rule conditions as `liveworkitemcontext.<name>` or `msdyn_ocliveworkitem.<name>` | VRT |
| `msdyn_ocruleitem` (legacy routing rules) | `_msdyn_liveworkstream_value`, `_msdyn_queueassignid_value`, `_msdyn_cdsqueueassignid_value` | VRT |
| `queuemembership` | `queueid`, `systemuserid` | ARC |
| `characteristic`, `bookableresourcecharacteristic` | `characteristic.name`; the join row's `characteristic` lookup (ARC expanded it as `Characteristic`; this tool reads its `_characteristic_value` alias by the standard convention) | ARC |
| `msdyn_capacityprofile`, `msdyn_bookableresourcecapacityprofile` | `_msdyn_capacityprofileid_value` on the join row | ARC |

### Not verifiable from the repo

`msdyn_decisioncontract`, `msdyn_templateruleset`, `msdyn_assignmentconfiguration`, `msdyn_assignmentconfigurationstep`, `msdyn_notificationtemplate`, `msdyn_liveworkstreamcapacityprofile`, `msdyn_ocvoice`, `msdyn_ocvoicechannelsetting`, `msdyn_ocvoicechannellanguagesetting`, `msdyn_omnichannelconfiguration`, `msdyn_soundnotificationsetting`, `msdyn_oclocalizationdata`, `cts_openinghour`, `cts_contactcenter`, `cts_servicenumber`. `userquery`, `savedquery`, `systemuser` and `bulkdeleteoperation` are standard Dataverse tables whose core columns are well documented, but none of the earlier tools has read them live.

### Design decision this forced: discover relationships live, don't guess field names

For the unverifiable tables, the tool doesn't hardcode any lookup column name. Instead:

1. **The reference map declares intent at table level only.** For example: "a `cts_servicenumber` is kept in use by an `msdyn_ocvoice` or `msdyn_liveworkstream` it is linked to", or "`msdyn_notificationtemplate` is expected to be referenced by workstreams". It never names a guessed column.
2. **At scan time, the actual lookup columns are read from Dataverse's own relationship metadata** (`EntityDefinitions(LogicalName='…')/ManyToOneRelationships`, a read-only GET). Every lookup from one in-scope table to another becomes an edge in the reference graph. It's labelled "discovered" so the Coverage tab and README can tell it apart from repo-verified edges.
3. **If a table has no known relationships at all, its records are not evaluated.** No curated edge and nothing discovered means the Coverage tab shows "Not evaluated". The tool doesn't flag every record in a table it knows nothing about.
4. **If a table can't be read, only that table degrades.** A missing table, missing permission or failed metadata read marks that table "Not available". Any finding that depended on it drops to Medium confidence with the reason stated. The rest of the scan continues.
5. **Every table can be switched off in `src/referenceMap.ts`** (`enabled: false`). That's the feature flag for tables that turn out not to exist or not to apply.

### Open questions for the product owner (proceeding with the stated assumption unless told otherwise)

1. **Direction of the "attached to" relationships for `cts_servicenumber`, `msdyn_ocvoice`, the voice channel settings and `msdyn_assignmentconfiguration`.** *Assumption:* whichever direction the live lookup runs, a record linked to an active owner of the declared type counts as in use (`keptAliveBy`).
2. **Non-voice channels (chat/SMS).** *Assumption:* out of scope for the channel/endpoint check, consistent with the rest of the toolbox (voice-only). Non-voice workstreams still get the inactive / no-routing / unreachable-targets checks.
3. **Which saved views count as "Contact-Center-relevant".** *Assumption:* views on queue, workstream, routing configuration, decision ruleset, conversation (`msdyn_ocliveworkitem`), session, characteristic, capacity profile, operating hour, context variable and the `cts_*` tables. The list is in `src/config.ts`.
4. **Bulk-delete job age threshold.** *Assumption:* 90 days since the job last changed. It's in `src/config.ts`.
5. **A "last used" signal for saved views.** *Assumption:* none is available through Dataverse read access, so the userquery check doesn't claim one.
6. **Conversation volume per queue** ("no recent conversation volume if cheaply checkable"). *Assumption:* not included in v1. Aggregating `msdyn_ocliveworkitem` by queue isn't a schema any tool here has verified. It's listed as a follow-up.
7. **`msdyn_ocvoicechannellanguagesetting`: "language not used by any workstream's locale configuration".** *Assumption:* not implemented. Where a workstream stores its locale isn't known. Only the parent-orphan part of the rule is implemented.
8. **`msdyn_templateruleset`: "zero active child rules".** *Assumption:* its child table is unknown, so only the reference check runs.

### Candidate additions — decisions

| Candidate | Decision | Why |
| --- | --- | --- |
| Chat/SMS channel tables | **Out** | No verified schema; the toolbox is voice-scoped. The workstream rule handles non-voice workstreams generically, without an endpoint check. |
| `calendar` | **Out** | `msdyn_operatinghour.msdyn_calendarid` is verified, but the calendar table also holds user work-hour and business-closure calendars. Flagging unreferenced calendars would be mostly noise. |
| `team` owning a queue with no members | **Out** | That's agent-readiness territory, not an unused record. |
| Survey / post-conversation tables | **Out** | Environment-specific, no verified schema. |
| Quick replies / macros / articles | **Out** | Not part of routing configuration; usage by agents isn't visible to Dataverse reads. |
| Environment variable definitions/values | **Out** | Their consumers (flows, canvas apps, plug-ins) are exactly what Dataverse reads can't see, so any finding would be misleading. |
| `msdyn_ocruleitem` (legacy routing rules) | **In, as a supporting read** | Needed so a workstream still on the legacy rule engine isn't reported as "has no routing". |
| `msdyn_ocphonenumber` | **In the config, disabled by default** | A plausible out-of-box phone-number table, but not in the requested list and unverified. Switch it on in `src/config.ts` / `src/referenceMap.ts` if your environment uses it. |

## Architecture

- Same shape as the other tools: plain HTML/CSS/React (TypeScript), deployed as a Dataverse web resource trio (`pct_/tools/artifactfinder/{index.html,style.css,bundle.js}`) and hosted through its own Site Map subarea. Built through the shared `webpack.config.js` (entry key `artifactfinder`) and deployed through the shared `scripts/deploy.ps1` (`-Tool artifactfinder`).
- Layers: `referenceMap.ts`/`config.ts` (declarative) → `dataSource.ts` interface, with `dataverse.ts` (live) and `demoData.ts` (sample) behind it → `scan.ts` (describe, discover, read, then a `Snapshot`) → `engine.ts` (the generic reference graph) → `rules.ts`/`housekeeping.ts` (pure checks) → `analyze.ts`/`aggregate.ts` → `App.tsx`. See the README's table.
- Reuses, as a read-only import of a pure function, Visual Routing Tester's `parseDecisionXml`, the same way Agent Readiness Checker does. Neither of those tools was modified.
- **Read-only:** `tests/readOnly.test.ts` fails if any `Xrm.WebApi` write method appears in `src/`, if any `fetch` uses a method other than GET, or if `fetch` appears anywhere other than `dataverse.ts`.

## Complete

- A generic reference-graph engine with lookup ("uses" / "belongs to") and id-mention edges; alive-ness through parent chains, with a cycle guard; a structural check whose confidence reflects coverage gaps; fixed-point "used only by other candidates" propagation; and broken-reference detection that follows "uses" lookups only.
- Live relationship discovery from `ManyToOneRelationships` metadata, classified by `keptAliveBy`, excluding system lookups, deduplicated against curated edges, with polymorphic lookups merged into one edge.
- 26 checks (see the README): 3 structural, 2 broken-reference, 17 functional/rule-based, 4 housekeeping.
- A data layer with `@odata.nextLink` paging, per-column drop-and-retry for columns the environment doesn't have, flattening of the `$expand`-only `msdyn_defaultqueue` lookup, retry without a rejected filter, and typed not-found / permission errors. Tables are read 4 at a time. A failing table degrades on its own.
- UI: Summary (counts, cleanup estimate, billed-number note, by entity, by check, skipped checks), Findings (filter, sort, paginate, detail panel with related-record links), Housekeeping, Coverage, and CSV/Markdown export. The disclaimer is on every view and in every export.
- Demo mode: a sample environment served through the `DataSource` interface. It includes one table that's missing, one with no permission, one disabled by configuration, and `cts_*` relationships that are discovered rather than curated. `tests/demoData.test.ts` asserts that every check in the `CHECKS` registry fires at least once and that a list of clean records produces nothing.
- Tests: 100 for this tool (`engine`, `rules`, `housekeeping`, `aggregate`, `dataverse` with mocked `Xrm.WebApi` and `fetch`, `scan`, `demoData`, `export`, `readOnly`). 272 across the repo.
- Deploy config and webpack entry. The offline part of `deploy.ps1 -Tool artifactfinder -CreateIfMissing` (config lookup, staging, file checks, cache-bust rewrite) was replayed successfully. The network part (token, create/patch, publish) wasn't run against a real environment, as the brief asked, and it's the same code the other three tools use.

## Still open / not yet verified

- **Nothing in this tool has been run against a live environment yet.** The verified-schema tables reuse live-confirmed findings from the other tools. Everything marked Unverified or Custom in the README depends on live discovery working as designed. The first live scan should be reviewed on the Coverage tab: which tables were found, which relationships were discovered, and whether each `keptAliveBy` classification looks right.
- Reading relationship metadata through `fetch` to `/api/data/v9.2/EntityDefinitions(...)`. The same-origin session technique is the one Visual Routing Tester already uses live, but this specific endpoint hasn't been exercised live by this tool.
- The open questions in "Step 0" above, especially whether chat/SMS channels should get an endpoint check.

## Follow-up ideas

- Queue conversation volume ("no work in the last N days"), once an aggregate over `msdyn_ocliveworkitem` by queue is verified live.
- A visual dependency graph for the selected record (reusing Visual Routing Tester's diagram), instead of the related-records list.
- Chat/SMS channel endpoint checks, once the channel tables are confirmed.
- Per-table on/off toggles in the UI, instead of only in `referenceMap.ts`.
- Following `msdyn_operatinghour` → `calendar` to flag operating hours whose calendar has no rules left.

## Site Map subarea

Not created by the deploy script, and not yet in the packaged solution (`PrometheanCCaaSToolbox_1_0_0_3.zip`). After `deploy.ps1 -Tool artifactfinder -CreateIfMissing` has created the three web resources:

1. In the maker portal ([make.powerapps.com](https://make.powerapps.com)), open the **PrometheanCCaaSToolbox** solution.
2. Open the **Promethean CCaaS Toolbox** app's Site Map in the Site Map designer (App → Site map → Edit).
3. In the existing **Tools** group, add a new **Subarea**:
   - **Title:** `Environment Artifact Finder`
   - **Type:** Web Resource
   - **Web Resource:** `pct_/tools/artifactfinder/index.html`
   - Keep Client/Availability/Sku the same as the existing subareas (all clients, available offline).
4. Save and publish the Site Map, then publish the app.
5. Open the app and confirm the new subarea loads `pct_/tools/artifactfinder/index.html`.

Re-export the solution afterwards if the packaged zip in `power_platform_solution/` should include this tool.

## Build & test locally

```powershell
npm install
npm test
npm run demo:artifactfinder   # http://localhost:5435/index.html
```

## Deploy

```powershell
pwsh ./scripts/deploy.ps1 -Tool artifactfinder -CreateIfMissing   # first time
pwsh ./scripts/deploy.ps1 -Tool artifactfinder                    # afterwards
```
