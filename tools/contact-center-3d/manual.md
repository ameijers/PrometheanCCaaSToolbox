# 3D Contact Center — User Manual

Part of the [Promethean CCaaS Toolbox](../../Readme.md). For what the tool shows and how, see the [README](README.md).

## 1. Opening the tool

Open **3D Contact Center** from the toolbox app's Site Map. The tool reads the environment and shows the campus from above: one building per customer center. The panel says which environment it's reading; **the sample environment** means it isn't running inside the app.

Nothing is changed in Dataverse. The tool only reads.

![The campus](images/00-campus.png)

## 2. Looking around

- **Orbit** (the default): drag to rotate, scroll to zoom, right-drag to pan.
- **Walk**: drag to look around; walk through the building with W A S D.
- **Campus** flies back to the view of all buildings. **Full screen** (or F) hides the app's menu; Esc goes back.
- Click a building's name to fly to it. Inside, the rooms, lobbies, signposts and signs get their names.

![A customer center from above](images/01-building.png)

## 3. Reading a building

A customer center has a **floor** for each kind of work it handles: **Phone** at the bottom, **Chat & messaging** above it, **Email & records** on top. The floor's name is on the left of the building. Use the **Floors** switch to see just one kind of floor, at ground level.

On each floor, from the front (the entrance) to the back:

1. **Entrance doors** (phone floor): one per voice channel. The blue sign above shows its phone numbers. Other floors have a screen at the entrance for their digital channels.
2. **Purple kiosk**: a workstream's bot, the automated reception.
3. **Front desk**: one per floor. Each **blue counter** on it is a workstream.
4. **Signposts** at the corridor: the routing rules. A pink line on the floor leads to the room each rule sends calls to.
5. **Rooms**: the queues. Chairs by the door are where callers wait. Each **desk** has the agent behind it.
6. **By a room's door**: its opening hours (dark sign) and its overflow: a red mailbox for voicemail, a glass phone booth for a callback, a green exit for ending the conversation, a purple door for a transfer to another queue.

A blue **skybridge** goes to a room in another customer center. A faint dashed yellow line goes to a workstream's default queue.

Click anything to see what it is, its details, and what it's linked to. Click a link to go there.

![A room with its desks, the signposts in front of it and the mailbox at its door](images/02-room.png)

## 4. Combining workstreams into customer centers

Open the **Customer centers** tab.

- **Combine**: tick two or more centers, type a name (for example "Contoso Service Center") and click **Combine**. Their lobbies move into one building, side by side, and rooms they share no longer need a skybridge.
- **Split**: gives every workstream of a combined center its own center again.
- **Move to…** (under a combined center's workstreams): moves one workstream to another center, or to a center of its own.
- **Rename**: click ✎, or double-click the name, type and press Enter.
- **Colour**: click the coloured square.
- **Eye**: hides a workstream (click again to show it). Workstreams linked to nothing (no channel or bot leads to them, and they route nowhere) start hidden. **Show all … hidden workstreams** brings them all back.
- **Start again** puts every workstream back in its own center.

Your centers are remembered in this browser, for this environment.

## 5. Finding problems

Open the **Health** tab and tick **Show problems**. Records with a problem get a red cone above them, warnings an amber one. The list shows them all; click one to fly there. The checks are the explorer's: see its [README](../environment-3d-explorer/README.md#health-overlay).

## 6. Opening from a link

Add `focus=<name>` to the page address to open on the customer center with that name, or on a record (a room, a desk) with that name. Add `floor=voice`, `floor=messaging` or `floor=records` to open on one kind of floor. In a Site Map subarea, put it in the web resource's **data** parameter.
