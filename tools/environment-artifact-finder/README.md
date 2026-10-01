# Environment Artifact Finder

Part of the [Promethean CCaaS Toolbox](../../Readme.md). For step-by-step usage with screenshots, see the [manual](manual.md). For how the tool was built, and the schema discovery behind it, see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## What it does

Environment Artifact Finder scans your **Dynamics 365 Contact Center** configuration and lists records that are likely leftovers. It answers "what could I clean up?", not "what is broken?". It reports four kinds of finding:

- **Structural orphans:** nothing active points to the record any more.
- **Functional dead-ends:** the record is wired in, but can never do anything. Examples: a voice workstream with no phone number, a queue that has members but that no route reaches, a ruleset whose rules are all disabled.
- **Broken references:** a step or link points to a record that was deleted or deactivated.
- **Housekeeping (on its own tab):** old finished bulk-delete jobs, and personal views that are stale or redundant.

> **It only ever recommends.** The tool never creates, updates or deletes anything. Every finding is a *candidate for review*, never "safe to delete". Reading Dataverse can't reveal every place a record is used: Power Automate flows, canvas and custom pages, Copilot Studio bots, plug-ins and scripts, other solutions, security configuration and code components can all depend on a record without leaving a trace in the tables scanned here. The UI shows this on every view, and it's included in every export.

## Key features

