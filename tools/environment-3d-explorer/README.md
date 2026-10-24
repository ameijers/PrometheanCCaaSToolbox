# Environment 3D Explorer

Shows the whole contact center as a 3D cloud of records you can rotate, zoom into and walk through. Read-only. Step by step: the [manual](manual.md).

![Overview](images/00-overview.png)

## What you see

Each record type sits on its own depth layer. Front to back follows the way a conversation travels:

| Layer (front → back) | Shape | Linked to the next layer by |
| --- | --- | --- |
| Phone numbers | small sphere | the voice channel that uses the number |
| Voice channels | diamond | the channel's workstream, or its bot when the workstream has one |
| Bots | knot | the workstream the bot (a Copilot Studio agent) hands over to |
| Workstreams | large ball | the route-to-queue rules of the active routing configuration, and the default queue |
| *Context variables* | small cone | — (beside their workstream) |
| Routing rules | pyramid | the queue(s) the rule routes to (weighted distributions show the percentage) |
| Operating hours | ring | the queues that use them |
| Queues | cube | the queue's members, and its overflow actions |
| Overflow actions | cone | for a queue transfer, the queue it transfers to |
| Agents | small sphere | the agent's skills (with rating), capacity profiles, teams and business unit |
| *Capacity profiles* | cylinder | — (also linked from the workstreams that use them) |
| Skills | dodecahedron | — |
| *Teams* | octahedron | — (not the business units' default teams, which every user is in) |
| *Business units* | flat block | — |

The types in *italics* start hidden, because they can add a lot of records: tick them in the legend. Context variables, operating hours, overflow actions, capacity profiles, teams and business units sit on half layers next to the records they belong to; their layer name is on the other side of the ring. Overflow actions are drawn per queue, with when they apply (for example "Out of operating hours (before queuing)") in their details.

A faint ring marks each layer. Within a layer, a record sits near the records it's linked to, so connected things line up front to back.

## Using it

The left panel keeps the search box, the camera buttons (**Orbit**, **Walk**, **Reset**, **Full screen**) and the **Layer distance** slider at the top, and puts the rest in tabs: **Layers** (the legend and size by connections), **Explore** (follow the call, saved views, screenshot), **Live**, **Health** (the tab shows the number of problems) and **Help** (the controls, anything that couldn't be read, and reading the environment again). Switching tabs doesn't switch anything off.

- **Layer distance** moves the layers up to three times further apart, which helps when many layers are shown. Only the depth stretches; the camera moves with it, so you keep your place.
- **Full screen** (or F) makes the tool fill the screen, hiding the app's menu and header; Esc goes back. Inside the app the tool puts its own frame in full screen. If the browser refuses, the page says so.

- **Click a record** (or find it with the search box) and the camera flies to it, from a little in front and to the side. Its whole chain lights up: everything in front of it (where its work comes from) and everything behind it (where the work goes). The rest dims. The panel on the right lists its details and direct links. Click a link to move on to that record.
- **Show only this chain** hides everything else, which helps when you walk through it.
- **Orbit mode**: drag to rotate, scroll to zoom, right-drag to pan.
- **Walk mode**: drag to look around. You turn the view by dragging, without pointer lock, so walk mode also works inside the model-driven app's frame.
- **Both modes**: W A S D or the arrow keys move, E/Q go up and down, Shift moves faster. M switches mode, Esc clears the focus.
- The checkboxes in the legend hide or show a layer.
- **Follow the call** rides along the lines a call takes, from the selected record (or, with nothing selected, the first phone number): phone number → voice channel → bot (if there is one) → workstream → routing rule → queue → agent, or an overflow action (a queue transfer rides on to its queue). A bright point travels the route and the camera rides behind it, looking ahead. Where there's one way the ride goes on by itself; at a fork (a workstream's rules and default queue, a queue's agents) it slows down and asks where the call goes next. Everything else is dimmed; tick **Show only the route** to hide it. Pause, start again and stop are in the ride bar; Esc also stops it.
- **Size by connections** makes each record's size show how many links it has, so busy queues and big workstreams stand out.
- **Save view** keeps the current camera position under a name; click a saved view to fly back to it. Saved views stay in this browser, per environment.
- **Screenshot** downloads the current view as a PNG (without the name labels, which are HTML on top of the scene).
- The page address can ask for `focus=<name>`, `health=1`, `live=1`, `depth=<1 to 3>` (layer distance) and `ride=1` (start following the call when the page opens, from the focused record if there is one). On a Site Map subarea, put them in the web resource's data parameter, for example `focus=Sales&ride=1`; a plain data value is read as a record name.

![A workstream in focus](images/01-workstream-focus.png)

## Health overlay

**Show problems** (Health tab) puts a pulsing glow around every record with an issue: red for a **problem** (conversations can get stuck or lost there), orange for a **warning** (worth a look, but it can be on purpose). The panel lists them, problems first. Click one to fly to it with its chain lit. **Only records with an issue** shows just those records and their direct links. A selected record's findings, with a suggested fix, are always in the details panel.

| Record | Check | Severity |
| --- | --- | --- |
| Workstream | Default queue isn't an active omnichannel queue | Problem |
| Workstream | No route-to-queue rules and no default queue ("routes nowhere") | Problem |
| Workstream | No route-to-queue rules, so everything goes to the default queue | Warning |
| Workstream | Voice workstream without a voice channel | Warning |
| Voice channel | No phone number | Warning |
| Phone number | Not used by any voice channel | Warning |
| Routing rule | Routes to a queue that isn't an active omnichannel queue | Problem |
| Queue | No members (or only disabled members): a problem when something routes to it, a warning otherwise | Problem / Warning |
| Queue | Nothing routes to it (no rule, not a default queue) | Warning |
| Agent | Disabled user still in a queue | Warning |
| Agent | Queue member without a bookable resource | Warning |

The checks use only the data the scene already has, so the overlay reads nothing extra. A check that needs a table that couldn't be read is skipped, and the panel says which. For a full clean-up review, use the Environment Artifact Finder; for one agent in depth, the Agent Readiness Checker.

![Health overlay](images/03-health.png)

## Live activity

**Live activity** (Live tab) puts what's happening now on top of the configuration, read again every 15 seconds:

- **Agents** take the colour of their presence: available (green), busy (red), do not disturb (dark red), away (amber), offline or signed out (grey).
- **Conversations** open now are small points: yellow ones **waiting** circle their queue, cyan ones **with an agent** and violet ones **in wrap-up** circle that agent.
- **Queues** with conversations waiting grow and get a label, for example "Billing · 3 waiting".
- A conversation that's new since the previous read **shoots from its workstream to its queue** as a comet.
- The panel counts conversations by status, the conversations created in the last 24 hours, and agents by presence. A selected queue or workstream shows waiting now, with an agent now and the last 24 hours; a selected agent shows their presence and conversations.

The last 24 hours are there because a test environment often has nothing open. If a read fails, the panel says so and the last picture stays. `live=1` in the page address turns it on when the page opens. In the sample environment the activity is simulated and moves every 5 seconds.

## How it works

- `src/dataverse.ts` reads the tables below with `Xrm.WebApi.retrieveMultipleRecords` (through `shared/src/xrm.ts`). Phone numbers, voice channels and skills are optional: if one of them can't be read, the rest still shows and the page says what's missing.
- `src/graph.ts` turns the rows into nodes and edges, with edges pointing downstream. It reuses Visual Routing Tester's decision-XML parser for the route-to-queue rules.
- `src/health.ts` runs the health checks on the graph, and `src/live.ts` maps live presence and conversations onto it (`src/demoLive.ts` simulates them for the demo).
- `src/ride.ts` works out the route for "follow the call", `src/views.ts` keeps the saved views and `src/urlOptions.ts` reads the page address.
- `src/layout.ts` places the nodes deterministically, so the same environment always gives the same picture.
- `src/Scene.tsx` draws them with [Three.js](https://threejs.org) through React Three Fiber and drei. Each record type is one instanced mesh, and all the lines are one geometry, so thousands of records stay smooth.

### Tables read

`msdyn_ocphonenumber`, `msdyn_ocvoicechannelsetting`, `msdyn_liveworkstream` (active), `msdyn_routingconfiguration`, `msdyn_routingconfigurationstep`, `msdyn_decisionruleset` (the route-to-queue rulesets only), `queue` (active omnichannel queues, not `<CDS System>`), `queuemembership`, `systemuser` (interactive users), `bookableresource`, `bookableresourcecharacteristic` (with its characteristic and rating). Around the call path, each optional: the workstreams' bot users (`systemuser`), `msdyn_ocliveworkstreamcontextvariable`, `msdyn_operatinghour`, the queues' overflow rulesets (`msdyn_decisionruleset`) and `msdyn_overflowactionconfig`, `msdyn_capacityprofile`, `msdyn_liveworkstreamcapacityprofile`, `msdyn_bookableresourcecapacityprofile`, `team`, `teammembership`, `businessunit`. With live activity on, also `msdyn_agentstatus` (with `msdyn_presence`) for the agents, and `msdyn_ocliveworkitem` for conversations open now or created in the last 24 hours.

Agents are the users who are a member of at least one omnichannel queue.

### Written

Nothing. `tests/readOnly.test.ts` fails if any source file names a write method or calls `fetch`, and checks that loading the environment only calls `retrieveMultipleRecords`.

## Build, run, deploy

- Demo with sample data: `npm run demo:explorer3d` → http://localhost:5448/index.html
- Tests: `npx jest tools/environment-3d-explorer`
- Deploy: `pwsh ./scripts/deploy.ps1 -Tool explorer3d` (add `-CreateIfMissing` in an environment where its web resources don't exist yet).
- Web resources: `pct_/tools/explorer3d/{index.html,style.css,bundle.js}`. In the packaged solution from **1.0.0.12** (Site Map: **3D → 3D Explorer**). For an environment on an older solution version, add a subarea for `pct_/tools/explorer3d/index.html` by hand (see the [toolbox README](../../Readme.md#site-map-subareas)).

The bundle is about 1 MB, because Three.js is included. The other tools are about 200 KB each.
