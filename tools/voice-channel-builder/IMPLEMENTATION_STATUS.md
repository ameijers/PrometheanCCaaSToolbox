# Voice Channel Builder — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md). Built 2026-11-04. Like [Profile Builder](../profile-builder/README.md), it's a thin layer over [Voice Workstream Builder](../voice-workstream-builder/README.md): its own CSV and checks, and the builder's verified channel schema, payloads, create engine, data layer and run log.

## Step 0 — what's verified

Nothing new is written: a channel is the same three records Voice Workstream Builder creates (`msdyn_ocvoicechannelsetting`, `msdyn_ocvoice`, `msdyn_ocvoicechannellanguagesetting`), with the same payloads, verified live in its Step 0 (2026-09-30) and Round 1 (2026-10-01). From those:

- **Several channel rows can point at one workstream**, so adding a channel to an existing workstream is a supported state.
- **A channel without a phone number is supported**: Round 1 created six, and the platform completed them.

New reads, for the workstream checks: `msdyn_liveworkstream.msdyn_direction`, `msdyn_streamsource` and `statecode`, added to the builder's catalog read. `msdyn_direction` and `msdyn_streamsource` were already read live by Visual Routing Tester, Phone Number Changer and the 3D Explorer.

## Changes to Voice Workstream Builder (shared code)

- `model.ts`: the catalog's workstreams carry `direction`, `voice` and `active`; a `ResolvedWorkstream` can carry `existingId`.
- `execute.ts`: a workstream with `existingId` gets only its channel steps (no workstream, no capacity link), and isn't checked for routing rules.
- `resolve.ts`: the channel checks moved into `resolveChannels`, which `resolvePlan` calls as before.
- `validate.ts`: `readChannel` and `Row` are exported.
- `demoData.ts`: the sample workstreams have a direction; an outbound profile, a chat workstream and a deactivated voice workstream were added for this tool's checks.

The builder's and Profile Builder's tests pass unchanged.

## Decisions

| Decision | Why |
| --- | --- |
| A CSV, one row per channel, with the builder's channel columns | "Similar to Voice Workstream Builder": the same file shape, so channel rows can be copied between the two. |
| Only existing workstreams; a missing one is an error | New workstreams belong in Voice Workstream Builder, with their settings. A typo must not silently become a new workstream. |
| Only active **inbound voice** workstreams | Outbound profiles are one workstream with one channel (Profile Builder); direct and proactive directions are out of scope, as in the builder. A chat workstream can't have voice channels. |
| `addChannels` refuses a plan with any workstream that doesn't exist | A second safeguard, besides errors blocking the Create button: the shared engine can't be reached in a way that creates a workstream. |
| No routing-rules note | The workstream already has its routing; a new channel follows it. |

## Open questions

1. **A channel created with a phone number on an existing workstream.** Same as the builder's open question 1: setting `msdyn_phonenumberid` on create is assumed to be what the admin center does. Phone Number Changer has since set numbers on existing channels live. Worth one live test: add a channel with a number, then call it.

## Complete

- CSV columns (the builder's channel columns, plus `workstream_name`), validation, resolution against the environment, the existing-workstream checks.
- UI: Upload → Review → Create, write banner, confirmation, results with links, run log.
- Tests: 17 (`plan`: checks, example file, what's created, refusing unknown workstreams, a failure mid-run; `writeScope`). Driven end to end in headless Edge against the demo build (the screenshots in `images/`).

## Testing

Run against the sample environment only. Still needed: a live run in `academyexperiment` (with and without a number).

## Site Map subarea

Included in the packaged solution from **1.0.0.21** onward: importing `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_21.zip` brings the **Voice Channel Builder** subarea in the app's **Creation** group, after Voice Workstream Builder. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/channelbuilder/index.html` (stored as `$webresource:pct_/tools/channelbuilder/index.html`). See the [toolbox README](../../Readme.md#site-map-subareas).