- **Summary dashboard:** counts by confidence and by entity, the reasons records were flagged, and an estimate of "if every High-confidence item were cleaned up, N records would be removed". Service numbers get a separate warning because they may be billed.
- **Findings list:** filter by entity, confidence and check type, search, sort any column, 10 per page.
- **Finding detail:** a plain-language explanation, why the confidence level is what it is, the evidence (what was checked, and what was or wasn't found), and the related records that still exist. When connected to a live environment, those records are links that open the record form. Each finding ends with a suggested next step, phrased as "review because…".
- **Housekeeping tab:** Category B findings, kept apart from the main list because the reasoning and the risk are different.
- **Coverage tab:** every table's status (scanned / not found / no permission / disabled), how well its schema is known, and every relationship that was or wasn't checked, with the reason.
- **Export:** CSV and Markdown of the current list. Both carry the disclaimer.
- **Offline demo mode:** a sample environment that triggers every check at least once, served through the same scan code path as a live environment.

## How it works

The code is split into layers so the logic can be tested without React or a Dataverse connection:

| Layer | File | Responsibility |
| --- | --- | --- |
| Reference map | `src/referenceMap.ts`, `src/config.ts` | Which tables are in scope, how each is evaluated, the relationships verified by the other tools, and tunable thresholds. |
| Data access | `src/dataSource.ts` (interface), `src/dataverse.ts` (live), `src/demoData.ts` (demo) | Reading tables and relationship metadata. `dataverse.ts` is the only file that talks to Dataverse. |
| Scan | `src/scan.ts` | Describes each table, discovers relationships, reads rows in parallel (4 at a time, paging through `@odata.nextLink`) and builds a snapshot. |
| Engine | `src/engine.ts` | The generic reference graph: who keeps whom in use, alive-ness through parent chains, the structural check, transitive propagation and broken references. |
| Rules | `src/rules.ts`, `src/housekeeping.ts` | Entity-specific functional checks and the Category B checks. All pure functions. |
| Aggregation | `src/analyze.ts`, `src/aggregate.ts` | Combines everything into findings and coverage; summaries, filtering and sorting. |
| UI | `src/App.tsx` | React. |

### The reference graph

Every relationship is an **edge** of one of three kinds:

- A **lookup** where the row *uses* the target. Example: a queue uses its operating hours.
- A **lookup** where the row *belongs to* the target (a parent). Example: a routing step belongs to its routing configuration. The parent keeps the child in use, not the other way round.
- A **content** edge: a record id mentioned inside a text column, such as a ruleset's rule XML. This is how queue targets, overflow actions and skills named inside rules are found. Record ids are GUIDs, unique across tables, so a mention can't be confused with another record.

A record is **alive** when it's active and, if its table belongs to parents, it's attached to an alive parent. That's evaluated through the whole chain, for example step → routing configuration → workstream. A record is **in use** when at least one alive record uses it.

- **Zero references:** `Nothing references it`. This is **High** only if every relationship that could point to the table was checked, and every table expected to reference it could be read. Otherwise it's **Medium**, and the evidence says what couldn't be checked.
- **References, but none alive:** `Only referenced by inactive or detached records`, **Medium**.
- **Used only by records this scan also flags:** `Only used by other cleanup candidates`, **Medium**. This propagates to a fixed point, so a chain of leftovers surfaces as a whole. For example, an unused overflow ruleset flags the voicemail action it points to.
- **A table with no known relationship at all is "Not evaluated"**, and none of its records are flagged. The tool never reports every record of a table it knows nothing about.

### Relationships are discovered live for unverified tables

For tables whose schema isn't verified in this repo (every `cts_*` table, the voice channel tables, assignment configuration and the rest in the table below), no lookup column name is hardcoded. At scan time the tool reads each table's relationship metadata (`EntityDefinitions(LogicalName='…')/ManyToOneRelationships`, a read-only GET). Every lookup from one in-scope table to another becomes an edge, marked "discovered".

The reference map only declares intent at table level, through `keptAliveBy`. For example, "a `cts_servicenumber` is in use when linked to an active `msdyn_ocvoice` or workstream". Whichever column the live environment uses, a lookup from a table to one of its `keptAliveBy` tables is treated as "belongs to"; any other lookup is treated as "uses". Ownership and audit lookups (`ownerid`, `createdby`, …) are ignored.

### Confidence

| Level | Meaning |
| --- | --- |
| **High** | Structural and fully checked: every known relationship to the table was read and none points to the record. Also: a broken reference to a record that was read and is deactivated. |
| **Medium** | Inferred from routing logic (e.g. "no route reaches this queue"), referenced only by deactivated records, or structural but with part of the data unreadable. Also: a reference to an id that wasn't found (deleted, or outside what you can read). |
| **Low** | A usage or housekeeping heuristic: unused context variables (bots and IVR can use them invisibly), superseded routing configuration versions, assignment configurations with no steps, and every Category B finding. |

## Every check

### Category A — reference-graph orphans, dead-ends and broken references

| Check | Applies to | Type | Confidence | What it means |
| --- | --- | --- | --- | --- |
| Nothing references it | every table with the generic check | Structural | High / Medium | No record in any scanned table points to it through any known relationship. |
| Only referenced by inactive or detached records | same | Structural | Medium | It is referenced, but only by deactivated records or records that belong to nothing active. |
| Only used by other cleanup candidates | same | Structural | Medium | Everything still using it is itself flagged. |
| Points to a record that doesn't exist | routing steps, assignment steps, workstream capacity profile links | Broken | Medium | A "uses" lookup holds an id that isn't found. Missing or deactivated *parents* aren't repeated here; the structural check already reports them. |
| Points to a deactivated record | same | Broken | High | A "uses" lookup points to a deactivated record. |
| Deactivated but still present | `msdyn_ocvoice`, `cts_contactcenter` | Functional | Medium | The record is deactivated. |
| Queue with no members and no route to it | `queue` (Omnichannel only) | Structural | High / Medium | No members, and no workstream, routing rule, fallback setting or overflow action mentions it. |
| No route reaches this queue | `queue` | Functional | Medium | No active workstream's routing (active configuration steps, legacy rules, fallback queue, and overflow Queue Transfers followed to a fixed point) delivers work to it. It may have members or be mentioned by inactive configuration. Manual transfers are invisible to the scan, and the finding says so. |
| Deactivated workstream | `msdyn_liveworkstream` | Functional | Medium | |
| Workstream with no routing | `msdyn_liveworkstream` | Functional | Medium | No routing step, no active legacy rule and no fallback queue. |
| Every routing target is gone | `msdyn_liveworkstream` | Functional | Medium | Every queue it can route to is deactivated or missing. |
| Voice workstream with no voice channel | voice workstreams | Functional | Medium | No voice channel record is linked to it. |
| Voice workstream whose channel is disabled | voice workstreams | Functional | Medium | Every linked voice channel record is deactivated. |
| Voice workstream with no phone number | voice workstreams | Functional | Medium | Worked example from the brief: an active voice channel, but no active phone/service number on the workstream or the channel. |
| Voice channel with no phone number | `msdyn_ocvoice` | Functional | Medium | |
| Routing configuration with no steps | `msdyn_routingconfiguration` | Functional | Medium | |
| Superseded routing configuration version | `msdyn_routingconfiguration` | Functional | Low | Another configuration of the same workstream is marked active. |
| Routing step targets a deactivated or missing queue | `msdyn_routingconfigurationstep` | Broken | High / Medium | A queue named in the step's rule XML is deactivated (High) or not found (Medium). |
| Ruleset with no active rules | `msdyn_decisionruleset` | Functional | Medium | No rules, or every rule listed in `msdyn_disabledrules`. Definitions in an unrecognized format are left alone. |
| Assignment configuration with no steps | `msdyn_assignmentconfiguration` | Functional | Low | Built-in assignment methods may legitimately have no steps. |
| Context variable never used in a rule | `msdyn_ocliveworkstreamcontextvariable` | Functional | Low | Not shown to agents (`msdyn_isdisplayable`), and no condition in any ruleset, and no legacy rule, reads it. |
| Extra Omnichannel configuration record | `msdyn_omnichannelconfiguration` | Functional | Medium (deactivated) / Low (older active) | Only when more than one record exists. |

Voice checks run only when a relationship between the voice channel or number tables and workstreams is known (discovered live). If none is known, they're skipped, and the Summary tab's "Not fully checked" list says so.

### Category B — housekeeping (Housekeeping tab, always Low)

| Check | Rule |
| --- | --- |
| Old finished bulk-delete job | `bulkdeleteoperation` with `statecode = 3` (Completed), `statuscode` 30/31/32 (Succeeded/Failed/Canceled), not recurring, and last changed more than 90 days ago (`config.ts`). |
| Saved view owned by a disabled user | `userquery` on a Contact Center table (list in `config.ts`) whose `_ownerid_value` is a `systemuser` with `isdisabled = true`. |
| Saved view identical to the default view | `userquery` whose `fetchxml` matches the table's default public `savedquery`, ignoring whitespace and case. Column layout isn't compared. |
| Deactivated saved view | `userquery` on a Contact Center table with `statecode = 1`. |

No "last used" signal for saved views is available through Dataverse reads, so the tool doesn't claim one.

## Tables and fields read

"Verified" means the schema was confirmed against a live environment by another tool in this toolbox (see IMPLEMENTATION_STATUS.md). "Discovered" relationships are read from relationship metadata at scan time.

| Table | Schema | Columns read (beyond id, name and `statecode`) | Relationships |
| --- | --- | --- | --- |
| `msdyn_liveworkstream` | Verified | `msdyn_enablevoicev2` (voice signal), `msdyn_direction`, `msdyn_defaultqueue` via `$expand` | uses fallback queue; everything else discovered |
| `queue` | Verified | `msdyn_isomnichannelqueue` (filter: Omnichannel queues only) | uses `msdyn_operatinghourid`, `msdyn_prequeueoverflowrulesetid`, `msdyn_inqueueoverflowrulesetid` |
| `msdyn_routingconfiguration` | Verified | `msdyn_isactiveconfiguration` | belongs to `msdyn_liveworkstreamid` |
| `msdyn_routingconfigurationstep` | Verified | `msdyn_type` (`192350002` = queue identification) | belongs to `msdyn_routingconfigurationid`; uses `msdyn_rulesetid` |
| `msdyn_decisionruleset` | Verified | `msdyn_rulesetdefinition` (parsed with Visual Routing Tester's `parseDecisionXml`), `msdyn_disabledrules` | mentions any in-scope record by id |
| `msdyn_overflowactionconfig` | Verified | `msdyn_overflowactiontype`, `msdyn_overflowactiondata` (transfer queue id) | mentions queue by id |
| `msdyn_operatinghour` | Verified | — | referenced by queues (verified) and discovered lookups |
| `msdyn_ocliveworkstreamcontextvariable` | Verified | `msdyn_name`, `msdyn_isdisplayable` | belongs to `msdyn_liveworkstreamid` |
| `msdyn_ocruleitem` (legacy rules, evidence only) | Verified | `msdyn_condition`, `msdyn_expression`, `msdyn_rulejson` | belongs to `msdyn_liveworkstream`; uses `msdyn_queueassignid`, `msdyn_cdsqueueassignid` |
| `queuemembership` (evidence only) | Verified | `queueid`, `systemuserid` | member counts |
| `characteristic` | Verified | — | used by `bookableresourcecharacteristic` (`_characteristic_value`) and by id in rulesets |
| `msdyn_capacityprofile` | Verified | — | used by `msdyn_bookableresourcecapacityprofile` (`_msdyn_capacityprofileid_value`); discovered |
| `msdyn_decisioncontract`, `msdyn_templateruleset`, `msdyn_notificationtemplate` | **Unverified** | — | discovered |
| `msdyn_soundnotificationsetting` | **Disabled** | — | Not scanned, for the same reason as localization data: sound settings are applied at runtime from notification and presence configuration, not reached through a lookup column, so every row came out as a false High-confidence orphan. |
| `msdyn_oclocalizationdata` | **Disabled** | — | Not scanned. Localization rows are looked up at runtime by language/locale settings, never through a lookup column, so the reference check reported every row as a High-confidence orphan in the first live scan. A useful check would be "no workstream or channel uses this locale", which needs schema that isn't known yet. |
| `msdyn_assignmentconfiguration` | **Unverified** | — | discovered; `keptAliveBy: queue` |
| `msdyn_assignmentconfigurationstep` | **Unverified** | — | discovered; `keptAliveBy: msdyn_assignmentconfiguration`; broken refs reported |
| `msdyn_liveworkstreamcapacityprofile` | **Unverified** | — | discovered; `keptAliveBy: msdyn_liveworkstream`; broken refs reported |
| `msdyn_ocvoice` | **Unverified** | — | discovered; `keptAliveBy: msdyn_liveworkstream` |
| `msdyn_ocvoicechannelsetting` | **Unverified** | — | discovered; `keptAliveBy: msdyn_ocvoice, msdyn_liveworkstream` |
| `msdyn_ocvoicechannellanguagesetting` | **Unverified** | — | discovered; `keptAliveBy: msdyn_ocvoicechannelsetting` |
| `msdyn_omnichannelconfiguration` | **Unverified** | `modifiedon` | duplicate rule only |
| `cts_servicenumber`, `cts_contactcenter`, `cts_openinghour` | **Custom, unverified** | — | discovered (`cts_servicenumber`: `keptAliveBy: msdyn_ocvoice, msdyn_liveworkstream`) |
| `msdyn_ocphonenumber` | **Unverified, disabled by default** | — | discovered when enabled |
| `userquery` | Standard | `returnedtypecode` (filtered to `config.ts` tables), `fetchxml`, `_ownerid_value` | — |
| `savedquery` (evidence only) | Standard | `returnedtypecode`, `fetchxml`, `isdefault`, `querytype` (filter: default public views) | — |
| `systemuser` (evidence only) | Standard | `isdisabled` (filter: disabled users only) | — |
| `bulkdeleteoperation` | Standard | `statuscode`, `isrecurring`, `createdon`, `modifiedon`, `successcount`, `failurecount` | — |
| `bookableresourcecharacteristic`, `msdyn_bookableresourcecapacityprofile` (evidence only) | Verified | — | see above |

Server-side filters are only an optimization. Every rule re-applies the same condition, so a rejected filter (retried without it) or the demo source (which ignores filters) still gives correct results.

## Open assumptions

These are recorded here and in the Coverage tab. Please confirm or correct them against your environment.

1. **Unverified tables may not exist, or may not be named this way.** Each one degrades to "Not found" / "No permission" on its own and never stops the scan. To stop seeing one, set `enabled: false` in `src/referenceMap.ts`.
2. **`keptAliveBy` direction-agnosticism.** For `cts_servicenumber`, `msdyn_ocvoice`, the voice channel settings, `msdyn_assignmentconfiguration` and `msdyn_liveworkstreamcapacityprofile`, the brief says what a record is attached to, but not which side holds the lookup. The tool treats a link in either direction as "attached". If a child table also has an undeclared lookup to some other table, that lookup counts as "uses", which can only hide a finding, never invent one.
3. **Voice is identified by `msdyn_enablevoicev2 = true`** (confirmed live by Visual Routing Tester). Chat/SMS workstreams don't get an endpoint check; see "Candidate additions" below.
4. **`bookableresourcecharacteristic._characteristic_value`** is read by the standard `_<lookup>_value` convention. Agent Readiness Checker confirmed the lookup itself live, using `$expand` instead. If that column isn't available, the relationship shows as "not checked" and characteristic findings drop to Medium.
5. **Queue reachability counts every queue id mentioned by an active workstream's routing step rulesets** (not only parsed `assign_to.queue` targets). This over-counts routes on purpose: an unusual rule format can only hide an unreachable queue, never falsely flag one. The "Routing step targets a deactivated or missing queue" check only uses parsed targets.
6. **Queues are limited to `msdyn_isomnichannelqueue = true`.** A routing target that isn't an Omnichannel queue is reported as "not found among the Omnichannel queues you can read", not as deleted.
7. **Deleted users.** Dataverse doesn't delete users, only disables them, so "owned by a deleted user" collapses into "owned by a disabled user".
8. **Not implemented from the brief** (the schema isn't known): `msdyn_templateruleset` "zero active child rules", `msdyn_ocvoicechannellanguagesetting` "language not used by any workstream locale", and queue "recent conversation volume".
9. **Relationship metadata** is read with plain GET requests to `/api/data/v9.2/EntityDefinitions(...)`, authenticated by the signed-in session (the same technique Visual Routing Tester uses for `LocalTimeFromUtcTime`). If that fails, each table is still read using the reference map's key names, discovery is marked unavailable, and structural findings drop to Medium.

## Candidate additions — decisions

| Candidate | Decision | Why |
| --- | --- | --- |
| Chat/SMS channel tables | Out | No verified schema; the toolbox is voice-scoped. Non-voice workstreams still get the inactive, no-routing and targets-gone checks. |
| `calendar` | Out | Also holds user work-hour and closure calendars, so it would mostly produce noise. |
| `team` owning a memberless queue | Out | Agent-readiness territory, not an unused record. |
| Survey / post-conversation tables | Out | Environment-specific, unverified. |
| Quick replies / macros / articles | Out | Agent usage isn't visible to Dataverse reads. |
| Environment variables | Out | Their consumers (flows, apps, plug-ins) are exactly what this tool can't see. |
| `msdyn_ocruleitem` | In, evidence only | So workstreams on legacy routing rules aren't reported as "no routing". |
| `msdyn_ocphonenumber` | In, disabled by default | Plausible out-of-box number table; enable it if your environment uses it. |

## Required permissions

Every read runs as the signed-in user. You need organization-level **Read** on the tables above. Any table you can't read shows as **No permission** on the Coverage tab, and only the checks that depend on it degrade. Two things to know:

- **Personal views (`userquery`)** are only visible to their owner unless you have org-level read on saved views, typically System Administrator. Without it, the saved-view checks only see your own views.
- **Business-unit-scoped read access** returns fewer rows, not an error. A record referenced only from outside your scope can look unreferenced. Run the scan with an account that has organization-wide read access.

## Build, test and run locally

```powershell
npm install
npm test
npm run demo:artifactfinder
```

Then open `http://localhost:5435/index.html` for the sample environment.

## Deploy

```powershell
pwsh ./scripts/deploy.ps1 -Tool artifactfinder -CreateIfMissing
```

Use `-CreateIfMissing` the first time; it creates the three `pct_/tools/artifactfinder/*` web resources and adds them to the solution. **The deploy script doesn't create the Site Map subarea.** Add it by hand, as described in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#site-map-subarea), until the packaged solution includes it.
