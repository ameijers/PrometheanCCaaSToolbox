# Voice Workstream Builder — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md) for the tool overview. The toolbox's first tool that writes to Dataverse. Built together with [Recording & Transcription Provisioner](../voice-recording-provisioner/README.md), which shares its recording/transcription module.

## Step 0 — schema discovery (2026-09-30)

Before any code was written, the schema was read live from `academyexperiment`. Only **read-only GETs** were used: `EntityDefinitions` metadata (attributes, required levels, option sets, relationships, navigation property names), the rows the admin center had created for the environment's existing voice workstreams and channels, and the plug-in steps registered on the voice tables. Nothing was written.

None of the voice-channel tables had been verified by an earlier tool, and a tool that writes can't guess column names. The findings:

### The voice data model

- **A voice channel is an `msdyn_ocvoicechannelsetting` row.** It looks up its workstream (`msdyn_liveworkstreamid`). The phone number lookup (`msdyn_phonenumberid`) is **optional**, so "create a channel now, assign a number later" is a supported state, not a workaround. Several channel rows can point at one workstream.
- **`msdyn_ocvoice` is a text-to-speech voice, not a channel.** Its columns are `msdyn_voicename`, `msdyn_voicestyle`, `msdyn_pitch`, `msdyn_speakingspeed` and a language lookup. The admin center creates **one per channel language**, and never shares them: three channels using `en-US-AvaMultilingualNeural` had three separate rows.
- **`msdyn_ocvoicechannellanguagesetting`** ties a channel to its language (`msdyn_oclanguage`, keyed by `msdyn_localecode`), its voice, and its hold/wait music (`msdyn_ocphonemusic`), with `msdyn_isprimary`.
- **Capacity profile link:** `msdyn_liveworkstreamcapacityprofile`, lookups `msdyn_workstream_id` and `msdyn_capacityprofile_id`. The admin center names it `<profile name>-<profile id>`. The environment's defaults are `msdyn_voice_inbound_profile` and `msdyn_voice_default_outbound_profile`.
- **Routing configuration:** every admin-center voice workstream had one, including one still carrying the generated name `RC - Workstream: <name> (<id>)`. That, plus the `PostOperationWorkStreamCreateUpdateDeletePlugin` step on workstream create, is why the tool expects the platform to add it, and checks afterwards.
- **Phone number provisioning is separate.** `msdyn_ocvoicechannelsetting` has a bound custom action `msdyn_TelephonyVoiceChannelProvisionAction`, and there is an `msdyn_ocprovisioningstate` table with lookups to both the channel and the number. See open question 1.

### Values the admin center writes (copied, not guessed)

| Column | Value |
| --- | --- |
| `msdyn_liveworkstream.msdyn_streamsource` | `192440000` (Voice call) |
| `msdyn_enablevoicev2` | `true` |
| `msdyn_mode` | `717210001` (Simplified); `717210000` is Legacy |
| `msdyn_direction` | `0` Inbound, `1` Outbound (2–4 are direct/proactive; not offered) |
| `msdyn_workdistributionmode` | `192350000` Push, `192350001` Pick |
| `msdyn_capacityformat` | `192360000` Profile, `192350000` Unit (matches ARC Round 4) |
| `msdyn_capacityrequired` | required; `30` on every admin-center voice workstream, including profile-based ones |
| `msdyn_allowedpresences` (multi-select) | `192360000` Available, `…001` Busy, `…002` Busy - DND, `…003` Away, `…004` Offline |
| `msdyn_notification` | `100000001` Screen pop with timeout (default), `…002` with decline, `100000000` Directly open |
| `msdyn_autocloseafterinactivity` | required; `5` on every voice workstream. Not exposed; always written as 5. |
| `msdyn_recordingmode` / `msdyn_transcriptionmode` (multi-select) | `192351000` None, `192351001` Manual, `192351002` Automatic, always paired with `msdyn_recordingenabled` / `msdyn_transcriptionenabled` |

The notification and session templates (`msdyn_notificationtemplate_*`, `msdyn_sessiontemplate_default`) aren't written: a registered plug-in (`UpdateDefaultNotificationTemplate`) fills them on create.

### Navigation properties (case-sensitive, from `ManyToOneRelationships`)

Most match the lookup column name. Two don't, and would have failed silently if guessed:

- `msdyn_ocvoice.msdyn_languageid` binds through **`msdyn_language`**.
- `msdyn_liveworkstreamcapacityprofile.msdyn_capacityprofile_id` binds through **`msdyn_capacityProfile_id`**.

All of them are in `src/voiceSchema.ts`, the only place the tool names Dataverse columns for writing.

### Finding for Environment Artifact Finder

