# Onboarding tools — Implementation Status

This status covers the three onboarding tools built together — [Team Builder](../team-builder/README.md), [User Setup](README.md) and [Queue Membership](../queue-membership/README.md) — and their shared kit in `tools/shared/`. Part of the [Promethean CCaaS Toolbox](../../Readme.md).

## Step 0 — schema (2026-10-02)

Read live from `academyexperiment` with read-only GETs (metadata, existing rows, plug-in steps, and the service `$metadata` for actions):

- **`team`**: `name`, `businessunitid`, `administratorid` (System Required lookups), `teamtype` (0 Owner, 1 Access, 2 Security Group, 3 Office Group), `membershiptype` (System Required: 0 Members and guests, 1 Members, 2 Owners, 3 Guests), `azureactivedirectoryobjectid`, `description`. The environment's Entra ID group team "Sales-Supervisor" (Members, roles Basic User + D365CC-Omnichannel-Supervisor in "Sales") was the reference. **No access team in the environment has a role** — access teams can't hold security roles.
- **Roles are business-unit scoped**: every business unit has its own `role` row per role name (e.g. "Omnichannel agent" in the root, Sales, Technical Support…). A role is always resolved to the copy in the team's or user's business unit (the same lesson as Agent Readiness Checker's role picker).
- **Relationships**: `teamroles_association`, `systemuserroles_association`, `teammembership_association`, `queuemembership_association`; intersect tables `teamroles`, `systemuserroles`, `teammembership`, `queuemembership` are read in bulk.
- **Team membership** is written with the documented **`AddMembersTeam`** action (bound to `team`, parameter `Members: Collection(systemuser)`), confirmed in `$metadata`.
- **`systemuser`**: users are synced from Microsoft Entra ID. A Dataverse page has no Graph access, so it can't look users up in Entra ID; the product owner chose to set up synced users only (2026-10-02).
- **Agents in the environment** = a `bookableresource` (`resourcetype` 3 User, `UserId` lookup — **PascalCase navigation property**, `timezone` required, `msdyn_displayonscheduleboard` Application Required, true) plus `msdyn_bookableresourcecapacityprofile` links named after the profile's unique name (`msdyn_voice_inbound_profile`, `msdyn_voice_default_outbound_profile`), `msdyn_maxunits` empty. Users' own time zones are in `usersettings.timezonecode`; resource time zone 92 = UTC.
- **Plug-ins**: bookable resource create runs scheduling and Omnichannel reference-data sync plug-ins; nothing that blocks a plain create.

## Decisions

| Decision | Why |
| --- | --- |
| Three separate tools, CSV for all three | Product owner decisions (2026-10-02). |
| Team types: Owner and Entra ID security group | Product owner decision: access teams can't hold roles, and only owner teams take members from Dataverse. |
| User Setup works on synced users only | Users come from Entra ID; a row for a user who isn't synced yet says what to do. |
| Capacity profiles linked by User Setup; default Default voice inbound + outbound | Product owner decision; matches the environment's existing agents. Routing needs a capacity profile. |
| Every action checks what's in place first ("noChange") | So any file can be run again safely — e.g. after missing users have synced. |
| Failures only skip dependants (e.g. capacity links if the resource failed) | Roles, teams and queues are independent of each other. |
| Never remove, update or delete | Removing access is a deliberate admin task; these tools only add. |
| Shared kit (`tools/shared/`): columns, plan/run engine, UI, read helpers | One flow for the three tools; writes stay in each tool's own `dataverse.ts`, guarded by `tools/shared/tests/writeScopes.test.ts`; the kit itself never writes (`shared.test.ts`). |

## Complete

- Team Builder, User Setup, Queue Membership: CSV columns with defaults, validation, resolution against the environment, "in place" detection, payloads, run with dependency skipping, run log; example CSVs (in each tool's `examples/`, kept identical by tests); manuals with screenshots.
- Tests: 73 for the three tools and the shared kit (plans, payloads, data layers with mocked `Xrm.WebApi` and `fetch`, write scopes, examples, run-twice). Each tool driven end to end in headless Chrome against its demo build, including a second run showing everything in place.

## Not yet verified live

Deployed to `academyexperiment` and in the packaged solution from 1.0.0.6. Nothing has been written to a live environment by these tools yet. Suggested first runs, in order:

1. **Team Builder**: one Owner team with Basic User, and — if you have a test group — one Entra ID security group team. Check them in the Power Platform admin center (Teams), including roles.
2. **User Setup**: one synced test user, through the new owner team; check the team membership, the bookable resource (Resources) and its capacity profiles; then sign in as the user.
3. **Queue Membership**: the same user into one queue; check the queue's members in the Copilot Service admin center, and route a test conversation.

Open questions for that run: whether the platform accepts an Entra ID group team for a group that has never been synced (it should; members sync on sign-in), and whether a bookable resource created this way shows as an agent in the Copilot Service admin center's user list without further fields.

## Site Map subareas

Included in the packaged solution from **1.0.0.6** onward (`power_platform_solution/PrometheanCCaaSToolbox_1_0_0_6.zip`): **Security → Team Builder**, **Security → User Setup** and **Provisioning → Queue Membership**. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add them by hand (Type Web Resource): `pct_/tools/teambuilder/index.html`, `pct_/tools/usersetup/index.html`, `pct_/tools/queuemembership/index.html`. See the [toolbox README](../../Readme.md#site-map-subareas).
