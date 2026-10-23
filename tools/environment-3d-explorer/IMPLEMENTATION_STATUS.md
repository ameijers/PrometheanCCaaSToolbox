# Environment 3D Explorer — implementation status

## State (2026-10-23)

First version, built to see what a 3D view of the environment feels like.

- Runs on the sample environment (`npm run demo:explorer3d`). It was checked in headless Edge (SwiftShader WebGL): overview, focus on a workstream, focus on a queue, and the camera flight.
- **Not yet deployed or tested live.** Not in the solution zip, no Site Map subarea yet.
- Not yet tried interactively by a person. Orbit, walk, keyboard movement and hover need a hands-on check, especially inside the model-driven app's frame.

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

## Open questions / next ideas

- Live test: data volumes, load time, frame rate with a few thousand agents.
- More record types: overflow actions, operating hours, capacity profiles, business units and teams, context variables, other channels (chat, messaging).
- Live data: presence, open conversations per queue.
- Deep links from other tools (the `?focus=` parameter is there already).
