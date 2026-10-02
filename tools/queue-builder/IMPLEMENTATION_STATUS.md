# Queue Builder — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md) for the tool overview. The toolbox's second creation tool, after [Voice Workstream Builder](../voice-workstream-builder/README.md), whose CSV reader and run log it reuses.

## Step 0 — schema discovery (2026-09-30)

Read live from `academyexperiment` with **read-only GETs**: `queue` metadata (creatable columns, required levels, option sets, relationships), every advanced queue the admin center had created, the plug-in steps on `queue`, and the platform's queue-related custom APIs. Nothing was written.

### What an advanced queue is

- A `queue` row with **`msdyn_isomnichannelqueue = true`** (Application Required).
- **`msdyn_queuetype`** (Application Required): `192350000` Messaging, `192350001` Entity (shown as Record), `192350002` Voice.
- **`msdyn_priority`** (Application Required): lower is higher priority. All admin-center queues: `1`. The platform's system default queues use `2147483647`.
- **`msdyn_assignmentstrategy`**: `192350003` Longest Idle, `192350000` Omnichannel Assignment, `192350001` Round Robin, `192350002` Custom Assignment Configuration, `192350005` No Assignment. Every admin-center voice queue: Longest Idle.
- **`queueviewtype`**: `1` Private, `0` Public. Every admin-center queue: Private.
- **`msdyn_operatinghourid`**: optional lookup to `msdyn_operatinghour` (set on "Contoso Sales").
- **Members**: the N:N `queuemembership_association` (queue ↔ systemuser, intersect `queuemembership`). This is the same data Agent Readiness Checker reads for queue membership.
- **Assignment input contract**: every advanced queue has `msdyn_assignmentinputcontractid` (an `msdyn_decisioncontract` named `new_<guid>`), created in the same second as the queue. The `CRUDDecisionContracts` and `PostOperationQueueCreatePlugin` steps on queue Create create it server-side.
- **Overflow**: `msdyn_prequeueoverflowrulesetid` / `msdyn_inqueueoverflowrulesetid` point to rulesets named `queue_prequeue_<queue>` / `queue_inqueue_<queue>`, created when overflow is configured. Out of scope here.

### The admin center's names

The platform's own `msdyn_CreateQueue` custom API describes its assignment parameter as "Least Active, Advanced Round Robin, Highest Capacity", defaulting to Least Active. Together with the option set, that gives the mapping: **Least active = Longest Idle, Highest capacity = Omnichannel Assignment, Advanced round robin = Round Robin**.

### Why `createRecord`, not `msdyn_CreateQueue`

`msdyn_CreateQueue` (and `msdyn_AddUserToQueue`, `msdyn_AssociateOperatingHoursToQueue`) are marked **private** custom APIs: meant for Microsoft's own UI, undocumented, and free to change without notice. The tool uses the documented data operations instead: `createRecord` on `queue`, and an Associate on `queuemembership_association`. The registered plug-ins handle both. `PreOperationOCQueueCreatePlugin` and the contract plug-ins run on queue Create, and `OmnichannelReferenceDataSyncPlugins.PostOperationAssociateEventAsyncPlugin` runs on every Associate. The tool reads each new queue back to confirm the contract exists.

## Decisions

| Decision | Why |
| --- | --- |
| One row per queue; members as a `\|`-separated list | Queues have no child records other than memberships, so one row per queue is the simplest file. |
| Members by sign-in name (`domainname`), falling back to email | Unique and what admins know. Full names aren't unique. Only interactive users (`accessmode` 0) are matched; disabled users are an error. |
| Assignment methods: Least active, Highest capacity, Advanced round robin | The three built-in methods. Custom assignment needs assignment rulesets, a different job. |
| Defaults: Voice, Least active, priority 1, Private | What the admin center created in the reference environment (and the `msdyn_CreateQueue` default method). |
| Any existing queue name is an error | Re-running a CSV must not create duplicates. Names are checked against all queues, not just advanced ones, to avoid confusing look-alikes. |
| A member failure doesn't stop the run | Memberships are independent of each other. The queue is reported Partly created. |
| Overflow and custom assignment out of scope | Overflow is the planned bulk provisioning tool; keeping creation simple. |

## Open questions (proceeding with the stated assumption)

1. **Is a plain create enough for the platform to finish setting up the queue?** *Assumption:* yes, via the registered plug-ins (see Step 0). The tool checks the assignment contract after each queue. **First thing to verify live:** create one queue, open it in the admin center, and route a test conversation to it.
2. **Membership through the standard relationship.** *Assumption:* the admin center's private `msdyn_AddUserToQueue` does the same Associate, plus possibly extra bookkeeping. Verify live that added members show in the admin center and receive work.
3. **Record queues.** *Assumption:* the same columns apply. The reference environment's only record queues are the platform's own defaults.

## Complete

- CSV columns with defaults, validation (choices, priority, duplicates, member lists), resolution (existing queues, operating hours, users by sign-in name or email, disabled users).
- Payload, execution (queue then members; per-member isolation), a contract check afterwards, and a run log (shared layout).
- UI: Upload → Review → Create, a write banner, the target environment always shown, and a confirmation with counts.
- Demo mode with sample users (one disabled) and operating hours; it remembers created queues.
- Tests: 37 (`plan`, `execute` incl. the example file and run log, `dataverse` with mocked `Xrm.WebApi` and `fetch`, `writeScope`). Driven end to end in headless Chrome against the demo build.

## Not yet verified

- **Nothing has been written to a live environment yet.** See open questions 1 and 2 for the first live run.
- Deployed to `academyexperiment`; in the packaged solution from 1.0.0.4.

## Site Map subarea

Included in the packaged solution from **1.0.0.4** onward: importing the current `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_5.zip` brings the **Queue Builder** subarea in the app's **Creation** group. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/queuebuilder/index.html` (stored as `$webresource:pct_/tools/queuebuilder/index.html`). See the [toolbox README](../../Readme.md#site-map-subareas).
