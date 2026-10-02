# Skill Assignment — Implementation Status

Built on the shared provisioning kit in `tools/shared/`. It's the first tool that uses the kit's second way in (`config.selection`): a selection page next to the CSV upload that produces the same plan.

## Schema (verified read-only against academyexperiment)

| What | Table / column | Notes |
| --- | --- | --- |
| Skill | `characteristic` | `characteristictype` 1 = Skill, 2 = Certification. Only skills are assignable here. |
| Rating | `ratingvalue` (`name`, `value`, `_ratingmodel_value`) | Only values of **active** rating models (`ratingmodel.statecode` 0) are offered. The environment has "Skills Rating Model" 1–5: Poor, Fair, Good, Very Good, Excellent. |
| Assignment | `bookableresourcecharacteristic` | Required lookups `resource` (nav `Resource`) and `characteristic` (nav `Characteristic`); optional `ratingvalue` (nav `RatingValue`). Navigation properties are PascalCase. Only active assignments (`statecode` 0) are read. |
| User → resource | `bookableresource` with `resourcetype` 3 and `_userid_value` | Same as User Setup and Queue Membership. |

There are plug-ins on Create/Update of `bookableresourcecharacteristic` (Omnichannel skill sync and scheduling prevalidation); they run on the tool's writes the same as on a manual change in the UI.

## Decisions

- **Existing skill with another rating → change the rating** (update only `RatingValue`). Never remove a skill or clear a rating.
- **No rating asked → keep the existing rating**; a new skill is assigned without one.
- **Skills only**, not certifications.
- One plan builder for both ways in (`planForUser`), so the CSV and the selection behave the same.
- CSV: one row per user; a second row for the same user is an error (keeps the plan unambiguous).

## Tests

- `tests/skillAssignment.test.ts` — CSV and selection plans, all checks, run and re-run (nothing to do), rating parsing, payloads, catalog read and the Dataverse writer.
- `tools/shared/tests/writeScopes.test.ts` — the only `createRecord` is on `bookableresourcecharacteristic`; the only `updateRecord` is on the same table and sets only `RatingValue@odata.bind`; no deletes or other writes; writes only in `dataverse.ts`.

## Testing

Tested against the live reference environment (`academyexperiment`). Still needed: testing in **other environments** — other Contact Center versions, languages, business-unit and security-role setups, and larger data volumes.

- Worth checking in a new environment: assign a skill with a rating, then change the rating, and check the assignment on the bookable resource (and the Omnichannel skill sync).

## Packaging

Deployed to `academyexperiment`. Included in the packaged solution from **1.0.0.7** onward (`power_platform_solution/PrometheanCCaaSToolbox_1_0_0_7.zip`): **Provisioning → Skill Assignment**. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/skillassignment/index.html` (stored as `$webresource:pct_/tools/skillassignment/index.html`). See the [toolbox README](../../Readme.md#site-map-subareas).
