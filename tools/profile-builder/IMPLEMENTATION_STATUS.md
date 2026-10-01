# Profile Builder — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md). The toolbox's third creation tool. It is a thin layer over [Voice Workstream Builder](../voice-workstream-builder/README.md): its own CSV, checks and UI, and the builder's verified schema, create engine, data layer and run log.

## Step 0 — what a profile is (2026-10-01)

Read live from `academyexperiment` with read-only GETs. The environment's one outbound profile, "Contoso Default Outbound Profile", turned out to be:

- an `msdyn_liveworkstream`: voice (`msdyn_streamsource` 192440000, `msdyn_enablevoicev2`), Simplified, **`msdyn_direction` = 1 (Outbound)**, `msdyn_outboundqueueid` = the outbound queue, `msdyn_isdefault` = true, capacity format Profile with a link to "Default voice outbound", presences Available + Busy, **no routing configuration**;
- one `msdyn_ocvoicechannelsetting` with the phone number (`msdyn_phonenumberid`), the **caller ID number** (`msdyn_calleridphonenumberid`, the same number), `msdyn_isanonymouscallerid` false, `msdyn_calleridname` and `msdyn_outboundcallregionallowlist` empty, and the behaviors (transcript + recording, manual);
- one primary `msdyn_ocvoicechannellanguagesetting` (en-US, hold and wait music "Transform", no TTS voice).

So an outbound profile is exactly the record set Voice Workstream Builder creates, plus the caller ID columns on the channel. Those columns (`msdyn_calleridphonenumberid` → `msdyn_ocphonenumber`, `msdyn_calleridname`, `msdyn_isanonymouscallerid`) were added to the builder's shared model and payload, used only when a channel has outbound settings.

## Decisions

| Decision | Why |
| --- | --- |
| **Outbound only** | Product owner decision (2026-10-01). The environment has no inbound profile, so how one is stored (presumably `msdyn_direction` 2 "Direct Inbound") couldn't be verified. A CSV row with `profile_type` Inbound is an error that says so. |
| **Phone number required** | Product owner decision (2026-10-01): a profile without a number can't place calls. The number must also be enabled for outbound calling; that's an error here (a warning in the builder). |
| Caller ID defaults to the profile's number | As on the admin center's profile. |
| Never set `msdyn_isdefault` | There's one default outbound profile; a bulk tool must not move it. |
| Region allow-list not exposed | Empty on every channel in the environment, so its format is unknown. |
| No "routing rules" note for profiles | The admin center's outbound profile has no routing configuration; the builder now only gives that note for inbound workstreams. |
| No duplicate-number warning | Sharing a number between inbound channels and an outbound profile is normal (the environment does it). |
| Reuse rather than copy | One create engine and one data layer for everything a voice workstream is made of; the builder's write-scope test covers it. |

## Open questions

1. **Inbound profiles** — add once an admin-center inbound profile exists to read (create one, then the schema can be confirmed and the tool extended).
2. **Does the admin center list a profile created this way?** *Assumption:* yes, since the record set matches its own profile. First live run: create one profile, open **Outbound and inbound profiles** in the admin center, and place a test outbound call with it.

## Complete

- CSV columns with defaults (from the admin center's outbound profile), validation (required number and queue, E.164, caller ID, anonymity, Inbound rejected), resolution through the builder plus stricter outbound-number checks.
- Shared builder extensions: caller ID number/name/anonymity on channels (model, resolve, payload); routing-rules note only for inbound.
- UI: Upload → Review → Create, write banner, confirmation; run log.
- Tests: 17 (`plan` incl. payloads, create order and the example file; `writeScope`), plus the builder's suite. Driven end to end in headless Chrome against the demo build.

## Not yet verified

- Nothing created live yet (open question 2). Deployed to `academyexperiment` and in the packaged solution from 1.0.0.4 (Site Map: **Creation → Outbound Profile Builder**).
