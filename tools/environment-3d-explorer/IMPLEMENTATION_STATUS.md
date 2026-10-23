# Environment 3D Explorer — implementation status

## State (2026-10-23)

First version, built to see what a 3D view of the environment feels like.

- Runs on the sample environment (`npm run demo:explorer3d`). It was checked in headless Edge (SwiftShader WebGL): overview, focus on a workstream, focus on a queue, and the camera flight.
- **Deployed to `academyexperiment` on 2026-10-23.** The deploy script read the three web resources back to verify them. Included in the packaged solution from **1.0.0.12** onward (current: `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_12.zip`): **3D → 3D Explorer**. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/explorer3d/index.html`. See the [toolbox README](../../Readme.md#site-map-subareas).
- **Not yet tested live**: whether it reads the live data correctly, load time, and frame rate. Orbit, walk, keyboard movement and hover also still need a hands-on check, especially inside the model-driven app's frame.

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

- **Follow the call replaces a first fly-through** that jumped from layer to layer. Tried live on 2026-10-23, it felt wrong: every layer stayed visible, so a jump didn't show a route. The ride follows the lines instead, shows only the route and the next choices, and asks at forks.
- The ride: a point travels the route's straight lines at a steady speed, slowing towards a fork or the end. The camera follows it on a spring, a little behind and above, which rounds the corners. The camera first flies to its place behind the start, then the call sets off.
- The route runs along number, channel, routes, default-queue and member links. Skills aren't a step a call takes, so it ends at the agent. Rules are offered in their order, the default queue after them.
- Saved views use the browser's local storage, keyed by environment. They're a convenience: if storage is blocked they're simply not remembered.
- The screenshot renders one frame right before reading the canvas, instead of turning on `preserveDrawingBuffer`, which would cost on every frame. Labels are HTML and aren't in the picture.
- Dataverse passes a Site Map subarea's parameters as one `data` value, so `data=focus=…&health=1&ride=1` is read as well as plain `?focus=…`.
- Not built yet, each needing a decision first: **VR** (WebXR needs the page outside the app's frame, where it has no Dataverse session) and **comparing environments or snapshots** (needs a snapshot format and somewhere to keep it).

## Open questions / next ideas

- Live test: data volumes, load time, frame rate with a few thousand agents.
- More record types: overflow actions, operating hours, capacity profiles, business units and teams, context variables, other channels (chat, messaging).
- Live data: presence, open conversations per queue.
- Deep links from other tools (the `?focus=` parameter is there already).
