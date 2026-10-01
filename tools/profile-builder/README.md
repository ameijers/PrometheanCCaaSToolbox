# Profile Builder

Part of the [Promethean CCaaS Toolbox](../../Readme.md). A **creation tool**: it creates **outbound profiles** in bulk from a CSV file — profile name, phone number, outbound information (queue, caller ID) and behaviors — instead of creating each one in the Copilot Service admin center. Inbound profiles aren't supported yet (see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)).

See the [manual](manual.md) for a walkthrough with screenshots.

![Review step](images/02-review.png)

## How it works

1. **Upload.** Click **Download example CSV**, adapt it in Excel, and upload it. The same example is in the repo as [`examples/outbound-profiles-example.csv`](examples/outbound-profiles-example.csv); a test keeps the two identical.
2. **Review.** Every row is checked, then every name is matched against the environment. **Nothing is written in this step.** Errors block creation; warnings don't.
3. **Create.** After a confirmation that names the environment, each profile is created and reported with its records, ids and (live) links.
4. **Log.** **Download log** saves the run as a CSV, in the same layout as the other creation tools.

## The CSV

One row per outbound profile. A **phone number is required**: an outbound profile can't place calls without one.

| Column | Empty means | Notes |
| --- | --- | --- |
| `profile_name` | **Required** | Must be unique in the file and new in the environment. |
| `profile_type` | Outbound | Only Outbound is supported; Inbound is reported as an error. |
| `phone_number` | **Required** | E.164. Must exist, be active and be **enabled for outbound calling**. |
| `outbound_queue` | **Required** | The queue outbound calls are placed in, by name. |
| `caller_id_number` | The profile's `phone_number` | The number the customer sees. Must be one of your own numbers. |
| `caller_id_name` | No name sent | |
| `anonymous_caller_id` | No | Yes hides the caller ID (name and number). |
| `capacity_profile` | Default voice outbound | Name or unique name. |
| `allowed_presences` | Available\|Busy | |
| `language` | en-US | Locale code. |
| `hold_music`, `wait_music` | Not set | e.g. Transform. |
| `transcript_recording` | None | None, Transcript, Transcript and Recording |
| `transcript_recording_start` | Automatic | Automatic or Manual |
| `agent_transcription_controls`, `agent_recording_controls` | Yes | Agents can pause/resume. |
| `request_recording_consent`, `stop_recording_on_hold`, `play_recording_notifications`, `show_transcript_by_default` | No | |
| `pstn_transfer_controls`, `teams_transfer_controls` | Yes | |

Defaults follow the outbound profile the admin center created in the reference environment. Not set by this tool: the **default profile** flag (a bulk tool shouldn't change which profile is the default) and the **outbound call region allow-list** (its format couldn't be verified: it's empty everywhere).

### Checks

| Check | Severity |
| --- | --- |
| Missing `profile_name` column, empty file, a column listed twice | Error |
| Empty `profile_name`, `phone_number` or `outbound_queue`; duplicate name in the file | Error |
| Profile (or any workstream) name already exists | Error |
| `profile_type` Inbound or another value; invalid choice or presence | Error |
| Phone number not E.164, not found, deactivated, or **not enabled for outbound calling** | Error |
| Caller ID number not found or deactivated | Error |
| Outbound queue, capacity profile, language or music not found, or ambiguous | Error |
| Unknown column (ignored) | Warning |
| Caller ID name or number given with anonymous caller ID (not shown) | Warning |
| Manual start with transcript/recording None (not used) | Warning |

A number that's also used by an inbound channel isn't flagged: sharing a number between inbound calls and an outbound profile is normal.

## What gets written

An outbound profile is stored as an outbound voice workstream with one voice channel — exactly how the admin center stored "Contoso Default Outbound Profile". So this tool reuses Voice Workstream Builder's verified schema, create engine and data layer:

| Record | Table | Notes |
| --- | --- | --- |
| Profile | `msdyn_liveworkstream` | Voice, Simplified, `msdyn_direction` 1 (Outbound), `msdyn_outboundqueueid`; never `msdyn_isdefault`. |
| Capacity profile link | `msdyn_liveworkstreamcapacityprofile` | |
| Voice channel | `msdyn_ocvoicechannelsetting` | Phone number, caller ID number (`msdyn_calleridphonenumberid`), caller ID name, anonymous caller ID, and the behaviors. |
| Channel language | `msdyn_ocvoicechannellanguagesetting` | Primary language and music. |

Profiles don't get routing rules (the admin center's outbound profile has none), so unlike for inbound workstreams there's no "set up routing rules" note.

## Permissions and safety

Meant for **system administrators**. The tool has no Dataverse code of its own: every write goes through Voice Workstream Builder's `dataverse.ts`, which only creates, and only the four record types above (plus TTS voices, unused here). `tests/writeScope.test.ts` fails if any Dataverse call appears in this tool's `src/`.

## Build, run, deploy

```powershell
npm test
npm run demo:profilebuilder   # http://localhost:5439/index.html — sample environment, nothing is written
pwsh ./scripts/deploy.ps1 -Tool profilebuilder -CreateIfMissing   # first time
pwsh ./scripts/deploy.ps1 -Tool profilebuilder                    # afterwards
```

Web resources: `pct_/tools/profilebuilder/{index.html,style.css,bundle.js}`. Site Map subarea: Type Web Resource, `pct_/tools/profilebuilder/index.html`.
