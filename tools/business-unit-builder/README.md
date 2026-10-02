# Business Unit Builder

Part of the [Promethean CCaaS Toolbox](../../Readme.md). A **creation tool**: it creates business units in bulk from a CSV file — including whole hierarchies in one file — instead of creating them one by one in the Power Platform admin center. Business units decide which agents, supervisors and teams can see which queues and records, so they're often set up together with the contact center.

See the [manual](manual.md) for a walkthrough with screenshots, and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for how the schema was verified.

![Review step](images/02-review.png)

## How it works

1. **Upload.** Click **Download example CSV**, adapt it in Excel, and upload it. The same example is in the repo as [`examples/business-units-example.csv`](examples/business-units-example.csv); a test keeps the two identical.
2. **Review.** Every row is checked, every parent is resolved, and the tool shows the **hierarchy after creation** as a tree: existing business units, with the new ones nested under them. It also shows the order they'll be created in. **Nothing is written in this step.** Errors block creation; warnings don't.
3. **Create.** After a confirmation that names the environment, the business units are created **parents first**. Each is reported with its parent, status, id and (live) a link. A business unit whose parent couldn't be created is skipped; other branches continue.
4. **Log.** **Download log** saves the run as a CSV, in the same layout as the other creation tools.

## The CSV

One row per business unit. Only `name` is required.

| Column | Empty means | Notes |
| --- | --- | --- |
| `name` | **Required** | Up to 160 characters. Must be unique in the file and new in the environment. |
| `parent_business_unit` | Directly under the **root** business unit | The name of an existing business unit, **or of another row in the same file**. Rows can be in any order. |
| `description` | Not set | Up to 2000 characters. |
| `division` | Not set | `divisionname`, up to 100. |
| `cost_center` | Not set | `costcenter`, up to 100. |
| `email` | Not set | `emailaddress`, up to 100; must look like an email address. |
| `website` | Not set | `websiteurl`, up to 200; must look like a web address. |
| `address_name`, `street`, `city`, `postal_code`, `country`, `phone` | Not set | The business unit's main address (`address1_…`). |

Every length limit is the column's own limit in Dataverse, checked before anything is created.

### Checks

| Check | Severity |
| --- | --- |
| Missing `name` column, empty file, a column listed twice | Error |
| Empty `name`; the same name twice in the file | Error |
| A business unit with that name already exists | Error |
| Parent not found (neither existing nor in the file), ambiguous (two existing units with that name), or **disabled** | Error |
| A business unit as its own parent; a **loop** of parents in the file; a row whose parents lead into a loop or an unresolved parent | Error |
| A value longer than the column allows; an invalid email or web address | Error |
| Unknown column (ignored) | Warning |

## What gets written

| Record | How | Notes |
| --- | --- | --- |
| Business unit | `createRecord` on `businessunit` | The filled-in columns, and `parentbusinessunitid` bound to the existing or just-created parent. |

The platform does the rest, as for any new business unit: it creates the business unit's **default team** and gives it its own copy of every **security role**. After each create the tool checks that the default team exists and notes it if not.

**Hard to undo.** A business unit can only be deleted after it's disabled, and only when no users, teams or records belong to it. The tool never changes, disables or deletes business units — removing one is a manual job in the Power Platform admin center.

**Not in this tool:** moving users or teams into the new business units. Moving a user to another business unit removes their security roles, so that belongs in a separate, deliberate step.

## Permissions and safety

Meant for **system administrators** (create privilege on business units). The only write is `createRecord` on `businessunit`, from `src/dataverse.ts`; `tests/writeScope.test.ts` fails the build if `updateRecord`, `deleteRecord`, `execute`, `fetch` or a state change appears anywhere in `src/`.

## Tables read

`businessunit` (name, parent, disabled), `team` (each new business unit's default team, after creating).

## Build, run, deploy

```powershell
npm test
npm run demo:businessunitbuilder   # http://localhost:5440/index.html — sample environment, nothing is written
pwsh ./scripts/deploy.ps1 -Tool businessunitbuilder -CreateIfMissing   # first time
pwsh ./scripts/deploy.ps1 -Tool businessunitbuilder                    # afterwards
```

Web resources: `pct_/tools/businessunitbuilder/{index.html,style.css,bundle.js}`. In the packaged solution from **1.0.0.5** (Site Map: **Security → Business Units Builder** from 1.0.0.6; under Creation in 1.0.0.5). For an environment on an older solution version, add a Site Map subarea: Type Web Resource, `pct_/tools/businessunitbuilder/index.html`.