The Artifact Finder treats `msdyn_ocvoice` as the voice channel (`referenceMap.ts` labels it "Voice channel", and the `voicechannel.noNumber` check runs on it). Per the findings above, that check is aimed at the wrong table: the number lives on `msdyn_ocvoicechannelsetting._msdyn_phonenumberid_value`. Also, channels this tool creates without a number are intentional, so a correct version of that check should frame them as "waiting for a number" rather than dead. **Not changed here** (it's a separate tool with uncommitted work in progress); listed for follow-up.

## Decisions

| Decision | Why |
| --- | --- |
| One row per channel, workstream columns repeated or blank | One file, easy to build in Excel. Two linked files (workstreams and channels) are harder to keep consistent. |
| Everything is checked before anything is written; any error blocks the whole run | A half-applied CSV is harder to clean up than a rejected one. The review step is the dry run. |
| Stop a workstream at its first failure, carry on with the others, never delete | Later records depend on earlier ones. Deleting automatically would make this tool able to remove configuration, which it's designed never to do. |
| Only new workstreams; an existing name is an error | Re-running a CSV must not create duplicates or silently change existing configuration. |
| Transcript and recording is one choice: None, Transcript, or Transcript and Recording | Product owner decision (2026-09-30). It maps to the four columns (`msdyn_transcriptionenabled`/`…mode`, `msdyn_recordingenabled`/`…mode`), which are always written together. Recording without a transcript can't be expressed, so there's nothing to reject. |
| Automatic/Manual start kept as a separate column (`transcript_recording_start`, default Automatic) | The mode columns exist and one admin-center channel in the environment uses Manual. It's written to the mode of every capability that's on; with None both modes are None. |
| Required channel booleans not exposed are written `false` | `msdyn_stoptranscriptionandrecordingafterpstntransfer`, `…afterteamstransfer`, `msdyn_usebridgetransferforpstntransfer`, `…forteamstransfer`: false on every channel read. |
| Transfer controls default to Yes | Most existing channels had them on. They're exposed as columns. |
| Language setting gets a name (`<channel> – <locale>`) | The admin center leaves `msdyn_name` empty, but the column is marked Application Required. Setting it is harmless and makes the rows findable. |
| Hold/wait music blank = not set | Every admin-center channel had "Transform", but a default the admin didn't choose would be a guess. The template's examples fill it in. |

## Open questions (proceeding with the stated assumption)

1. **Does assigning a phone number at create time provision it?** The provisioning action and `msdyn_ocprovisioningstate` suggest the admin center does more than set the lookup when a number is attached. *Assumption:* setting `msdyn_phonenumberid` on create is what the admin center's save does, and the registered `PostOperationVoiceChannelSettingEventPlugin` handles provisioning. **This is the first thing to verify live.** If calls don't arrive, the safe route is to create channels without numbers (fully supported) and attach numbers in the admin center.
2. **Direct/proactive directions** (2–4). *Assumption:* out of scope for bulk creation.

## Live findings

**Round 1 (2026-10-01): first live run.** The operator created three workstreams ("Contoso Flags Retail", "… Sales", "… Service") with six voice channels, all without a phone number. Read back afterwards:

- **Channels without a number work.** All six channel settings exist, active, with `msdyn_phonenumberid` empty.
- **The platform completed each workstream** exactly like an admin-center one: `msdyn_routingcontractid`, the notification and session templates, the record identification rule, automated messages, and a capacity profile link to "Default voice inbound".
- **No routing configuration was created.** This was an open question, and the assumption ("the platform adds it") was wrong. None of the three workstreams has an `msdyn_routingconfiguration`. The admin center creates one only when routing rules are set up, and the outbound profile in the same environment has none either. The tool already reported it per workstream; the note now says to set up routing rules, and the demo mirrors it. **Follow-up idea:** let the builder create the routing configuration with a "route to queue" rule from a CSV column. That needs the routing-configuration and ruleset schema verified first.

**Shared with Profile Builder (2026-10-01).** [Profile Builder](../profile-builder/README.md) creates outbound profiles through this tool's resolution, payloads, create engine and data layer. For it, channels gained optional outbound settings: caller ID number (`msdyn_calleridphonenumberid`, resolved like the phone number), caller ID name and anonymous caller ID. They're written only when set, so this tool's own channels are unchanged. The "set up routing rules" note is now only given for inbound workstreams, because outbound ones (profiles) don't use routing rules.

## Complete

- CSV reader (delimiter detection, quotes, BOM), template with examples, column reference from one definition list.
- Validation (grouping, defaults, consistency across rows, per-line/per-column issues) and resolution against the environment (duplicates, ambiguous names, inactive or direction-mismatched numbers).
- Payload builders for all five records, dependency-ordered execution with per-workstream isolation, and a routing-configuration check afterwards.
- Example CSV (Upload step, and `examples/` in the repo, kept identical by a test) and a run log CSV with tool, environment, user, times, every record id, notes and accepted warnings (`runLog.ts` is shared with the provisioner).
- UI: Upload → Review → Create, a write banner, the target environment always visible, and a confirmation that names the environment and record counts.
- Demo mode over an in-memory sample environment (it remembers what it created, so a second run shows the duplicate check).
- Tests: 69 (`csv`, `validate`, `resolve`, `payload`, `execute`, `dataverse` with mocked `Xrm.WebApi`, `writeScope`, `example` incl. the run log). Also driven end to end in headless Chrome against the demo build: example download, a broken copy showing errors, the example saved semicolon-separated, create, results, and the downloaded log file.

## Not yet verified

- **Creating a channel with a phone number** hasn't been tried live yet (open question 1).
- A test call through a builder-created workstream, once its routing rules are set up.

## Site Map subarea

Included in the packaged solution from **1.0.0.4** onward: importing the current `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_7.zip` brings the **Voice Workstream Builder** subarea in the app's **Creation** group. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/voicebuilder/index.html` (stored as `$webresource:pct_/tools/voicebuilder/index.html`). See the [toolbox README](../../Readme.md#site-map-subareas).
