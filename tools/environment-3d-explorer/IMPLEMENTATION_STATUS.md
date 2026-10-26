# Environment 3D Explorer — implementation status

## State (2026-10-23)

First version, built to see what a 3D view of the environment feels like.

- Runs on the sample environment (`npm run demo:explorer3d`). It was checked in headless Edge (SwiftShader WebGL): overview, focus on a workstream, focus on a queue, and the camera flight.
- **Deployed to `academyexperiment` on 2026-10-23, and redeployed after each extension.** The deploy script read the three web resources back to verify them. Included in the packaged solution from **1.0.0.12** onward; **1.0.0.13** has the version with all the extensions below, up to the tabbed panel; **1.0.0.16** has the guided tour and is the current solution (current: `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_16.zip`): **3D → 3D Explorer**. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/explorer3d/index.html`. See the [toolbox README](../../Readme.md#site-map-subareas).
- **Tried live** by the user in `academyexperiment` (2026-10-23 and 24): navigation, the health overlay, follow the call (after which the fly-through was replaced and the ride camera moved back), the tabbed panel, layer distance and full screen. **Still open**: live activity with real traffic (the environment had no open conversations or signed-in agents), and other environments and larger data volumes.

## Schema

No new schema was needed: every table and column is one another toolbox tool already reads and verified live:

- Phone numbers and voice channels: Voice Workstream Builder.
- Workstreams, routing configurations, steps and route-to-queue rulesets: Route-to-Queue Builder and Visual Routing Tester.
- Queues and memberships: Voicemail Builder.
- Bookable resources and skills: Agent Readiness Checker.

## Decisions

- **Three.js through React Three Fiber (v8, for React 18) and drei (v9).** Three.js is pinned to 0.169. This fits the existing React/TypeScript/webpack stack. The bundle is about 1 MB.
- **Depth follows the call flow**, so "in front of" and "behind" a record mean upstream and downstream.
- **Focus walks only one way per direction**: upstream from the record, then downstream from it, never mixed. So focusing a queue doesn't light up its sibling queues.
- **Walk mode turns the view by dragging, not with pointer lock**: the model-driven app's frame may not allow pointer lock.
- **Labels**: only the selected record, its direct links and the hovered record get one. Labelling the whole chain piled them on top of each other.
- **Layout**: a back layer is stretched out to at least the workstreams' spread. Without that, queues fed by many workstreams all landed in the middle.

## Health overlay (2026-10-23)

Structural checks on the graph, in `src/health.ts`: see the [README](README.md#health-overlay) for the list. Checked on the sample environment, which has a few problems on purpose (an empty queue that's routed to, a rule to a deleted queue, a workstream that routes nowhere, a channel without a number, an unused number, a disabled agent, an agent without a bookable resource).

- The checks are written for the explorer instead of reusing Artifact Finder's or Agent Readiness Checker's code. Those tools work on their own, larger models (around 30 tables), and here the checks only need the links the scene already has.
- "No bookable resource" is a warning, not a problem: without one, an agent can't have capacity profiles or skills, but this tool doesn't confirm that routing skips them.
- A default queue that's gone is reported once (default queue not found), not also as "routes nowhere".
- Open question for the live test: how many warnings a real environment has, and whether any check is too noisy.

## Ways to look (2026-10-23)

Follow the call, size by connections, saved views, screenshot and the `ride` page option. Checked on the sample environment; the ride's motion still needs a hands-on check (headless Edge renders only a few frames).

- **Follow the call replaces a first fly-through** that jumped from layer to layer. Tried live on 2026-10-23, it felt wrong: every layer stayed visible, so a jump didn't show a route. The ride follows the lines instead, lights the route and the next choices (the rest dimmed, or hidden with "Show only the route"), and asks at forks.
- The ride: a point travels the route's straight lines at a steady speed, slowing towards a fork or the end. The camera follows it on a spring, 32 units behind and 10 above (doubled after the live test: closer felt too close), which rounds the corners. The camera first flies to its place behind the start, then the call sets off.
- The route runs along number, channel, routes, default-queue and member links. Skills aren't a step a call takes, so it ends at the agent. Rules are offered in their order, the default queue after them.
- Saved views use the browser's local storage, keyed by environment. They're a convenience: if storage is blocked they're simply not remembered.
- The screenshot renders one frame right before reading the canvas, instead of turning on `preserveDrawingBuffer`, which would cost on every frame. Labels are HTML and aren't in the picture.
- Dataverse passes a Site Map subarea's parameters as one `data` value, so `data=focus=…&health=1&ride=1` is read as well as plain `?focus=…`.
- Not built yet, each needing a decision first: **VR** (WebXR needs the page outside the app's frame, where it has no Dataverse session) and **comparing environments or snapshots** (needs a snapshot format and somewhere to keep it).

## Live activity (2026-10-23)

Presence, open conversations and the last 24 hours, read every 15 seconds while it's on. Checked on the simulated sample activity; not yet seen with real traffic.

Schema, read-only and checked live on academyexperiment (2026-10-23):

- `msdyn_agentstatus`: `_msdyn_agentid_value`, `msdyn_isagentloggedin`, `msdyn_currentpresenceid` (as Agent Readiness Checker reads it), expanded to `msdyn_presence`'s `msdyn_name` and `msdyn_basepresencestatus` (192360000 Available, …001 Busy, …002 Busy - DND, …003 Away, …004 Offline). Signed out counts as offline whatever presence was last set.
- `msdyn_ocliveworkitem`: `statuscode` 1 Open, 2 Active, 3 Waiting, 4 Closed, 5 Wrap-up, 6 Resolved, 7 Scheduled. `_msdyn_cdsqueueid_value` is the `queue`; `_msdyn_queueid_value` points at the older `msdyn_omnichannelqueue` table and was empty on every recent conversation. `_msdyn_activeagentid_value` is the `systemuser`.
- "Waiting" is Open with no agent; Active, Waiting and Open-with-an-agent count as "with an agent". This is a reading of the status names, to check against real traffic.
- At the time of writing academyexperiment had no open conversations and no signed-in agents, which is why the last 24 hours are counted too.

## More of the configuration (2026-10-23)

Bots, context variables, operating hours, overflow actions, capacity profiles, teams and business units. Checked on the sample environment.

Schema, read-only and checked live on academyexperiment (2026-10-23), or already verified by another tool:

- **Bots**: `msdyn_liveworkstream.msdyn_bot_user` points at the bot's `systemuser` (a non-interactive user, for example "Copilot Contoso Claims IVR (Microsoft Copilot Studio)"). Bot users are read by id, because the agents read is interactive users only. A bot is drawn once per workstream, so a bot shared by two workstreams doesn't join their routes; the channel then links to the bot and the bot to the workstream.
- **Operating hours**: only on queues (`_msdyn_operatinghourid_value`); `msdyn_liveworkstream` has no operating hours column.
- **Overflow**: the queue's `_msdyn_prequeueoverflowrulesetid_value` and `_msdyn_inqueueoverflowrulesetid_value` rulesets (Voicemail Builder), rules pointing at `msdyn_overflowactionconfig` through `overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid` (Visual Routing Tester). `msdyn_overflowactiontype`: 192350000 Default (not drawn), …001 End Conversation, …002 Transfer to Phone, …003 Direct Callback, …004 Voicemail, …005 Queue Transfer (target queue in `msdyn_overflowactiondata`), …006 Remain In Queue, …007 Scheduled Callback. Trigger names come from Voicemail Builder's verified list ("Out of operating hours" and so on).
- **Capacity profiles**: `msdyn_liveworkstreamcapacityprofile` (`_msdyn_workstream_id_value`, `_msdyn_capacityprofile_id_value`, checked live) and `msdyn_bookableresourcecapacityprofile` (Agent Readiness Checker).
- **Context variables, teams, business units**: as Route-to-Queue Builder, Agent Readiness Checker and Skill Assignment read them. Default business-unit teams are left out, since every user is in one.
- Health: a queue counts as reached through a rule, a default queue or another queue's overflow transfer, not through operating hours; a voice workstream with a bot counts the bot's channels.
- Not yet: other channels (chat, SMS, WhatsApp) as their own channel records, and classification rules.

## Panel, layer distance, full screen (2026-10-24)

After the user's review: the left panel had grown too long, layers were hard to read with many of them, and the app's menu took room.

- **Tabs**: the header, search, camera buttons and layer distance stay on top; Layers, Explore, Live, Health and Help below. Panels' state lives in the page, so switching tabs switches nothing off.
- **Opening tab**: `tab=<name>` in the page address, or otherwise the tab that goes with what the address switches on (Health with `health=1`, Live with `live=1`, Explore with `ride=1`).
- **Layer distance** (1× to 3×, also `depth=` in the page address): positions are laid out once and only their depth is stretched, so dragging the slider doesn't redo the layout. The camera, the orbit point, the layer rings and the fog stretch with it.
- **Full screen** requests full screen on the app's frame (`window.frameElement`, reachable because the web resource and the app share an origin), so the app's menu and header go; outside a frame, the page itself. If the app's page refuses, the page itself is tried, then a message is shown. To check inside the app: whether the browser allows it from the frame without extra frame permissions.

## Camera (2026-10-25)

- Zooming, rotating or dragging during a camera flight (after a click or search) stops the flight, so it doesn't take the camera back (found in the 3D Contact Center, which shares `CameraRig`).

## Guided tour (2026-10-25)

- After the user asked for a way to make a video: a tour that plays by itself on the sample data, captions on top, pause/back/next/end. Shared player in `environment-3d-explorer/src/tour.tsx` (`useTour`, `TourBar`, `plannedRide`, `tourAsked`); each tool's App has its own script of steps, each setting the scene when it starts (and undoing animations when it ends). The left panel shows only for steps about it.
- Starts from **Play the tour** on the Help tab or `tour=1`; on live data it switches to the sample and back. Following a call is planned up front (`plannedRide`), so it plays without stopping at forks. Each tool puts its state back when the tour ends (the 3D Contact Center's tour grouping is never saved).
- `tests/tour.test.ts` (explorer): every record the scripts name is in the sample, and the planned ride reaches the agent.
- After review: a step no longer starts over during live activity (the step clock belongs to its step; the page redraws every few seconds then), and a finished step can't end the next one too. While a tour plays the camera drifts: it slowly circles what it looks at, between flights (`drift` on `CameraRig`; the orbit controls' auto-rotate kept a flight from arriving). The **Play the tour** button has its own style (`.tour-start`).

## Open questions / next ideas

- Live test: data volumes, load time, frame rate with a few thousand agents.
- More record types: overflow actions, operating hours, capacity profiles, business units and teams, context variables, other channels (chat, messaging).
- Live data: presence, open conversations per queue.
- Deep links from other tools (the `?focus=` parameter is there already).

