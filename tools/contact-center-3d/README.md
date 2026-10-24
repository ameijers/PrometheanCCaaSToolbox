# 3D Contact Center

The same environment as the [Environment 3D Explorer](../environment-3d-explorer/README.md), shown from a business perspective: each customer center is a building on a campus, open at the top so you look inside from above. Read-only. Step by step: the [manual](manual.md).

![The campus](images/00-campus.png)

## What you see

| In the building | CCaaS record |
| --- | --- |
| Building | a customer center: one or more workstreams |
| Floor | the kind of work: **Phone** (voice), **Chat & messaging**, **Email & records**. A center gets a floor for each kind it has, stacked. |
| Entrance door, with the phone numbers on a sign above it | voice channel and its phone numbers (phone floor) |
| Screen at the entrance | the digital channels of the floor's workstreams (other floors) |
| One front desk per floor, with a blue counter per workstream | workstream |
| Purple kiosk in front of the front desk | a workstream's bot (automated reception) |
| Signpost at the corridor, with a line on the floor to its room | routing rule |
| Room, with chairs to wait on by the door | queue |
| Desk with a person behind it | agent |
| Sign by the room's door | operating hours |
| Outside the room's door | overflow: a mailbox (voicemail), a phone booth (callback or transfer to phone), an exit (end conversation), a purple door (queue transfer, with a dashed line to the other room), an amber block (remain in queue) |
| Blue skybridge | a routing rule to a room in another customer center |
| Faint dashed yellow line | a workstream's default queue |
| "Not routed" building | queues no shown workstream routes to |

![Inside a customer center](images/02-room.png)

## Customer centers

Dataverse doesn't know which workstreams belong together, so every workstream starts as a customer center of its own. On the **Customer centers** tab you can:

- tick two or more centers and **Combine** them into one building, with a name of your choice;
- **Split** a combined center back into one per workstream;
- **Move** one workstream to another center, or to a center of its own;
- rename a center (✎, or double-click its name) and pick its colour (the swatch).

- hide a workstream with the eye (and show it again). **Workstreams linked to nothing start hidden**: no channel or bot leads to them and they route nowhere. A room that only hidden workstreams route to is hidden too.

Every change is remembered straight away, **in this browser, for this environment** (local storage). A shared store in Dataverse, so colleagues see the same centers, is planned: the page reads and saves through one small interface (`src/store.ts`), so it can be swapped in without changing the rest.

## Rules of the layout

- A workstream is on the floor of its channel; a queue's room is on the floor of its type (a voice queue on the phone floor). Floors are stacked with room to look in between; the **Floors** switch shows one kind at ground level.
- Rooms are laid out in a grid about as wide as it's deep: 4 rooms are 2 × 2, 9 are 3 × 3.
- A queue's room is in the center that routes to it most (ties: the first center in the list). Other centers, or another floor, reach it over a skybridge.
- A queue only reached by another queue's overflow transfer sits with that queue.
- An agent who is a member of several queues has **one** desk, in the first of those queues by name. The other rooms show "Desk in another room" in their details.
- Rooms grow with their desks; buildings grow with their lobbies and rooms. The same environment and grouping always give the same plan.

## Using it

The left panel keeps search, the camera buttons (**Orbit**, **Walk**, **Campus**, **Full screen**) and the **Floors** switch (All, Phone, Chat & messaging, Email & records) on top, with tabs below: **Customer centers**, **Health** (the explorer's checks, as warning cones over the records) and **Help**. Click a building's name to fly to it; click a room, desk, signpost, door or kiosk to see what it is. **Use sample data** (next to the environment name, or `demo=1` in the page address) shows the sample environment inside the app, to demonstrate or try the tool; it keeps its own saved customer centers. `focus=<name>` in the page address opens on a customer center (or a record) with that name, `floor=voice` (or `messaging`, `records`) on one floor. Labels inside a building grow as you come closer, so a big center isn't a heap of labels from afar.

## How it works

It reuses the explorer's code rather than copying it: the Dataverse reads and the graph (`environment-3d-explorer/src/dataverse.ts`, `graph.ts`), the health checks, the sample environment, the camera rig and full screen. What's new:

- `src/centers.ts`: the grouping (combine, split, move, rename, recolour, and matching a saved grouping to today's workstreams).
- `src/store.ts`: where the grouping is kept.
- `src/floorplan.ts`: the plan, from graph and grouping to buildings, areas, walls, fixtures, paths and anchors. Pure.
- `src/CampusScene.tsx`: draws it. Floors, walls, desks and people are instanced boxes, so large centers stay smooth.

Tables read: the same as the explorer. Written: nothing; `tests/floorplan.test.ts` includes the read-only check.

## Build, run, deploy

- Demo with sample data: `npm run demo:contactcenter3d` → http://localhost:5449/index.html
- Tests: `npx jest tools/contact-center-3d`
- Deploy: `pwsh ./scripts/deploy.ps1 -Tool contactcenter3d` (add `-CreateIfMissing` the first time in an environment).
- Web resources: `pct_/tools/contactcenter3d/{index.html,style.css,bundle.js}`. Add a Site Map subarea of type Web Resource pointing at `pct_/tools/contactcenter3d/index.html`.
