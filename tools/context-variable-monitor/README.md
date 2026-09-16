# Context Variable Monitor

Part of the [Promethean CCaaS Toolbox](../../Readme.md). For step-by-step usage instructions and screenshots, see the [manual](manual.md).

![Overview of Context Variable Monitor showing the top bar, workstream sidebar, and both value tables](images/01-overview.png)

## What it does

Context Variable Monitor lets you pick an inbound voice workstream and **watch the actual context-variable values a real call captures**, live, as it moves through the IVR and unified routing. Unlike [Visual Routing Tester](../visual-routing-tester/README.md), which reads configuration and simulates against it, this tool reads **runtime data from real calls** — nothing here is simulated.

It's built for debugging and validating IVR/bot behavior against real traffic: is a context variable actually being set, when, and to what value — including internal bot values that were never formally declared as a context variable.

Typical uses:
- Confirm a context variable is actually populated (and with what value) during a live test call, instead of guessing from routing behavior alone.
- Watch values fill in progressively during a call to understand IVR/bot timing.
- Go back and inspect a recent call's captured values instead of only the latest one.

## Key features

- Workstream picker (inbound voice workstreams only, same filter as Visual Routing Tester).
- Shows every officially-defined context variable for the selected workstream, with its current captured value or "Not set yet".
- An "Additional captured values" section for anything a call set that isn't a formally-defined context variable (bot/IVR-internal values), since these are often useful for debugging.
- Tracks the **latest call** on the workstream by default, with a recent-calls list (last 10) to pin an older call instead.
- **Live** mode auto-polls every 4 seconds (starts paused — turn it on when you're about to place a test call); a manual **Refresh** works regardless of Live state.
- Newly-appeared or changed values are highlighted briefly so a live-filling value is easy to spot.
- A fully working offline demo mode that advances through a preset sequence of snapshots on every Refresh/Live tick — no Dataverse connection required to see the "watch it fill in" behavior.

This is a **read-only** tool: it never writes to a call or its context variables.

## How it works

Same shape as Visual Routing Tester: a plain HTML/CSS/React (TypeScript) app, deployed as a trio of Dataverse web resources and hosted via its own Site Map subarea — see the [toolbox README](../../Readme.md#architecture) for why this toolbox defaults to web resources over PCF controls.

It reads `msdyn_ocliveworkitem` (the call/work item record) and `msdyn_ocliveworkitemcontextitemelastic` (an elastic/Cosmos-backed table holding each captured name/value pair), matching captured values to their context-variable definitions **by name** rather than by lookup, since that lookup is null in practice on real calls.

For the full technical detail — real schema findings, how entity-reference values are unwrapped, and known open questions — see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Build, test, and run locally (no Dataverse connection needed)

```powershell
npm install
npm test
npm run build
npx serve dist/webresource/contextvariablemonitor -l 5433
```

Then open `http://localhost:5433/index.html` to explore the demo mode.

## Deploy to a Dataverse environment

```powershell
pwsh ./scripts/deploy.ps1 -Tool contextvariablemonitor
```

See the [toolbox README](../../Readme.md#deployment) for how deployment is configured (`deploy.config.json`) and what the script does. Note: this tool's Site Map subarea was added manually and is not part of the deploy script.
