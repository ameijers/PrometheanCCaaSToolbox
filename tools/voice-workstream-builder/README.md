# Voice Workstream Builder

Part of the [Promethean CCaaS Toolbox](../../Readme.md). The first of the toolbox's **creation tools**: it creates voice workstreams and their voice channels in bulk from a CSV file, instead of clicking each one through the Copilot Service admin center.

A workstream can have several voice channels, so the CSV has **one row per voice channel**. A channel can be created **without a phone number**, to have the number assigned later.

See the [manual](manual.md) for a walkthrough with screenshots, and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for how the schema was verified and what is still open.

![Review step](images/02-review-errors.png)

## How it works

1. **Upload.** Click **Download example CSV**, adapt it in Excel (comma-, semicolon- and tab-separated files are all read), and upload it. The file is read in the browser. The same example is in the repo as [`examples/voice-workstreams-example.csv`](examples/voice-workstreams-example.csv); a test keeps the two identical.
2. **Review.** The tool checks every row, then reads the environment and matches every name in the file (queues, capacity profiles, phone numbers, languages, music, operating hours) to a real record. It shows what it will create, with every problem tied to a line and column. **Nothing is written in this step.** Errors block creation; warnings don't.
3. **Create.** After an explicit confirmation that names the target environment, it creates the records one workstream at a time and reports every record with its status, id and a link.
4. **Log.** **Download log** saves the run as a CSV (see [Run log](#run-log)).

## What gets created

For each workstream:

| Record | Table | Notes |
| --- | --- | --- |
| Workstream | `msdyn_liveworkstream` | Voice (`msdyn_streamsource` 192440000, `msdyn_enablevoicev2`), Simplified mode, as the admin center creates it. |
| Capacity profile link | `msdyn_liveworkstreamcapacityprofile` | Only for Profile capacity. Links the workstream to the chosen profile, or the admin center's default voice profile for its direction. |

For each voice channel on it:

| Record | Table | Notes |
| --- | --- | --- |
| Voice channel | `msdyn_ocvoicechannelsetting` | Linked to the workstream, and to the phone number if one is given. Holds the recording and transcription settings. |
| Text-to-speech voice | `msdyn_ocvoice` | Only when `tts_voice` is set. The admin center gives each channel language its own voice record, and so does this tool. |
| Channel language | `msdyn_ocvoicechannellanguagesetting` | The channel's primary language, with its voice and hold/wait music. |

The platform's workstream plug-ins complete the workstream (routing contract, notification templates, record identification), but **not its routing rules**: the admin center only creates a routing configuration when you set up routing rules. After creating a workstream the tool checks, and its notes tell you to set up the routing rules in the admin center.

If a record fails, the rest of **that** workstream is skipped (later records depend on earlier ones) and the other workstreams continue. The results list exactly which records exist. The tool never deletes anything, including half-built workstreams: removing those is left to the admin, with links to each record.

## The CSV

One row per voice channel; rows with the same `workstream_name` form one workstream. Fill in the workstream columns on a workstream's first row. Later rows can leave them blank, and if they do fill them in the values must match. A row without any channel columns creates a workstream with no channel.

The column reference, with defaults and allowed values, is in the tool's Upload step and in `src/template.ts` (the single source for the template, the validation and the reference). In short:

- **Workstream:** `workstream_name` (required), `direction`, `work_distribution`, `capacity_format`, `capacity_profile`, `capacity_units`, `allowed_presences`, `default_queue`, `outbound_queue`, `notification`, `agent_affinity`, `restrict_recording_download`, `restrict_transcript_download`.
- **Voice channel:** `channel_name` and `language` (required for a channel), `phone_number` (blank = no number yet), `tts_voice`, `voice_style`, `voice_speed`, `voice_pitch`, `hold_music`, `wait_music`, `operating_hours`, `transcript_recording` (None / Transcript / Transcript and Recording), `transcript_recording_start` (Automatic / Manual), `agent_transcription_controls`, `agent_recording_controls`, `request_recording_consent`, `stop_recording_on_hold`, `play_recording_notifications`, `show_transcript_by_default`, `pstn_transfer_controls`, `teams_transfer_controls`.

An empty cell either takes the tool's default, leaves the field unset, is an error (required columns), or, on a workstream's later rows, takes the first row's value. The [manual](manual.md#what-happens-when-you-leave-a-cell-empty) lists which applies to every column, and where the result differs from the admin center (`transcript_recording` defaults to None; hold and wait music are left unset).

Names are matched case-insensitively. A name that matches two records (for example two queues called "Billing") is an error rather than a guess.

### Checks

| Check | Severity |
| --- | --- |
| Missing `workstream_name` column, empty file, a column listed twice | Error |
| Invalid choice, number or Yes/No value | Error |
| A later row contradicts its workstream's first row | Error |
| A channel row missing `channel_name` or `language` | Error |
| Phone number not in E.164 format | Error |
| Duplicate channel name in the file | Error |
| Workstream name already exists in the environment | Error |
| Queue, capacity profile, language, music or operating hours not found, or ambiguous | Error |
| Phone number not in the environment, or deactivated | Error |
| Unknown column (ignored) | Warning |
| `transcript_recording_start` Manual with `transcript_recording` None (not used) | Warning |
| Workstream with no channel; inbound workstream with no fallback queue | Warning |
| Inbound channel without a text-to-speech voice; voice that doesn't match the language | Warning |
| Phone number used twice in the file, already used by another channel, or not enabled for the direction | Warning |
| Channel name already exists in the environment | Warning |
| `outbound_queue` on an inbound workstream, `capacity_profile` with Unit capacity (ignored) | Warning |

### Example CSV

The example creates 5 workstreams with 6 voice channels and uses every column:

| Workstream | Shows |
| --- | --- |
| Sales – Voice | Three channels on one workstream (NL with a number, EN and BE without); Transcript and Recording, and Transcript; operating hours, music, consent |
| Support – Voice | Transcript and Recording with a **manual** start, stop on hold, agent affinity |
| Claims – Voice | Unit capacity (50), None, restricted recording download, a channel without a number |
| Callbacks – Outbound | Outbound workstream with an outbound queue, Transcript |
| Escalations – Voice | A workstream without a channel (shows the warning) |

Every name in it exists in the sample environment, so it runs cleanly in demo mode. For a live environment, replace the queue, number, music and operating-hours names with your own.

## Run log

After creating, **Download log** saves `voice-workstreams-log-<date><time>.csv`. Every row starts with the tool, environment, user, run start and finish time, and source file. The rows are:

- **Record:** every record the run created, failed or skipped, with its type, name, status, **record id** and time. Failures have the platform's error.
- **Note:** follow-up per workstream, such as a channel that still needs a number.
- **Review warning:** the warnings that were accepted when the plan was confirmed.

The ids make it possible to find, audit or remove exactly what a run created. The Review step also has a separate **Download** for the problem list, for fixing a file offline.

## Permissions and safety

The person using it is expected to be a **system administrator** (or have create privileges on the five tables above plus read access to the lookup tables).

- It only **creates**, only in the five tables listed, and only from `src/dataverse.ts`. `create()` refuses any other table at runtime, and `tests/writeScope.test.ts` fails the build if `updateRecord`, `deleteRecord`, `execute` or `fetch` appears anywhere in `src/`.
- It writes only after the review step and an explicit confirmation naming the environment.
- The topbar always shows which environment it writes to.

## Tables read

`queue` (active omnichannel queues), `msdyn_capacityprofile`, `msdyn_operatinghour`, `msdyn_ocphonenumber`, `msdyn_oclanguage`, `msdyn_ocphonemusic`, `msdyn_liveworkstream` (names, for duplicates), `msdyn_ocvoicechannelsetting` (names and numbers in use), `msdyn_routingconfiguration` (after creating).

## Build, run, deploy

```powershell
npm install
npm test
npm run demo:voicebuilder   # http://localhost:5436/index.html — sample environment, nothing is written
pwsh ./scripts/deploy.ps1 -Tool voicebuilder -CreateIfMissing   # first time
pwsh ./scripts/deploy.ps1 -Tool voicebuilder                    # afterwards
```

Web resources: `pct_/tools/voicebuilder/{index.html,style.css,bundle.js}`. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#site-map-subarea) for adding the Site Map subarea.
