# Recording & Transcription Provisioner

Part of the [Promethean CCaaS Toolbox](../../Readme.md). The first of the toolbox's **provisioning tools**: it sets call recording and transcription on many voice channels at once. Pick the channels, pick the setting, check the preview, confirm.

See the [manual](manual.md) for a walkthrough with screenshots, and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for status and open questions.

![Preview](images/01-preview.png)

## How it works

1. **Select channels.** Every voice channel (`msdyn_ocvoicechannelsetting`) is listed with its workstream, phone number and current setting. Filter by workstream, direction, current setting or text, then tick channels one by one or **Select all shown**. Selection survives filtering, so several filtered views can be combined.
2. **Choose the setting.** One of the three options:
   - **None**: no transcript, no recording
   - **Transcript**: calls are transcribed, no audio is recorded
   - **Transcript and Recording**: calls are transcribed and recorded

   Optionally also **Start** (Automatic when the call connects, or Manual when the agent starts it), and under **More options** any of the six other options. Everything defaults to **Leave unchanged**, so only what you choose is written.
3. **Preview.** Each selected row shows what it would become and exactly which options change. The panel counts how many channels will change and how many already have the setting (those are left alone).
4. **Apply.** After a confirmation naming the environment, each channel is updated with **only the columns that change on that channel**. Then every channel is read back to confirm the new values stuck.
5. **Review, log and revert.** The result shows what was updated, what failed and why, and anything that saved but read back differently. **Download log** saves the run (see [Run log](#run-log)). **Revert this change** puts the previous values back on every channel that was updated, and that revert gets its own log.

## Options

| Option | Columns |
| --- | --- |
| Transcript and recording (None / Transcript / Transcript and Recording) | `msdyn_transcriptionenabled`, `msdyn_recordingenabled` |
| Start (Automatic / Manual) | `msdyn_transcriptionmode`, `msdyn_recordingmode` (on the capabilities that are on; None otherwise) |
| Agents can pause/resume transcription | `msdyn_agenttranscriptioncontrolsenabled` |
| Agents can pause/resume recording | `msdyn_agentrecordingcontrolsenabled` |
| Ask the caller for recording consent | `msdyn_requestuserconsentforrecording` |
| Stop recording and transcription on hold | `msdyn_enablestoprecordingtranscriptiononhold` |
| Play recording/transcription notifications | `msdyn_playrecordingtranscriptionnotifications` |
| Show live transcript to agents by default | `msdyn_transcriptionshowbydefault` |

The mapping lives in `voice-workstream-builder/src/recordingSettings.ts`, which both tools share, so a new channel built by Voice Workstream Builder and a channel changed here get identical columns.

The option and its start mode share those four columns, so when either changes all four are written together. A channel can't end up half switched.

**Recording without transcript.** An environment can hold a channel with recording on and transcription off, which isn't one of the three options. It's shown as *Recording without transcript* (with its own filter entry). Applying any option replaces it, and **Revert** restores it exactly.

## Run log

**Download log** saves `recording-apply-log-<date><time>.csv` (or `recording-revert-log-…`). There's one row per channel written, and each row has the tool, environment, user, run start and finish time, action (Apply or Revert), workstream, channel, channel id, phone number, status, the setting **before** and **after**, each changed option (e.g. *Transcript and recording: None → Transcript \| Start: Automatic → Manual*), the time of the update, and the error if it failed.

## Permissions and safety

The person using it is expected to be a **system administrator** (or have write access to `msdyn_ocvoicechannelsetting`).

- It only **updates**, only `msdyn_ocvoicechannelsetting`, only the ten columns above, and only from `src/dataverse.ts`. `updateChannel()` refuses any other column at runtime. `tests/writeScope.test.ts` fails if `createRecord`, `deleteRecord`, `execute` or `fetch` appears in `src/`, or if `updateRecord` targets anything but the channel table.
- Channels that already have the setting aren't written at all.
- New settings apply to calls that start after the change. Check your organisation's recording and consent obligations before switching recording on.

## Tables read

`msdyn_ocvoicechannelsetting` (channels and their settings), `msdyn_liveworkstream` (name, direction), `msdyn_ocphonenumber` (number).

## Build, run, deploy

```powershell
npm install
npm test
npm run demo:recordingprovisioner   # http://localhost:5437/index.html — sample environment, nothing is written
pwsh ./scripts/deploy.ps1 -Tool recordingprovisioner -CreateIfMissing   # first time
pwsh ./scripts/deploy.ps1 -Tool recordingprovisioner                    # afterwards
```

Web resources: `pct_/tools/recordingprovisioner/{index.html,style.css,bundle.js}`.
