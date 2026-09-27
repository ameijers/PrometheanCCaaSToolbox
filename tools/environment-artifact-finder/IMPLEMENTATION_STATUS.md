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

## Plan (commit sequence)

1. Discovery and plan (this document).
2. Model, reference map, generic reference-graph engine + tests.
3. Entity-specific rules and housekeeping checks + tests.
4. Data layer (`Xrm.WebApi` + metadata discovery, demo implementation behind the same interface) + tests.
5. Demo dataset + coverage test.
6. React UI, webpack entry, local demo script.
7. Docs, deploy config, root README.
