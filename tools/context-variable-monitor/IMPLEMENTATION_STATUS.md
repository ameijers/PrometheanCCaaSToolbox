# Context Variable Monitor — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md) for the tool overview. This is the toolbox's second tool. Unlike [Visual Routing Tester](../visual-routing-tester/README.md) (which reads *configuration* and simulates against it), this tool reads **runtime data from real calls** — it never simulates anything.

## Purpose

Pick a workstream, see its defined context variables, and watch the actual values a real call captures as it goes through the IVR and unified routing — live (auto-poll) or on demand (Refresh), plus a short recent-calls list to go back and inspect an older call instead of always the latest.

## Architecture

- Same shape as Visual Routing Tester: plain HTML/CSS/React (TypeScript), deployed as a Dataverse web resource trio, hosted via its own classic Site Map subarea. See the toolbox-level `[[web-resource-vs-pcf]]` reasoning — this is likewise a standalone full-page tool, not bound to any one record.
- `tools/context-variable-monitor/{src,tests,webresource,css}`, built via the shared root `webpack.config.js` (entry key `contextvariablemonitor`) and deployed via the shared root `scripts/deploy.ps1` (`-Tool contextvariablemonitor`).
- Read-only against Dataverse, same as Visual Routing Tester — never writes to a call or its context variables.

## Real-schema findings (confirmed against a live, populated environment)

- `msdyn_ocliveworkitem` is the actual call/conversation record (activity-based; `_msdyn_liveworkstreamid_value` links it to its workstream; `statecode` 0 = open/in-progress, 1 = completed).
- The actual captured values live in `msdyn_ocliveworkitemcontextitemelastic` — an elastic (Cosmos-backed) table, one row per captured name/value pair per call. It holds **both** officially-defined context variables **and** bot/IVR-internal values that were never declared as one (e.g. `va_BotName`, `va_ConversationId`, `IsLoggedIn` showed up on a real call alongside the officially-defined `ContactId`/`ContactName`/`IsIdentified`) — the latter are shown separately in the UI as "Additional captured values" rather than hidden, since they're genuinely useful for debugging IVR/bot configuration.
- Rows are written **progressively during the call** (confirmed two rows on the same real call 11 seconds apart) — the "watch it fill in live" behavior is grounded in real platform behavior, not just a nice idea.
- The row's own lookup back to the variable definition record is **null in practice** on every real row checked — captured values are matched to their definition **by name** (case-insensitive), not by that lookup. This mirrors how condition XML elsewhere in the toolbox already references variables by name rather than id.
- `msdyn_value` is a plain string for text/number/boolean, but a JSON array (`[{"RecordId":"...","PrimaryDisplayValue":"..."}]`) for an entity-reference (`msdyn_datatype` 192350100 — the same enum Visual Routing Tester uses) — unwrapped to `PrimaryDisplayValue` for display.
- A non-elastic sibling table, `msdyn_ocliveworkitemcontextitem`, exists but was found consistently empty for every real call checked — not used by this tool.

## Complete

- Workstream picker (same inbound-voice filter as Visual Routing Tester: `msdyn_enablevoicev2 === true` and inbound direction).
- Defined context variables shown per workstream, each with its captured value or "Not set yet" if the tracked call hasn't set it.
- "Additional captured values" section for anything the call set that isn't an officially-defined variable.
- Tracks the **latest call** on the selected workstream by default; a recent-calls list (last 10) lets you pin an older call instead, with a "Back to latest" control to return to trailing-latest mode.
- **Live** toggle (starts paused by design — you turn it on when about to place a test call) auto-polls every 4 seconds; a manual **Refresh** button works regardless of Live state.
- Newly-appeared or changed values are highlighted for a few seconds so a live-filling value is easy to spot.
- Fully working demo mode with no Dataverse connection: a small preset sequence of snapshots advances on every Refresh/Live tick, demonstrating the actual "watch it fill in" behavior rather than showing static fake data.
- Automated tests: 9 passing (`tools/context-variable-monitor/tests/contextValues.test.ts`) covering datatype mapping, entity-reference JSON unwrapping (including malformed/unexpected-shape fallbacks), and definition-to-value matching (including the "extra captured value" and "no captured values at all" cases).

## Still open / not yet verified

- **TTL behavior on the elastic table** — every real row checked had `ttlinseconds: null` (no observed expiry), but the field exists; if it's ever populated in some scenario, old calls' captured values could disappear out from under the recent-calls list. Not handled specially; would just show as "Not set yet" again, which degrades gracefully but hasn't been tested against an actual expiry.
- **Very high-volume workstreams** — the recent-calls list is a flat `$top=10` query; no pagination or filtering by call outcome/state has been built, since it hasn't been needed yet.
- **Chat/other channel workstreams** — deliberately scoped to inbound voice only, matching the original ask ("when a call comes by ... went through the ivr"). Extending to chat-based workstreams would need the same schema re-verified for that channel (untested assumption that it'd work the same way).

## Build & test locally

```powershell
npm test
npm run build
npx serve dist/webresource/contextvariablemonitor -l 5433
```

Then open `http://localhost:5433/index.html`. No Dataverse connection needed to explore the demo mode.

## Deploy

```powershell
pwsh ./scripts/deploy.ps1 -Tool contextvariablemonitor
```

First deploy used `-CreateIfMissing` to create the three web resources and add them to the `ccaasvisualroutingtester` solution; routine redeploys should omit it. The Site Map subarea was added manually (not part of the deploy script — see `[[dataverse-deployment]]`).
