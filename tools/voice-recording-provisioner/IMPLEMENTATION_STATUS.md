# Recording & Transcription Provisioner — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md) for the tool overview. Built together with [Voice Workstream Builder](../voice-workstream-builder/README.md), whose [Step 0](../voice-workstream-builder/IMPLEMENTATION_STATUS.md#step-0--schema-discovery-2026-09-30) covers the schema discovery both tools rely on.

## Schema (verified live, read-only, 2026-09-30)

- Recording and transcription are columns on the voice channel, `msdyn_ocvoicechannelsetting`, not on the workstream. (The workstream only has `msdyn_restrictdownloadrecording` / `msdyn_restrictdownloadtranscript`, which Voice Workstream Builder sets at creation.)
- Each capability is a boolean plus a multi-select mode: `msdyn_transcriptionenabled` + `msdyn_transcriptionmode`, `msdyn_recordingenabled` + `msdyn_recordingmode`. Mode values: `192351000` None, `192351001` Manual, `192351002` Automatic (from the option set metadata). All four channels in the environment had the flag and mode in step (enabled + Automatic, or enabled + Manual), so the tool always writes both together.
- The other six options are plain booleans; see the README table.
- Reading: a disabled flag reads as Off whatever mode is stored. An enabled flag with no mode reads as Automatic. A mode can come back as a comma-separated string (it's a multi-select).
- `msdyn_ocvoicechannelsetting` has a registered `PostOperationVoiceChannelSettingEventPlugin` on Update and cache-invalidation plug-ins. That's why every update is read back.

## Decisions

| Decision | Why |
| --- | --- |
| Three options — None, Transcript, Transcript and Recording — plus a separate Start (Automatic/Manual); everything "Leave unchanged" by default | Product owner decision (2026-09-30). One choice per capability combination, applied to many channels, without touching anything else. |
| Option and start always written as the four capture columns together | They share the columns; writing both avoids a channel ending up half switched. With None, both modes are written as None and the start reads back as Automatic, so it never shows as a difference. |
| "Recording without transcript" is read and shown as-is, never offered | It isn't one of the options, but an environment can contain it. Any option replaces it; Revert restores it exactly. |
| Per channel, write only the columns that change | Two channels with different starting points get different, minimal updates. Nothing else on the record is touched. |
| Skip channels that already match | No needless writes and no plug-in churn. The count is shown separately. |
| One channel at a time; a failure doesn't stop the batch | Each failure is reported with the platform's message and a link. |
| Read every channel back afterwards | A plug-in could refuse or rewrite a value; "saved" isn't the same as "in effect". A mismatch is reported as "Updated, not confirmed". |
| Revert = re-apply the previous values of the changed fields | Before-values are known exactly, so undo is cheap and precise. Only offered right after the change, while those values are in hand. |
| Deactivated channels hidden by default | They take no calls. They can be shown and changed. |

## Open questions (proceeding with the stated assumption)

1. **Do agent-control options matter when their capability is off?** *Assumption:* they're stored regardless and simply unused, so they can be set independently.
2. **Effect on calls in progress.** *Assumption:* none; the setting applies to calls that start afterwards. The UI says so.

## Complete

- Change planning (three options, start mode, six other options, before/after, changed fields).
- Apply with per-channel minimal updates, progress, per-channel errors, read-back verification, revert, and a run log CSV per apply and per revert (tool, environment, user, times, before/after per channel).
- UI: filters (search, workstream, direction, current setting, deactivated), select-all-shown with selection kept across filters, a per-row preview, an irregular-state marker, and confirmations for apply and revert.
- Demo mode: 15 channels in every state (including recording without transcript and a manual start), one deactivated, one that rejects updates.
- Tests: 33 — `change`, `apply` (minimal updates, the four capture columns together, failure isolation, read-back mismatch, unchanged never written, exact revert, run log), `dataverse` (mocked `Xrm.WebApi`, column allowlist), `writeScope`. Also driven end to end in headless Chrome against the demo build: select all, preview, Transcript with manual start, apply with one failure, download log, revert back to the exact original states, download the revert log, and no horizontal scroll at 390px.

## Not yet verified

- **No update has been run against a live environment yet.** Suggested first live run: one test channel, switch it from its current setting to another and back, and check both in the admin center and on a test call.
- Deploy not run; config follows the other tools.

## Site Map subarea

Included in the packaged solution from **1.0.0.4** onward: importing the current `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_5.zip` brings the **Recording & Transcription** subarea in the app's **Provisioning** group. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/recordingprovisioner/index.html` (stored as `$webresource:pct_/tools/recordingprovisioner/index.html`). See the [toolbox README](../../Readme.md#site-map-subareas).
