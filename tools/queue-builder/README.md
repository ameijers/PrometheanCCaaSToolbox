# Queue Builder

Part of the [Promethean CCaaS Toolbox](../../Readme.md). A **creation tool**: it creates advanced (unified routing) queues in bulk from a CSV file, with their members, instead of clicking each one through the Copilot Service admin center.

See the [manual](manual.md) for a walkthrough with screenshots, and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for how the schema was verified and what is still open.

![Review step](images/02-review-errors.png)

## How it works

1. **Upload.** Click **Download example CSV**, adapt it in Excel (comma-, semicolon- and tab-separated files are all read), and upload it. The same example is in the repo as [`examples/advanced-queues-example.csv`](examples/advanced-queues-example.csv); a test keeps the two identical.
2. **Review.** Every row is checked, then every name is matched against the environment (operating hours, users) and every new queue name against the existing queues. **Nothing is written in this step.** Errors block creation; warnings don't.
3. **Create.** After a confirmation that names the environment, each queue is created and then its members are added. Each record is reported with its status and, live, a link.
4. **Log.** **Download log** saves the run as a CSV, in the same layout as Voice Workstream Builder's log.

## The CSV

One row per queue.

| Column | Empty means | Values |
| --- | --- | --- |
| `queue_name` | **Required** | Must not exist in the environment yet, and must be unique in the file. |
| `queue_type` | Voice | Voice, Messaging (chat, SMS, social), Record (cases, emails and other records). Can't be changed after creation. |
| `assignment_method` | Least active | Least active, Highest capacity, Advanced round robin |
| `priority` | 1 | Whole number ≥ 1; **lower is higher priority** |
| `visibility` | Private | Private (members only), Public |
| `operating_hours` | No operating hours (always open) | Name of an operating hours record |
| `description` | No description | Free text |
| `members` | No members (warning) | Sign-in names (or email addresses), separated by `\|` |

The defaults match the advanced queues the admin center created in the reference environment: Voice, Least active, priority 1, Private. The [manual](manual.md#what-happens-when-you-leave-a-cell-empty) describes the empty-cell behavior in full.

**Not in the CSV (on purpose):** custom assignment rules, and overflow. Overflow is planned as a separate provisioning tool that sets it on many queues at once.

### Checks

| Check | Severity |
| --- | --- |
| Missing `queue_name` column, empty file, a column listed twice | Error |
| Empty `queue_name`; the same name twice in the file | Error |
| Queue name already exists in the environment (any queue) | Error |
| Invalid queue type, assignment method or visibility; priority not a whole number ≥ 1 | Error |
| Operating hours not found, or ambiguous | Error |
| Member not found (by sign-in name or email), ambiguous, or disabled | Error |
| Unknown column (ignored); member listed twice (added once) | Warning |
| Queue without members; a private queue without members | Warning |

## What gets written

| Record | How | Notes |
| --- | --- | --- |
| Advanced queue | `createRecord` on `queue` | `msdyn_isomnichannelqueue` true, `msdyn_queuetype`, `msdyn_assignmentstrategy`, `msdyn_priority`, `queueviewtype`, optional `description` and operating hours. |
| Member | Associate on `queuemembership_association` (POST to the queue's `$ref`) | One per member, the standard Dataverse queue membership. |

The platform's queue plug-ins give every new advanced queue its assignment input decision contract, as they do for the admin center. The tool reads each new queue back and says so if that didn't happen.

A queue that fails to create is reported with the platform's error, and its members are skipped. A member that fails doesn't stop the other members or queues; the queue is then **Partly created**. The tool never updates or deletes anything.

## Permissions and safety

Meant for **system administrators** (create on `queue`, append/append-to for queue membership, read on users and operating hours).

- It only creates queues and adds members, only from `src/dataverse.ts`. `tests/writeScope.test.ts` fails the build if `updateRecord`, `deleteRecord`, `execute`, `PATCH` or `DELETE` appears in `src/`, if `createRecord` targets anything but `queue`, or if `fetch` is used for anything but the membership `$ref` POST. The ids in that URL are checked to be GUIDs.
- Writes happen only after the review step and a confirmation naming the environment.

## Tables read

`queue` (names, and the new queue's contract lookup after creating), `msdyn_operatinghour` (active), `systemuser` (interactive users: sign-in name, email, disabled).

## Build, run, deploy

```powershell
npm test
npm run demo:queuebuilder   # http://localhost:5438/index.html — sample environment, nothing is written
pwsh ./scripts/deploy.ps1 -Tool queuebuilder -CreateIfMissing   # first time
pwsh ./scripts/deploy.ps1 -Tool queuebuilder                    # afterwards
```

Web resources: `pct_/tools/queuebuilder/{index.html,style.css,bundle.js}`. In the packaged solution from 1.0.0.4 (Site Map group **Creation**). Site Map subarea: Type Web Resource, `pct_/tools/queuebuilder/index.html` (stored as `$webresource:pct_/tools/queuebuilder/index.html`).
