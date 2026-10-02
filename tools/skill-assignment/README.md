# Skill Assignment

Part of the [Promethean CCaaS Toolbox](../../Readme.md). It assigns **existing skills** to **existing users** and sets or changes their rating, for skill-based routing. Two ways in, same review and run:

- **From a CSV file** — one row per user with their skills and ratings.
- **Select users and skills** — tick users and skills in the page, pick a rating per skill; every selected user gets every selected skill.

Users must already be **bookable resources** (run [User Setup](../user-setup/README.md) first).

See the [manual](manual.md) for a walkthrough with screenshots, and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

![Selection](images/02-selection.png)

## The CSV

One row per user.

| Column | Empty means | Notes |
| --- | --- | --- |
| `user` | **Required** | Sign-in name or email. The user must be in the environment and **already a bookable resource**. |
| `skills` | **Required** | Skill names separated by `\|`, each with an optional rating after a colon: `English:Good\|Billing:4\|HITL`. The rating is a name (`Good`) or a number (`3`) of your rating model. If there's more than one active rating model and the name or number exists in several, write `Model / Good`. |

## What happens per skill

| The user… | Rating in the file / selection | Result |
| --- | --- | --- |
| doesn't have the skill | a rating | **Assign skill** with that rating |
| doesn't have the skill | none | **Assign skill** without a rating |
| has the skill | the same rating | In place — nothing written |
| has the skill | another rating | **Change rating** — only the rating is updated |
| has the skill | none | In place — the existing rating is kept |

Skills are never removed, and running the same file or selection twice changes nothing the second time.

### Checks

| Check | Severity |
| --- | --- |
| User not found, ambiguous, disabled or not interactive; the same user on two rows | Error |
| The user isn't a bookable resource yet (run User Setup), or their resource is deactivated | Error |
| Skill not found, ambiguous, deactivated, or a **certification** (this tool assigns skills only); the same skill twice on a row; no skills on a row | Error |
| Rating not found, or ambiguous across rating models | Error |

In the selection page, users who aren't bookable resources are greyed out, and only active skills are listed.

## What gets written

Two writes, both on `bookableresourcecharacteristic` (the skill on the user's bookable resource):

- **Assign skill** — `createRecord` with `Resource`, `Characteristic` and (optionally) `RatingValue` bound.
- **Change rating** — `updateRecord` that sets only `RatingValue`.

Nothing is deleted or deactivated, and no other table or column is written. The write-scope test in `tools/shared/tests/writeScopes.test.ts` fails the build if anything else appears.

## Build, run, deploy

```powershell
npm run demo:skillassignment   # http://localhost:5444/index.html — sample environment, nothing is written
pwsh ./scripts/deploy.ps1 -Tool skillassignment -CreateIfMissing   # first time
pwsh ./scripts/deploy.ps1 -Tool skillassignment                    # afterwards
```

Web resources: `pct_/tools/skillassignment/{index.html,style.css,bundle.js}`. In the packaged solution from **1.0.0.7** (Site Map: **Provisioning → Skill Assignment**). For an environment on an older solution version, add a Site Map subarea: Type Web Resource, `pct_/tools/skillassignment/index.html`.
