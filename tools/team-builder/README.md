# Team Builder

Part of the [Promethean CCaaS Toolbox](../../Readme.md). **Step 1 of onboarding agents** ([Team Builder](README.md) → [User Setup](../user-setup/README.md) → [Queue Membership](../queue-membership/README.md)). It creates Dataverse teams in bulk from a CSV file, with their security roles.

See the [manual](manual.md) for a walkthrough with screenshots, and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for how the schema was verified.

![Review](images/02-review.png)

## Team types

| Type | Members | Security roles | Use it for |
| --- | --- | --- | --- |
| **Owner** | Added in Dataverse — e.g. with [User Setup](../user-setup/README.md) | Yes: members get the team's roles | Giving a group of agents their roles in one place |
| **Entra ID security group** | Come from the Microsoft Entra ID group (synced) | Yes: group members get the team's roles | Managing access from Entra ID |

Access teams aren't offered: they can't hold security roles (a platform rule), so they don't give users access.

## The CSV

One row per team.

| Column | Empty means | Notes |
| --- | --- | --- |
| `team_name` | **Required** | |
| `team_type` | Owner | Owner, or Entra ID security group |
| `business_unit` | The **root** business unit | Must exist and be enabled. |
| `administrator` | **You** (the person running the tool) | Sign-in name or email of an enabled, interactive user. |
| `description` | Not set | |
| `entra_group_object_id` | Error for a group team | **Required for Entra ID security group teams**: the group's Object ID (a GUID). Ignored (warning) for Owner teams. |
| `membership_type` | Members and guests | Group teams only: Members and guests, Members, Owners, Guests. |
| `security_roles` | No roles (warning) | Role names separated by `\|`. Each is taken from the **team's business unit** — every business unit has its own copy of every role. |

## Safe to run again

If a team with the same name already exists in the business unit — with the same type, and for a group team the same group — the tool doesn't create another one: it's shown as **in place**, and only the roles it's missing are assigned. Running the same file twice changes nothing the second time.

### Checks

| Check | Severity |
| --- | --- |
| Missing `team_name` column, empty file, a column listed twice; empty `team_name`; the same team (name + business unit) twice | Error |
| Business unit not found, ambiguous or disabled | Error |
| Administrator not found, ambiguous, disabled or not an interactive user | Error |
| Group team without `entra_group_object_id`, or a value that isn't a GUID | Error |
| The group already has a team in that business unit (one per group per business unit) | Error |
| A team with that name exists in the business unit with a different type or group | Error |
| Role not found, or not available in the team's business unit | Error |
| No security roles; group fields on an Owner team (ignored); same team name in another business unit | Warning |

## What gets written

| Action | How |
| --- | --- |
| Create team | `createRecord` on `team`: `name`, `teamtype` (0 Owner, 2 Entra ID security group), `membershiptype`, `businessunitid`, `administratorid`, and for group teams `azureactivedirectoryobjectid`. |
| Assign role | Associate `teamroles_association` (POST to the team's `$ref`). |

It never changes members, removes roles, or updates or deletes teams; the write-scope test in `tools/shared/tests/writeScopes.test.ts` fails the build otherwise.

## Build, run, deploy

```powershell
npm run demo:teambuilder   # http://localhost:5441/index.html — sample environment, nothing is written
pwsh ./scripts/deploy.ps1 -Tool teambuilder -CreateIfMissing   # first time
pwsh ./scripts/deploy.ps1 -Tool teambuilder                    # afterwards
```

Web resources: `pct_/tools/teambuilder/{index.html,style.css,bundle.js}`. In the packaged solution from **1.0.0.6** (Site Map: **Security → Team Builder**). For an environment on an older solution version, add a Site Map subarea: Type Web Resource, `pct_/tools/teambuilder/index.html`.
