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

## Next ideas

- Live activity: callers as figures waiting on the chairs or standing at a desk, agents' desk lamps in their presence colour, new calls walking in through the door.
- Follow the call as a figure walking from the entrance through the lobby to a desk.
- Shared customer centers in Dataverse.
- Skills as badges, teams and business units as carpet zones, context variables on the reception's clipboard.
