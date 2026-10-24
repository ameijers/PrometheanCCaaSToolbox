# 3D Contact Center — implementation status

## State (2026-10-24)

First version: the campus, a building per customer center, combine / split / move / rename / recolour (kept in the browser), and inside each building the entrance, bot kiosk, lobbies, signposts, rooms with desks, opening hours and overflow at the doors. Health overlay from the explorer.

- Checked on the sample environment in headless Edge (campus, a building, a room). Not yet tried hands-on or on live data.
- Not yet in a solution zip; needs a Site Map subarea (`pct_/tools/contactcenter3d/index.html`).

## Decisions

- **A separate tool on the explorer's code**: it imports the explorer's data layer, graph, health checks, sample data, camera rig and full screen (the explorer exports `CameraRig` and `useFullscreen` for it), so both tools always show the same facts.
- **Customer centers are the viewer's grouping**, since Dataverse has none. Every workstream starts as its own center. Saved grouping is matched to today's environment: missing workstreams drop out, new ones get a center of their own.
- **Kept in the browser for now** (local storage, per environment), behind `CenterStore` in `src/store.ts`. A shared Dataverse table (for example `pct_contactcenter`: name, colour, workstream ids) is the intended next step; it would make this a writing tool with a write-scope test for that one table, and needs the table to be created in the solution first.
- **A shared queue's room** goes to the center with the most routes to it; others get a skybridge. **An agent has one desk**, in their first queue by name; other rooms count members who sit elsewhere. Queues no workstream routes to get a "Not routed" building.
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
- **Live activity** from the explorer's `live.ts`: waiting callers on the room's chairs (then a line at the door), callers with an agent at the desk, new callers walking in from the workstream's way in, desk screens in the presence colour, "n waiting" on the room.
- **Follow a call** with the explorer's `ride.ts` and camera rig; the rig now takes a `rideScale` (0.3 here, so it rides close behind the call inside a building).
- **Skills** as badges on the desk (and listed with their rating in the details), **business units** as carpet (switch on the Explore tab), **context variables** as a clipboard on the counter.

## Lines (2026-10-24)

- The white edge under the lines is gone; lines run 0.5 m above the floor instead, so floor tiles can't hide them. Widths halved after review (they're screen pixels, doubled on high-DPI displays).
- Lines keep to the walkways: rooms are in straight columns (each as wide as its widest room), and a line goes along the corridor, down the aisle left of its room, along the walkway in front of the row, in at the door. A test walks every line and checks it never enters a room.
- A queue transfer is a **door in the back wall** of its room (after review: outside the front it read as something to walk past); its line leaves through that door and along the walkway behind the room. The other overflow stays outside the front door. Waiting chairs have a seat and back, on a mat, so they read as chairs.
- Lines take the **shortest** walkway route (after review: always using the left aisle made detours): a front-row room straight from the corridor, a room further back over the nearer of its two aisles (the right one measured from its column's edge, so a wider room in another row can't block it), a transfer out of the nearer aisle behind its room. Tests check every segment runs along x or z.
- A **Lines** legend explains the four styles, from the same list the scene draws with.

## Next ideas

- Shared customer centers in Dataverse (needs a table in the solution; the store interface is ready).
- More recognisable 3D objects (the user wants to come back to this), and fewer overlapping labels in a big center.
- Teams as zones.
