# Voicemail Builder — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md) for the tool overview.

**Status: deployed to `academyexperiment` and tested live there on 2026-10-14**, and in the packaged solution from 1.0.0.11. See [Live findings](#live-findings-2026-10-14).

## Step 0 — schema discovery (2026-10-14)

Read live from `academyexperiment` with **read-only GETs**: metadata, plug-in steps, the overflow rules of every queue, the voicemail workstreams, and a voicemail workstream, voicemail queue and intake rule made in the admin center for this purpose ("Contoso Flags Sales Voicemail", "Contoso Flags Sales Voicemail Queue", intake rule "Missed Conversation" for queue "Contoso Flags Sales"). Nothing was written.

### Overflow on a queue

- A queue has two optional lookups to an overflow ruleset: **`msdyn_prequeueoverflowrulesetid`** (checked before a call joins the queue; navigation property **`msdyn_decisionrulesetid`**) and **`msdyn_inqueueoverflowrulesetid`** (while it waits; navigation property `msdyn_inqueueoverflowrulesetid`).
- The admin center names them **`queue_prequeue_<queue>`** and **`queue_inqueue_<queue>`**, with `msdyn_uniquename` `msdyn_<guid>`, Declarative, Decision list, flags No, and the managed contracts **Queue Overflow Management ruleset input/output contract** and **Inqueue Overflow Management ruleset input/output contract**.
- **Each rule is one condition plus an action** (`hit-policy="all"`). The action sets `overflow.<flag>` to true and `overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid` to an overflow action:

| Condition (admin center) | Flag | Condition XML |
| --- | --- | --- |
| Estimated wait time | `estimatedwaittimeoverflow` | `queue_prequeue.estimatedwaittimeinminutes` not-null and `>=` minutes |
| Calls waiting (queue size) | `queuesizeoverflow` | `queue_prequeue.currentqueuesize` not-null and `>=` count |
| Out of operating hours | `operatinghouroverflow` | `queue_prequeue.iswithinoperatinghour` not-null and `==` false |
| Wait time (in queue) | `lapsedwaittimeoverflow` | `queue_inqueue.lapsedwaittime` not-null and `>=` seconds (`unit="seconds"`), without a logical wrapper |

- **Overflow actions** are `msdyn_overflowactionconfig` records. There is **one shared "Voicemail" record** (type `192350004`), used by every voicemail rule in the environment. Callback, end conversation and each queue transfer have their own.
- `msdyn_rulesetdependencymapping` rows (rule → overflow action) are created by **SYSTEM**.
- A ruleset can stay behind after it was unlinked from its queue (`queue_inqueue_Contoso Sales Support`), so the tool goes by the queue's lookups, never by ruleset name.

### Voicemail routing

- Voicemails are **records** (`msdyn_ocvoicemail`), routed by record routing. The platform's **Voicemail routing hub** (`msdyn_masterentityroutingconfiguration` for `msdyn_ocvoicemail`) has one **intake ruleset** ("Voicemail decision ruleset", `hit-policy="first"`), which decides the workstream. It was empty (no rules) until the sample rule was made.
- **The intake rule the admin center wrote:**

```xml
<rule id="<guid>" name="Missed Conversation">
  <logical operator="AND">
    <logical operator="AND">
      <condition operator="==">
        <lhs type="attribute">msdyn_ocvoicemail.msdyn_missedconversationid_msdyn_ocvoicemail.msdyn_cdsqueueid_msdyn_ocliveworkitem.queueid</lhs>
        <rhs type="staticvalue">{<queue id>}</rhs>
      </condition>
    </logical>
  </logical>
  <action>
    <setattribute>
      <lhs type="attribute">action.unifiedrouting</lhs>
      <rhs type="staticvalue">{<workstream id>}</rhs>
    </setattribute>
  </action>
</rule>
```

  The voicemail's **missed conversation** (`msdyn_missedconversationid`) is the call that overflowed; its `msdyn_cdsqueueid` is the queue it was in. Dependency mappings (rule → queue, rule → workstream) appeared, created by the platform.
- **A voicemail workstream** (as the admin center made it) is a `msdyn_liveworkstream` with `msdyn_streamsource` 192350000 (Entity Records), **`msdyn_masterentityroutingconfigurationid` = the Voicemail routing hub** (navigation property `msdyn_masterentityroutingconfigurationId`), **`msdyn_defaultqueue` = the voicemail queue**, Simplified, Push, unit-based capacity 30, all presences, screen pop with timeout 120 s. It has no routing configuration of its own; voicemails go to the fallback queue. The platform's synchronous workstream plug-ins fill in the routing contract and templates on Create (as found for Voice Workstream Builder).
- **A voicemail queue** is a Record queue (`msdyn_queuetype` 192350001). The sample used Highest capacity, priority 1, Private.

## Decisions

| Decision | Why |
| --- | --- |
| A creation tool with **one CSV row per voice queue** | Product owner (2026-10-14): the CSV names the queues that need voicemail overflow. |
| Per queue: overflow to voicemail, a voicemail **Record queue**, a voicemail **record workstream** with that queue as fallback, and an **intake rule** in the voicemail hub | Product owner: each queue gets its own voicemail location. The intake rule is what routes the queue's voicemails to its workstream. |
| Overflow conditions as CSV columns (`calls_waiting`, `estimated_wait_minutes`, `out_of_hours`, `wait_time_seconds`); at least one per row | The four conditions the admin center offers, all with the same voicemail action. |
| **Update or add**: an existing rule for the same condition that already goes to voicemail gets the new threshold; a missing one is added | Product owner. |
| An existing rule for the same condition with another action: **Overwrite or Skip**, chosen on the page | Product owner. The same choice applies to an intake rule that sends the queue's voicemails to another workstream. |
| An existing voicemail queue or workstream with the given name is **reused**; only what's missing is created | Product owner. Uploading the same file again finishes a part-way run without duplicates. |
| Order per queue: voicemail queue and members → workstream → intake rule → overflow | Nothing points at a record that doesn't exist yet, and calls only start going to voicemail once the destination is ready. |
| Rules are read again just before they're changed | Changes made in the admin center between upload and create aren't lost. |
| Default names: "<queue> Voicemail" (workstream) and "<queue> Voicemail Queue" | As the sample. |
| Blocked: no voice queue, an existing voicemail queue that isn't a Record queue, an existing workstream that isn't a voicemail workstream, names shared between rows, an intake rule without a condition before ours (ours would never apply), no Voicemail overflow action in the environment | Each would fail or give a setup that never receives voicemails. |
| Warning: out of hours on a queue without operating hours; no members on a new voicemail queue | Allowed, but the rule never applies / nobody gets the voicemails. |
| Writes go straight to the Web API (POST and PATCH only), limited by `CREATE_COLUMNS` / `UPDATE_COLUMNS` | `Xrm.WebApi.createRecord` refused the routing tables in the browser (found with Assignment Method Copier). |
| The Voicemail overflow action is never created | It's shared by every queue; if an environment has none, setting voicemail overflow on one queue in the admin center creates it. |

## Live findings (2026-10-14)

Run from the deployed tool for the voice queue **Contoso Flags Service**, which had no overflow and no voicemail setup. Read back afterwards:

- **Voicemail queue** "Contoso Flags Service Voicemail Queue" created as a Record queue.
- **Voicemail workstream** "Contoso Flags Service Voicemail" created through the Web API, with the queue as its fallback queue. The platform completed it as for the admin center: its own routing contract and the record-routing notification templates.
- **Intake rule** "Voicemail – Contoso Flags Service" added after the admin center's sample rule in the voicemail intake ruleset. The platform created its dependency records (rule → queue, rule → workstream).
- **Overflow**: new `queue_prequeue_Contoso Flags Service` and `queue_inqueue_Contoso Flags Service` rulesets, linked to the queue through its two lookups (the pre-queue one by its navigation property `msdyn_decisionrulesetid`). The platform created the rule → Voicemail action records.
- The product owner confirmed the result works in the admin center.

### Still to test

1. **A voicemail end to end**: no voicemail records existed in the environment when this was read back, so a voicemail arriving in the queue's own voicemail queue hasn't been seen in the data yet.
2. **Overwrite and Skip** against real callback or transfer rules, and updating the threshold of an existing voicemail rule (covered by the sample environment).
3. **Other environments**: other Contact Center versions, many queues in one file.

## Complete

- CSV validation, resolution per queue (voice queue, voicemail queue and workstream reuse, members, intake rule, overflow per stage with update/add/overwrite/skip), execution in a safe order with fresh reads, read-back, and a run log CSV.
- UI: settings (Overwrite/Skip, assignment method) and upload, review per queue with the settings still editable, confirmation, results per queue.
- Demo mode: voice queues with and without overflow (callback and voicemail rules), without operating hours, an existing record queue, a messaging queue, and a queue whose overflow is rejected.
- Tests: 57 — `rules` (the admin center's overflow and intake XML exactly, reading, adding, updating), `plan`, `execute` (write order, update in place, Skip/Overwrite, reuse, several intake rules, part-way failure and finishing it by uploading again, read-back), `dataverse` (mocked reads and Web API writes, membership, scope refusals), `writeScope`. Also driven end to end in headless Chrome against the demo build: Skip switched to Overwrite on review, 4 queues with one part-way failure, and no horizontal scroll at 390px.

## Site Map subarea

Included in the packaged solution from **1.0.0.11** onward (current: `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_13.zip`): **Creation → Voicemail Builder**. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/voicemailbuilder/index.html`. See the [toolbox README](../../Readme.md#site-map-subareas).

## Not done

- No undo: changes are removed in the admin center.
- The voice queues themselves aren't created; they must exist.
