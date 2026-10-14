# Voicemail Builder

Part of the [Promethean CCaaS Toolbox](../../Readme.md). A **creation tool**: it sets up voicemail for many voice queues at once, each with its own voicemail location. Per voice queue in the CSV it sets overflow to voicemail, and creates a voicemail queue, a voicemail workstream and the intake rule that routes the queue's voicemails there.

> **Tested live in one environment so far**: a voicemail queue, workstream, intake rule and new overflow rules for one voice queue were created and work in the admin center. A voicemail arriving end to end hasn't been seen in the data yet; see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#live-findings-2026-10-14).

See the [manual](manual.md) for a walkthrough with screenshots.

![Review](images/01-review.png)

## What it sets up per voice queue

| Part | What happens |
| --- | --- |
| **Overflow** on the voice queue | For each condition in the row, a rule with the action Voicemail. A rule for that condition that already goes to voicemail gets the new threshold; a missing one is added. If the queue has no overflow rules yet, they're created and linked to the queue. |
| **Voicemail queue** | A Record queue (voicemails are records, so they can't go to a voice queue), with the agents in `members`. Reused if it exists. |
| **Voicemail workstream** | A record workstream on the platform's voicemail record routing, with the voicemail queue as its fallback queue. Reused if it exists. |
| **Intake rule** | In the voicemail record routing: "voicemail's missed conversation was in this queue → this workstream". This sends the queue's voicemails to its own workstream instead of the default group voicemail workstream. |

The order is: voicemail queue and members, workstream, intake rule, and the overflow last, so calls only go to voicemail once the destination exists.

## On the page

- **Existing overflow rules: Skip or Overwrite.** When a queue already has an overflow rule for the same condition with another action (for example callback): leave it, or change it to voicemail. The same choice applies to an existing intake rule that sends the queue's voicemails to another workstream.
- **Assignment method of new voicemail queues**: Least active, Highest capacity (default) or Advanced round robin.

## CSV

One row per voice queue, with at least one overflow condition.

| Column | Meaning |
| --- | --- |
| `queue_name` | **Required.** The voice queue. |
| `calls_waiting` | Voicemail when this many calls are waiting, or more. |
| `estimated_wait_minutes` | Voicemail when the estimated wait is this many minutes, or more. |
| `out_of_hours` | `Yes`: voicemail outside the queue's operating hours. |
| `wait_time_seconds` | Voicemail once a caller has waited this many seconds, or more. |
| `voicemail_workstream_name` | Empty: "`<queue_name>` Voicemail". |
| `voicemail_queue_name` | Empty: "`<queue_name>` Voicemail Queue". |
| `members` | Agents for the voicemail queue, by sign-in name, separated by `\|`. |

```csv
queue_name,calls_waiting,estimated_wait_minutes,out_of_hours,wait_time_seconds,voicemail_workstream_name,voicemail_queue_name,members
Sales – Voice,10,,Yes,120,,,anna@contoso.com|bram@contoso.com
Technical – Voice,,5,,180,,,chris@contoso.com
```

## Checks

| Problem | Result |
| --- | --- |
| No condition, or a value that isn't a whole number of 1 or more | Error |
| Queue not found, not a voice queue, or listed twice | Error |
| An existing voicemail queue that isn't a Record queue, or an existing workstream that isn't a voicemail workstream | Error |
| The same voicemail queue or workstream name on two rows | Error |
| A user in `members` not found, ambiguous or disabled | Error |
| An intake rule without a condition before ours (ours would never apply) | Error |
| No Voicemail overflow action in the environment | Error: set voicemail overflow on one queue in the admin center once |
| An existing rule with another action | Warning: skipped or overwritten, as chosen |
| Out of hours on a queue without operating hours | Warning: the rule never applies |
| A new voicemail queue without members | Warning |

## Failures

- One queue failing doesn't stop the others.
- A queue that stops part-way lists what was created, and its overflow isn't switched on. Upload the same file again to finish: what exists is reused.

## Permissions and safety

The person using it is expected to be a **system administrator**.

- **Creates**: `queue` (Record queues), `msdyn_liveworkstream` (voicemail workstreams), `msdyn_decisionruleset` (overflow rulesets); adds members through `queuemembership_association`.
- **Updates**: only `msdyn_rulesetdefinition` of overflow rulesets and of the voicemail intake ruleset, and a queue's links to its overflow rulesets.
- **Never deletes**, never changes the voice queue otherwise, and never writes a decision contract, the voicemail record routing or an overflow action.
- All writes are in `src/dataverse.ts`, which refuses any table or column outside `CREATE_COLUMNS` and `UPDATE_COLUMNS` in `src/schema.ts`. They go straight to the Web API as POST and PATCH requests. `tests/writeScope.test.ts` pins the column lists and fails if a delete, `execute` or an `Xrm.WebApi` write appears in `src/`, or if the Web API is called from another file.
- Calls that overflow go to voicemail as soon as the run has finished for their queue.

## Tables read

`queue` (active advanced queues), `queuemembership`, `msdyn_liveworkstream`, `systemuser` (interactive users), `msdyn_masterentityroutingconfiguration` (the voicemail record routing), `msdyn_decisionruleset` (overflow and intake rules), `msdyn_overflowactionconfig` (the Voicemail action), `msdyn_decisioncontract` (the overflow contracts).

## Build, run, deploy

```powershell
npm install
npm test
npm run demo:voicemailbuilder   # http://localhost:5447/index.html — sample environment, nothing is written
pwsh ./scripts/deploy.ps1 -Tool voicemailbuilder -CreateIfMissing   # first time
pwsh ./scripts/deploy.ps1 -Tool voicemailbuilder                    # afterwards
```

Web resources: `pct_/tools/voicemailbuilder/{index.html,style.css,bundle.js}`. In the packaged solution from **1.0.0.11** (Site Map: **Creation → Voicemail Builder**). For an environment on an older solution version, add a subarea for `pct_/tools/voicemailbuilder/index.html` by hand (see the [toolbox README](../../Readme.md#site-map-subareas)).
