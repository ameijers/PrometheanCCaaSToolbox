# Capacity Profile Assignment — Implementation Status

Built on 2026-10-30 on the shared provisioning kit in `tools/shared/`, after the user asked for a tool to give many users a capacity profile at once by selecting users and profiles. It follows Skill Assignment: the same selection page and CSV upload, one plan builder for both. The selection page opens first (`selection.openFirst`, added to the kit for this tool).

## Schema (verified read-only against academyexperiment, 2026-10-30)

| What | Table / column | Notes |
| --- | --- | --- |
| Capacity profile | `msdyn_capacityprofile` (`msdyn_name`, `msdyn_uniquename`, `msdyn_defaultmaxunits`, `statecode`) | The environment has Default voice inbound (`msdyn_voice_inbound_profile`), Default voice outbound (`msdyn_voice_default_outbound_profile`) and Escalation profile (`msdyn_escalationprofile`), all 1 unit. There is no `msdyn_maxunits` on the profile. |
| Link | `msdyn_bookableresourcecapacityprofile` | Lookups `msdyn_bookableresourceid` and `msdyn_capacityprofileid` (navigation properties have the same names), `msdyn_name` = the profile's unique name, optional `msdyn_maxunits` (empty on every existing link). Only active links (`statecode` 0) are read. |
| User → resource | `bookableresource` with `resourcetype` 3 and `_userid_value` | Same as User Setup, Queue Membership and Skill Assignment. |

The create payload is the same as User Setup's `capacityLinkPayload`, which has been tested live.

## Decisions

- **Add only.** A profile the user already has is in place; nothing is removed, and the per-user max units isn't set (the profile's default applies).
- **Bookable resources only.** A user without one is greyed out on the selection page and an error in the CSV, pointing to User Setup. This tool doesn't create resources, because that needs the time zone and access setup that User Setup does.
- **Profiles by name or unique name**, case-insensitive; deactivated profiles are not offered.
- **Selection first.** The page opens on the selection, with a filter "Only users without a capacity profile".
- CSV: one row per user; a second row for the same user is an error.

## Tests

- `tests/capacityProfileAssignment.test.ts` covers:
  - CSV and selection plans, and all checks;
  - a run and a re-run (nothing to do the second time);
  - the payload, the catalog read and the Dataverse writer;
  - the example file.
- `tools/shared/tests/writeScopes.test.ts`: the only `createRecord` is on `msdyn_bookableresourcecapacityprofile` (`LINK_TABLE`). There are no updates, deletes or other writes, and writes happen only in `dataverse.ts`.

## Testing

Run end to end in a browser against the sample data, and checked by the user in `academyexperiment` after the deploy on 2026-10-30. To try it in a new environment:
1. Assign a profile to a user who doesn't have it yet.
2. Check the user in the admin center under **Users**, or on their bookable resource.
3. Run the same selection again: it should have nothing to do.

## Packaging

Deployed to `academyexperiment` on 2026-10-30. Included in the packaged solution from **1.0.0.18** onward (current: `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_18.zip`): **Provisioning → Capacity Profile Assignment**. Deploy key `capacityassignment`. For an environment on an older solution version, add it by hand: Type Web Resource, `pct_/tools/capacityassignment/index.html`.
