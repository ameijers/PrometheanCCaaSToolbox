# Business Unit Builder — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md). The toolbox's fourth creation tool. It reuses Voice Workstream Builder's CSV reader and run log; everything else is its own.

## Step 0 — schema (2026-10-02)

Read live from `academyexperiment` with read-only GETs:

- **`businessunit`** (entity set `businessunits`, primary name `name`): `name` is System Required (max 160); `parentbusinessunitid` is Application Required, a lookup to `businessunit` that binds through the same-named navigation property. The root business unit is the one without a parent (`orgb2fd3560` there, with Technical Support, Sales and Retail under it).
- Creatable optional columns used: `description` (2000), `divisionname` (100), `costcenter` (100), `emailaddress` (100, Email format), `websiteurl` (200, Url format), `address1_name` (100), `address1_line1` (250), `address1_city` (80), `address1_postalcode` (20), `address1_country` (80), `address1_telephone1` (50). Limits are the metadata's `MaxLength`.
- **No custom logic on create**: only the platform's own `ObjectModel Implementation` steps run on Create and SetState. No alternate keys.
- **Default teams**: every existing business unit has exactly one default team (`team.isdefault`, same name). The platform creates it, with the business unit's copy of each security role.
- **Disabled state**: `isdisabled`. Not written; a disabled business unit can't be a parent here.

Creating a business unit through the Web API is the documented, supported operation; nothing private is used.

## Decisions

| Decision | Why |
| --- | --- |
| Parents by name: existing **or another row in the file**, any row order | A hierarchy in one file; the tool sorts parents before children (by depth, then file order). |
| Empty parent = the root business unit | That's where new business units go in the admin center by default. |
| Loops, unresolved parents, and everything below them are errors and aren't planned | They can never be created; better caught at review than as failures. |
| A disabled parent is an error | A disabled business unit shouldn't get new children by accident. |
| An existing name is an error | Re-running a file must not create duplicates (Dataverse has no key that would stop it). |
| Only filled-in columns are written | No hidden defaults; the manual says so. |
| A failed parent skips its branch, other branches continue | Children can't be created without their parent. |
| Never update, disable or delete | Business units are hard to remove; this tool must never be able to remove one. Enforced by `writeScope.test.ts`. |
| Moving users/teams not included | Moving a user strips their security roles; that needs its own careful tool. |

## Complete

- Columns with metadata length limits; validation (names, duplicates, emails, web addresses), parent resolution (existing, in-file, root), loop detection, creation order.
- Payload (filled-in columns + parent bind), execution parents-first with branch skipping, default-team check, run log.
- UI: Upload → Review hierarchy (tree of existing and new units, creation order) → Create, write banner, confirmation; demo mode with a disabled unit.
- Tests: 30 (`plan` incl. execution, example file and log; `dataverse` with mocked `Xrm.WebApi`; `writeScope`). Driven end to end in headless Chrome against the demo build.

## Testing

Tested against the live reference environment (`academyexperiment`). Still needed: testing in **other environments** — other Contact Center versions, languages, business-unit and security-role setups, and larger data volumes.

- Deployed to `academyexperiment` and in the packaged solution from 1.0.0.5.
- Worth checking in a new environment: one business unit under the root and one under it, then both in the Power Platform admin center (Settings → Users + permissions → Business units), including the default team and security roles.

## Site Map subarea

Included in the packaged solution from **1.0.0.5** onward: importing the current `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_7.zip` brings the **Business Units Builder** subarea in the app's **Security** group (it was under Creation in 1.0.0.5). The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/businessunitbuilder/index.html` (stored as `$webresource:pct_/tools/businessunitbuilder/index.html`). See the [toolbox README](../../Readme.md#site-map-subareas).
