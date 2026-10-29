# 3D Contact Center — implementation status

## State (2026-10-24)

First version: the campus, a building per customer center, combine / split / move / rename / recolour (kept in the browser), and inside each building the entrance, bot kiosk, lobbies, signposts, rooms with desks, opening hours and overflow at the doors. Health overlay from the explorer.

- Checked on the sample environment in headless Edge (campus, a building, a room). Not yet tried hands-on or on live data.
- Included in the packaged solution from **1.0.0.15** onward, with the guided tour from **1.0.0.16** (current: `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_17.zip`): **3D → 3D Contact Center**. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/contactcenter3d/index.html`.

## Decisions

- **A separate tool on the explorer's code**: it imports the explorer's data layer, graph, health checks, sample data, camera rig and full screen (the explorer exports `CameraRig` and `useFullscreen` for it), so both tools always show the same facts.
- **Customer centers are the viewer's grouping**, since Dataverse has none. Every workstream starts as its own center. Saved grouping is matched to today's environment: missing workstreams drop out, new ones get a center of their own.
- **Kept in the browser for now** (local storage, per environment), behind `CenterStore` in `src/store.ts`. A shared Dataverse table (for example `pct_contactcenter`: name, colour, workstream ids) is the intended next step; it would make this a writing tool with a write-scope test for that one table, and needs the table to be created in the solution first.
- **A shared queue's room** goes to the center with the most routes to it; others get a skybridge. (First an agent had one desk, in their first queue by name; replaced by a desk in every room, below.) Queues no workstream routes to get a "Not routed" building.
- **Default-queue links** are faint dashed lines rather than skybridges: in the sample every workstream defaults to the same Overflow queue, and as skybridges they drowned the routing.
- **Light, architectural look** (pale floors in the center's colour, white walls, wooden desks), so it reads as a building, not as the explorer's night sky.

## After the first review (2026-10-24)

- **Rooms in a grid** (⌈√n⌉ per row) instead of one row across the building.
- **One front desk per floor**, a counter on it per workstream, so a center reads as one reception for business users; the signposts of all the floor's workstreams share the corridor.
- **Floors per kind of work**: a workstream's floor follows its channel (`msdyn_streamsource`: voice, record, everything else messaging), a queue's room its type (`msdyn_queuetype`); the explorer's graph now carries this as `facts.stream`. Floors are stacked 16 m apart with glass slabs; the Floors switch (and `floor=`) shows one kind at ground level.
- **Hiding workstreams**, saved with the grouping (`hidden`). Unlinked workstreams (no channel or bot in, no rules or default queue out) start hidden; a grouping saved earlier hides nothing it didn't know about. Rooms only hidden workstreams route to are left out, not moved to "Not routed".
- Labels inside a building scale with distance. Overlap in a big center is better but not gone; the user wants to revisit the 3D objects and their recognisability later.

## Second review (2026-10-24)

- **Wings instead of floors.** Stacked floors hid each other from above. Options weighed: wings, departments on one floor, separate entrances per channel, annex buildings, terraced floors; the user chose wings. One reception, then a wing per kind of work side by side, each with its own tinted floor and sign; the Floors switch became a Wings filter (`wing=`, and `floor=` from before still works). The explorer's graph keeps carrying the stream per workstream and queue.
- **Routing lines** drawn thicker and darker, over a white edge, and slightly above the floor.
- **Customer centers made by hand**: create a named center (it stays while empty), move workstreams in by drag & drop or Move to…, move them out, delete a center. Combine and Split are gone. A grouping saved before this keeps its combined centers as the viewer's own.
- **Sample data** inside Dataverse (button, `demo=1`), in this tool and in the explorer.
- **Live activity** from the explorer's `live.ts`: waiting callers on the room's bench (then a line outside the door), callers with an agent at the desk, new callers walking in from the workstream's way in, desk screens in the presence colour, "n waiting" on the room.
- **Follow a call** with the explorer's `ride.ts` and camera rig; the rig now takes a `rideScale` (0.3 here, so it rides close behind the call inside a building).
- **Skills** as badges on the desk (and listed with their rating in the details), **business units** as carpet (switch on the Explore tab), **context variables** as a clipboard on the counter.

## Lines (2026-10-24)

- The white edge under the lines is gone; lines run 0.5 m above the floor instead, so floor tiles can't hide them. Widths halved after review (they're screen pixels, doubled on high-DPI displays).
- Lines keep to the walkways: rooms are in straight columns (each as wide as its widest room), and a line goes along the corridor, down the aisle left of its room, along the walkway in front of the row, in at the door. A test walks every line and checks it never enters a room.
- A queue transfer is a **door in the back wall** of its room (after review: outside the front it read as something to walk past); its line leaves through that door and along the walkway behind the room. The other overflow stays outside the front door. Waiting is a bench inside the door, beside it, back against the front wall, seats facing into the room (after review: four chairs facing the door looked odd); new callers walk in through the door to it.
- Lines take the **shortest** walkway route (after review: always using the left aisle made detours): a front-row room straight from the corridor, a room further back over the nearer of its two aisles (the right one measured from its column's edge, so a wider room in another row can't block it), a transfer out of the nearer aisle behind its room. Tests check every segment runs along x or z.
- **Follow a call walks like a caller** (\src/walk.ts\): after review it waited in the middle of a room (the queue's spot) and cut straight through walls. It now follows the line on the floor to the room's door, goes in, and waits in front of the bench until an agent is chosen; to overflow by the front door it walks back out first.
- **A desk in every room an agent is in** (2026-10-24, from live data: an agent in several queues showed in only one room, so a queue looked empty). Desks are kept per room and agent (`plan.desks`); the ride walks to the agent's desk in the room it waits in, a live caller stands at the desk in the room of the call's queue.
- **Selecting the desk you click**: an agent with several desks used to fly to their first one. A click now keeps the clicked desk (camera and ring stay there), a room's member links go to that member's desk in the room, and Follow a call from a desk starts at that desk; reached from a room, the ride always goes to the desk in that room.
- **Labels one small size**, shown by distance (rooms and wings within 150 m, signs 90 m, counters and phone numbers 60 m) instead of scaling with distance: after review, scaled labels became huge while exploring close up. They're placed once and shown or hidden a few times a second, without re-rendering.
- The **Not routed** building is hidden at first (after review); a checkbox on the Centers tab, or `unrouted=1`, shows it.
- **A workstream without routing rules** (after review): its default queue is drawn as the one route (solid orange, `only` path), with a sign behind its counter; default-queue rooms get "· default" after their name.
- **Black background, no ground** (after review): the buildings float on near black; the ground plane is gone and the line colours are brighter so they read on the dark.
- A **Lines** legend explains the four styles, from the same list the scene draws with.

## 3D models (2026-10-24)

- Desks are models from Kenney (CC0): `desk`, `chairDesk`, `computerScreen`, `computerKeyboard` (Furniture Kit) and two Mini Characters, slimmed to their `sit` animation (gltf-transform: other animations removed, texture embedded, pruned). About 400 KB of models; the bundle went from 1.1 to 1.6 MB.
- Webpack inlines `.glb` as data URLs (`asset/inline`); jest maps `.glb` to a stub. `useGLTF` loads them (no Draco or meshopt); `toModel` bakes the sitting pose into plain geometry, centres it and scales it (furniture 2.5x; characters 0.65 of that, their heads are big). One instanced mesh per model part.
- Agents sit on the +z side of the desk, facing the screen. Kenney's models face +z, so the desk, screen and keyboard keep that and the chair and people turn round (the screen and keyboard were turned round at first; found in review). The screen's display (its `metal` material) is coloured per desk in the agent's presence colour. The box desks stay as the fallback.
- Then the rest (after review: "looks good, let's do the rest"): waiting chairs (`chairModernCushion`, one per bench seat) instead of the bench, a receptionist behind each counter, potted plants in the lobby corners, callers (sitting on the chairs, standing beside them when full, or across the agent's desk facing them) and walking callers in the walk pose, turned the way they go. Characters keep three animations (`sit`, `idle`, `walk`), each baked once; sitting people are 0.65 scale, standing 0.95.
- Each pose is baked on a fresh copy of the character (`SkeletonUtils.clone` from three-stdlib, now a direct dependency): `idle` doesn't move the legs, so baked after `sit` on the same skeleton the receptionists sat (found in review). `tests/models.test.ts` guards it.
- Walking callers follow the lines (after review: they cut diagonally through walls and ignored the curved lines): `walkInRoute` in `src/walk.ts` goes in through their way in, to their counter, through it, to the line of one of the workstream's rules (or its default queue) that ends at the room, along it (up over the curved line to another center), in at the door and to a seat. Drawn as straight segments, not a smooth curve; a steady 6 m/s, so a long way takes longer, and walkers keep walking across live refreshes until they're there.
- Callers talking to an agent used to stand inside the desk; then across it; now (after review) they sit on a visitor's chair beside the desk, turned towards the agent. The chair is only there while someone sits on it.
- Zooming, rotating or dragging while the camera is still flying to something you clicked stops the flight, so it no longer takes the camera back (found in review; in the explorer's shared `CameraRig`, so both 3D tools have it).
- Walkers turn see-through (opacity 0.3, fading in and out) while they overlap furniture on their way: `obstacles(plan)` in `src/walk.ts` gives the floor rectangles of desks with their chairs, front desks with the receptionists, signposts, signs, kiosks, the digital channels' screen, overflow fixtures and lobby plants. Each walker has its own copies of the model's materials for it.
- Still simple shapes: doors, signposts, the bot kiosk, mailbox, phone booth, exit, remain-in-queue; the Furniture Kit and Mini Characters have nothing that fits.

## Guided tour (2026-10-25)

- After the user asked for a way to make a video: a tour that plays by itself on the sample data, captions on top, pause/back/next/end. Shared player in `environment-3d-explorer/src/tour.tsx` (`useTour`, `TourBar`, `plannedRide`, `tourAsked`); each tool's App has its own script of steps, each setting the scene when it starts (and undoing animations when it ends). The left panel shows only for steps about it.
- Starts from **Play the tour** on the Help tab or `tour=1`; on live data it switches to the sample and back. Following a call is planned up front (`plannedRide`), so it plays without stopping at forks. Each tool puts its state back when the tour ends (the 3D Contact Center's tour grouping is never saved).
- `tests/tour.test.ts` (explorer): every record the scripts name is in the sample, and the planned ride reaches the agent.
- After review: a step no longer starts over during live activity (the step clock belongs to its step; the page redraws every few seconds then), and a finished step can't end the next one too. While a tour plays the camera drifts: it slowly circles what it looks at, between flights (`drift` on `CameraRig`; the orbit controls' auto-rotate kept a flight from arriving). The **Play the tour** button has its own style (`.tour-start`).
- The early steps fly in close (after review: it felt like the same view): the new center at an angle, the front of the building, the door, the bot, a counter, a signpost, the phone wing, and over the rooms for live activity (`look`/`goClose` in the script).

## Next ideas

- Shared customer centers in Dataverse (needs a table in the solution; the store interface is ready).
- More recognisable 3D objects beyond the desks (see above), and fewer overlapping labels in a big center.
- Teams as zones.
