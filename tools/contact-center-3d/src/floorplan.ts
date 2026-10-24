// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Graph, GraphEdge, GraphNode, Stream } from "../../environment-3d-explorer/src/model";
import { Grouping } from "./centers";

// The floor plan: every customer center becomes a building on a campus, laid out from front to back
// the way a conversation goes through it:
//
//   entrance  - a door per voice channel with its phone numbers above it, and a screen for the
//               digital channels when the center has any
//   reception - one front desk for the whole center, a counter on it per workstream; bots as kiosks in front
//   corridor  - a signpost per routing rule; paths lead from each sign along the corridor, then down the
//               aisle beside the room and along the walkway in front of its row to its door
//   wings     - one per kind of work (phone, chat & messaging, email & records), side by side, each with
//               its rooms in a grid: desks with an agent behind each, a bench to wait on inside the door,
//               opening hours on a sign, overflow (mailbox, phone booth, exit) outside the front door, and a
//               door in the back wall for each overflow transfer to another queue
//
// A queue's room is in the wing of its type, in the center that routes to it most; other centers reach
// it over a skybridge. An agent has a desk in the room of every queue they're in. Queues no shown workstream routes to
// get a building of their own, unless only hidden workstreams route to them. Units are roughly metres.
// Pure and deterministic.

export type Vec3 = [number, number, number];
export type Wing = Stream;

export const WING_ORDER: Wing[] = ["voice", "messaging", "records"];
export const WING_LABELS: Record<Wing, string> = { voice: "Phone", messaging: "Chat & messaging", records: "Email & records" };
export const WING_COLORS: Record<Wing, string> = { voice: "#0ea5e9", messaging: "#10b981", records: "#f59e0b" };

export type AreaKind = "building" | "entrance" | "lobby" | "corridor" | "wing" | "room";
export interface Area { kind: AreaKind; key?: string; centerId: string; wing?: Wing; x: number; y: number; z: number; w: number; d: number; name?: string; color: string }

// A wall piece, centred on (x, z), standing on the floor.
export interface Wall { x: number; y: number; z: number; w: number; d: number; h: number; wing?: Wing }

export type FixtureKind = "door" | "portal" | "numbers" | "reception" | "counter" | "kiosk" | "signpost" | "desk" | "bench" | "hours" | "mailbox" | "booth" | "exit" | "transfer" | "hold";
export interface Fixture {
  kind: FixtureKind; key?: string; x: number; y: number; z: number; w?: number; label?: string; wing?: Wing;
  // A desk's skills and business unit; a counter's context variables.
  skills?: string[]; unit?: string; variables?: string[];
}

export type PathKind = "route" | "default" | "transfer" | "skybridge";
export interface Path { kind: PathKind; points: Vec3[]; key?: string; wing?: Wing }

export interface WingBox { kind: Wing; x: number; w: number }
export interface Building { centerId: string; name: string; color: string; x: number; z: number; w: number; d: number; wings: WingBox[] }

export interface Plan {
  buildings: Building[];
  areas: Area[];
  walls: Wall[];
  fixtures: Fixture[];
  paths: Path[];
  // Where each record is, to fly to it and mark it. Centers are "center:<id>".
  anchors: Map<string, Vec3>;
  // Each agent's desk per room: "<queue key>|<agent key>".
  desks: Map<string, Vec3>;
  // The seats on each room's waiting bench (queue key), and the way in per workstream: for live callers.
  chairs: Map<string, Vec3[]>;
  // Each room's front door (queue key), on the floor.
  doors: Map<string, Vec3>;
  entrances: Map<string, Vec3>;
  bounds: { x: number; z: number; w: number; d: number; h: number };
}

export const UNROUTED_CENTER = "unrouted";
const UNROUTED_COLOR = "#64748b";

// Layout sizes.
const DESK = 3.2;
const ROOM_MIN_W = 10;
const WAITING = 4;
const COUNTER_W = 3.2;
const RULE_GAP = 3.6;
const ENTRANCE_D = 4, LOBBY_D = 10, CORRIDOR_D = 7;
const WING_SIGN = 3;
const ROOMS_FROM = ENTRANCE_D + LOBBY_D + CORRIDOR_D + WING_SIGN;
const ROOM_GAP = 3;
const WING_GAP = 4;
const DOOR_W = 2.4;
const BENCH_W = 3.2;
export const WALL_H = 3.5, ROOM_WALL_H = 2.6, PARTITION_H = 1.6;
const CAMPUS_GAP = 18;
// Paths run this high above the floor, clear of the floor tiles, so they're never hidden in them.
export const PATH_Y = 0.5;
const MIN_W = 24;

const OVERFLOW_FIXTURES: Record<string, FixtureKind> = {
  "Voicemail": "mailbox", "Direct callback": "booth", "Scheduled callback": "booth", "Transfer to phone": "booth",
  "End conversation": "exit", "Queue transfer": "transfer", "Remain in queue": "hold"
};

// colW: the width of the room's column (its widest room); row: 0 for the row facing the corridor.
interface Room { key: string; name: string; desks: string[]; w: number; d: number; x: number; dz: number; colW: number; row: number }
interface WingLayout { kind: Wing; rooms: Room[]; w: number; d: number }

export interface PlanOptions {
  // The "Not routed" building with the queues no shown workstream routes to (the page hides it at first).
  unrouted?: boolean;
}

export function buildPlan(graph: Graph, grouping: Grouping, options: PlanOptions = {}): Plan {
  const showUnrouted = options.unrouted ?? true;
  const nodeByKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const out = (key: string, kind?: GraphEdge["kind"]) => graph.edges.filter((e) => e.from === key && (!kind || e.kind === kind));
  const into = (key: string, kind?: GraphEdge["kind"]) => graph.edges.filter((e) => e.to === key && (!kind || e.kind === kind));
  const order = (n: GraphNode) => Number(n.details.find(([l]) => l === "Order")?.[1] ?? 0);
  const hidden = new Set((grouping.hidden ?? []).map((id) => `workstream:${id}`));
  const rulesOf = (wsKey: string) => out(wsKey, "routes").map((e) => nodeByKey.get(e.to)!).filter(Boolean).sort((a, b) => order(a) - order(b));
  const streamOf = (key: string): Wing => nodeByKey.get(key)?.facts?.stream ?? "messaging";

  // Shown workstreams per center.
  const centerOfWorkstream = new Map<string, string>();
  grouping.centers.forEach((c) => c.workstreams.forEach((id) => { const k = `workstream:${id}`; if (nodeByKey.has(k) && !hidden.has(k)) centerOfWorkstream.set(k, c.id); }));

  // Queue rooms go where most routes to them come from; queues only hidden workstreams reach aren't drawn.
  const votes = new Map<string, Map<string, number>>();
  const reachedByHidden = new Set<string>();
  const routedQueues = (wsKey: string) => [...rulesOf(wsKey).flatMap((rule) => out(rule.key, "routes").map((e) => e.to)), ...out(wsKey, "default").map((e) => e.to)];
  graph.nodes.filter((n) => n.kind === "workstream").forEach((ws) => {
    const centerId = centerOfWorkstream.get(ws.key);
    routedQueues(ws.key).forEach((queueKey) => {
      if (!centerId) { reachedByHidden.add(queueKey); return; }
      const v = votes.get(queueKey) ?? new Map<string, number>();
      v.set(centerId, (v.get(centerId) ?? 0) + 1);
      votes.set(queueKey, v);
    });
  });
  const centerIndex = new Map(grouping.centers.map((c, i) => [c.id, i]));
  const ownerOf = new Map<string, string>();
  votes.forEach((v, queueKey) => ownerOf.set(queueKey, [...v.entries()].sort((a, b) => b[1] - a[1] || (centerIndex.get(a[0]) ?? 0) - (centerIndex.get(b[0]) ?? 0))[0][0]));
  const queues = graph.nodes.filter((n) => n.kind === "queue").sort((a, b) => a.name.localeCompare(b.name));
  // A queue only reached by another queue's overflow transfer sits with that queue.
  for (let pass = 0; pass < 3; pass++) {
    queues.forEach((q) => {
      if (ownerOf.has(q.key)) return;
      const from = into(q.key, "transfer").map((e) => into(e.from, "overflow")[0]?.from).find((k) => k && ownerOf.has(k));
      if (from) ownerOf.set(q.key, ownerOf.get(from)!);
    });
  }
  queues.forEach((q) => { if (!ownerOf.has(q.key) && !reachedByHidden.has(q.key)) ownerOf.set(q.key, UNROUTED_CENTER); });
  const wingOfQueue = (q: GraphNode): Wing => q.facts?.stream ?? (into(q.key).map((e) => e.from).filter((k) => centerOfWorkstream.has(k)).map(streamOf)[0] ?? "voice");


  const centers = grouping.centers.map((c) => ({ id: c.id, name: c.name, color: c.color, workstreams: c.workstreams.map((id) => `workstream:${id}`).filter((k) => centerOfWorkstream.has(k)) }));
  if (showUnrouted && [...ownerOf.values()].includes(UNROUTED_CENTER)) centers.push({ id: UNROUTED_CENTER, name: "Not routed", color: UNROUTED_COLOR, workstreams: [] });

  // Every building sized: its reception, its signposts, its wings side by side.
  const layouts = centers.map((c) => {
    const doors = c.workstreams.filter((k) => streamOf(k) === "voice").flatMap((k) => [...into(k, "channel"), ...into(k, "handoff").flatMap((b) => into(b.from, "bot"))].map((e) => e.from));
    const digital = c.workstreams.filter((k) => streamOf(k) !== "voice");
    const rules = c.workstreams.flatMap((k) => rulesOf(k));
    const wings: WingLayout[] = WING_ORDER.map((kind) => {
      const rooms = queues.filter((q) => ownerOf.get(q.key) === c.id && wingOfQueue(q) === kind).map((q): Room => {
        // A desk for every member: an agent in several queues sits in each of their rooms.
        const desks = out(q.key, "member").map((e) => e.to).filter((a) => nodeByKey.has(a));
        const cols = Math.max(2, Math.ceil(Math.sqrt(desks.length)));
        const rows = Math.max(1, Math.ceil(desks.length / cols));
        return { key: q.key, name: q.name, desks, w: Math.max(ROOM_MIN_W, cols * DESK + 3), d: rows * DESK + WAITING + 2, x: 0, dz: 0, colW: 0, row: 0 };
      });
      // Rooms in a grid about as wide as it's deep (4 rooms are 2 x 2, 9 are 3 x 3), in columns as wide
      // as their widest room, so the aisles between the columns run straight from front to back.
      const cols = Math.max(1, Math.ceil(Math.sqrt(rooms.length)));
      const colWidths = Array.from({ length: cols }, (_, c) => Math.max(0, ...rooms.filter((_, i) => i % cols === c).map((room) => room.w)));
      const colX = colWidths.map((_, c) => 2 + colWidths.slice(0, c).reduce((s, cw) => s + cw + ROOM_GAP, 0));
      let dz = ROOMS_FROM;
      for (let r = 0; r < rooms.length; r += cols) {
        const row = rooms.slice(r, r + cols);
        row.forEach((room, c) => { room.x = colX[c]; room.dz = dz; room.colW = colWidths[c]; room.row = r / cols; });
        dz += Math.max(...row.map((room) => room.d)) + ROOM_GAP;
      }
      const w = colX[cols - 1] + colWidths[cols - 1] + 2;
      return { kind, rooms, w, d: dz - ROOM_GAP };
    }).filter((wing) => wing.rooms.length);
    const wingsWidth = wings.reduce((s, wing) => s + wing.w, 0) + WING_GAP * Math.max(0, wings.length - 1);
    const counters = c.workstreams.length;
    const width = Math.max(MIN_W, wingsWidth + 4, rules.length * RULE_GAP + 4, doors.length * 4 + (digital.length ? 10 : 4), counters * COUNTER_W + 10);
    const depth = Math.max(ROOMS_FROM, ...wings.map((wing) => wing.d)) + 2;
    return { center: c, doors, digital, rules, wings, wingsWidth, width, depth };
  }).filter((l) => l.center.workstreams.length || l.wings.length);

  const plan: Plan = { buildings: [], areas: [], walls: [], fixtures: [], paths: [], anchors: new Map(), desks: new Map(), chairs: new Map(), doors: new Map(), entrances: new Map(), bounds: { x: 0, z: 0, w: 0, d: 0, h: 0 } };
  // A room's door, and the ways to it: the aisles left and right of its column, and the walkway in
  // front of its row (a room in the front row faces the corridor itself).
  const doorOf = new Map<string, { at: Vec3; building: string; wing: Wing; aisles: number[]; walkZ: number; corridorZ: number; frontRow: boolean }>();
  const pending: { kind: PathKind; from: Vec3; building: string; to: string; key?: string; corridor?: number; fromRoom?: string; behindZ?: number }[] = [];

  // The campus: buildings in rows, front facing the viewer (+z).
  const rowLimit = Math.max(120, Math.sqrt(layouts.reduce((s, l) => s + l.width * l.depth, 0)) * 1.6);
  let cx = 0, cz = 0, rowDepth = 0;
  layouts.forEach(({ center, doors, digital, rules, wings, wingsWidth, width, depth }) => {
    if (cx + width > rowLimit && cx > 0) { cx = 0; cz -= rowDepth + CAMPUS_GAP; rowDepth = 0; }
    const x0 = cx, z0 = cz, y = 0;
    cx += width + CAMPUS_GAP;
    rowDepth = Math.max(rowDepth, depth);
    const wz = (d: number) => z0 - d;
    const mid = x0 + width / 2;
    const area = (kind: AreaKind, x: number, z: number, w: number, d: number, key?: string, name?: string, wing?: Wing) =>
      plan.areas.push({ kind, key, centerId: center.id, wing, x, y, z, w, d, name, color: center.color });
    const fixture = (f: Omit<Fixture, "y">) => plan.fixtures.push({ ...f, y });

    // The wings, side by side behind the corridor, centred.
    let wx = x0 + 2 + (width - 4 - wingsWidth) / 2;
    const boxes: WingBox[] = wings.map((wing) => { const box = { kind: wing.kind, x: wx, w: wing.w }; wx += wing.w + WING_GAP; return box; });
    plan.buildings.push({ centerId: center.id, name: center.name, color: center.color, x: x0, z: z0, w: width, d: depth, wings: boxes });
    plan.anchors.set(`center:${center.id}`, [mid, 0, wz(depth / 2)]);
    area("building", mid, wz(depth / 2), width, depth, `center:${center.id}`, center.name);
    area("entrance", mid, wz(ENTRANCE_D / 2), width - 4, ENTRANCE_D);
    area("corridor", mid, wz(ENTRANCE_D + LOBBY_D + CORRIDOR_D / 2), width, CORRIDOR_D);

    // The way in: a door per voice channel with its numbers; a screen for the digital channels.
    const doorXs = doors.map((_, j) => x0 + 2 + ((width - (digital.length ? 12 : 4)) * (j + 1)) / (doors.length + 1));
    doors.forEach((channelKey, j) => {
      const dx = doorXs[j];
      fixture({ kind: "door", key: channelKey, x: dx, z: wz(0), label: nodeByKey.get(channelKey)?.name });
      plan.anchors.set(channelKey, [dx, 1.2, wz(0.5)]);
      const numbers = into(channelKey, "number").map((e) => nodeByKey.get(e.from)!).filter(Boolean);
      if (numbers.length) {
        fixture({ kind: "numbers", key: numbers[0].key, x: dx, z: wz(0), label: numbers.map((n) => n.name).join(" · ") });
        numbers.forEach((n) => plan.anchors.set(n.key, [dx, 4, wz(0)]));
      }
    });
    if (digital.length) fixture({ kind: "portal", x: x0 + width - 6, z: wz(0.6), label: digital.map((k) => nodeByKey.get(k)?.name).join(" · ") });

    // One front desk, a counter on it per workstream, the bots in front.
    if (center.workstreams.length) {
      const deskW = Math.max(6, center.workstreams.length * COUNTER_W + 2);
      const deskZ = wz(ENTRANCE_D + 6);
      area("lobby", mid, wz(ENTRANCE_D + LOBBY_D / 2), width - 4, LOBBY_D, undefined, "Reception");
      fixture({ kind: "reception", x: mid, z: deskZ, label: center.name, w: deskW });
      center.workstreams.forEach((k, i) => {
        const counterX = mid - deskW / 2 + 1 + COUNTER_W / 2 + i * COUNTER_W;
        const variables = out(k, "variable").map((e) => nodeByKey.get(e.to)?.name).filter((v): v is string => !!v);
        fixture({ kind: "counter", key: k, x: counterX, z: deskZ, label: nodeByKey.get(k)?.name, w: COUNTER_W - 0.3, variables });
        plan.anchors.set(k, [counterX, 1, deskZ]);
        // Callers come in through the workstream's first door, or the digital screen.
        const way = streamOf(k) === "voice" ? doors.find((d) => into(k, "channel").some((e) => e.from === d) || into(k, "handoff").some((b) => into(b.from, "bot").some((e) => e.from === d))) : undefined;
        plan.entrances.set(k, way ? [doorXs[doors.indexOf(way)], 0, wz(-1)] : [x0 + width - 6, 0, wz(-1)]);
        out(k, "default").forEach((e) => pending.push({ kind: "default", from: [counterX, PATH_Y, deskZ - 1], building: center.id, to: e.to, key: k, corridor: wz(ENTRANCE_D + LOBBY_D + CORRIDOR_D / 2 + 1) }));
      });
      const bots = center.workstreams.flatMap((k) => into(k, "handoff").map((e) => e.from));
      bots.forEach((bot, i) => {
        const bx = mid + (i - (bots.length - 1) / 2) * 4;
        fixture({ kind: "kiosk", key: bot, x: bx, z: wz(ENTRANCE_D + 2.2), label: nodeByKey.get(bot)?.name });
        plan.anchors.set(bot, [bx, 1.2, wz(ENTRANCE_D + 2.2)]);
      });
    }

    // A signpost per rule at the corridor, a path to its room.
    const signZ = ENTRANCE_D + LOBBY_D + 1.5;
    rules.forEach((rule, k) => {
      const sx = x0 + 2 + ((width - 4) * (k + 1)) / (rules.length + 1);
      fixture({ kind: "signpost", key: rule.key, x: sx, z: wz(signZ), label: rule.name });
      plan.anchors.set(rule.key, [sx, 1.8, wz(signZ)]);
      out(rule.key, "routes").forEach((e) => pending.push({ kind: "route", from: [sx, PATH_Y, wz(signZ)], building: center.id, to: e.to, key: rule.key, corridor: wz(ENTRANCE_D + LOBBY_D + CORRIDOR_D / 2) }));
    });

    // The wings and their rooms.
    wings.forEach((wing, i) => {
      const box = boxes[i];
      const wingFront = ROOMS_FROM - WING_SIGN + 0.5;
      area("wing", box.x + box.w / 2, wz((wingFront + depth - 1) / 2), box.w, depth - 1 - wingFront, undefined, `${WING_LABELS[wing.kind]} wing`, wing.kind);
      if (i > 0) plan.walls.push({ x: box.x - WING_GAP / 2, y, z: wz((wingFront + depth) / 2), w: 0.2, d: depth - wingFront, h: PARTITION_H, wing: wing.kind });
      wing.rooms.forEach((r) => {
        const rx = box.x + r.x - 2, front = r.dz, doorX = rx + r.w / 2;
        area("room", rx + r.w / 2, wz(front + r.d / 2), r.w, r.d, r.key, r.name, wing.kind);
        plan.anchors.set(r.key, [rx + r.w / 2, 0, wz(front + r.d / 2)]);
        doorOf.set(r.key, { at: [doorX, PATH_Y, wz(front)], building: center.id, wing: wing.kind, aisles: [rx - ROOM_GAP / 2, rx + r.colW + ROOM_GAP / 2], walkZ: wz(front - ROOM_GAP / 2), corridorZ: wz(ENTRANCE_D + LOBBY_D + CORRIDOR_D / 2), frontRow: r.row === 0 });
        // An overflow transfer is a way through to another queue: a door in the back wall, opposite the entrance.
        const transfers = out(r.key, "overflow").filter((e) => OVERFLOW_FIXTURES[nodeByKey.get(e.to)?.name ?? ""] === "transfer");
        const backDoors = transfers.map((_, i) => rx + (r.w * (i + 1)) / (transfers.length + 1));
        plan.walls.push(...wallAlongX(rx, rx + r.w, wz(front), ROOM_WALL_H, [doorX], wing.kind), ...wallAlongX(rx, rx + r.w, wz(front + r.d), ROOM_WALL_H, backDoors, wing.kind));
        plan.walls.push({ x: rx, y, z: wz(front + r.d / 2), w: 0.2, d: r.d, h: ROOM_WALL_H, wing: wing.kind }, { x: rx + r.w, y, z: wz(front + r.d / 2), w: 0.2, d: r.d, h: ROOM_WALL_H, wing: wing.kind });

        // A waiting bench inside the door, beside it, its back against the front wall: four seats facing into the room.
        const benchX = doorX - DOOR_W / 2 - 0.5 - BENCH_W / 2, benchZ = wz(front + 0.55);
        fixture({ kind: "bench", key: r.key, x: benchX, z: benchZ, w: BENCH_W, wing: wing.kind });
        plan.chairs.set(r.key, [-1.2, -0.4, 0.4, 1.2].map((off): Vec3 => [benchX + off, 0, benchZ]));
        plan.doors.set(r.key, [doorX, 0, wz(front)]);
        const cols = Math.max(2, Math.ceil(Math.sqrt(r.desks.length)));
        r.desks.forEach((agentKey, n) => {
          const dx = rx + 1.5 + DESK / 2 + (n % cols) * DESK + (r.w - 3 - cols * DESK) / 2;
          const dz = front + WAITING + 1 + DESK / 2 + Math.floor(n / cols) * DESK;
          const skills = out(agentKey, "skill").map((e) => nodeByKey.get(e.to)?.name).filter((s): s is string => !!s);
          const unit = out(agentKey, "businessunit")[0]?.to;
          fixture({ kind: "desk", key: agentKey, x: dx, z: wz(dz), label: nodeByKey.get(agentKey)?.name, wing: wing.kind, skills, unit });
          plan.desks.set(`${r.key}|${agentKey}`, [dx, 1.4, wz(dz + 0.6)]);
          // The agent's own spot (to fly to them) is their first desk.
          if (!plan.anchors.has(agentKey)) plan.anchors.set(agentKey, [dx, 1.4, wz(dz + 0.6)]);
        });

        into(r.key, "hours").forEach((e) => {
          fixture({ kind: "hours", key: e.from, x: doorX + DOOR_W / 2 + 0.9, z: wz(front - 0.1), label: nodeByKey.get(e.from)?.name, wing: wing.kind });
          if (!plan.anchors.has(e.from)) plan.anchors.set(e.from, [doorX + DOOR_W / 2 + 0.9, 2, wz(front)]);
        });
        out(r.key, "overflow").filter((e) => !transfers.includes(e)).forEach((e, k) => {
          const node = nodeByKey.get(e.to);
          const fx = doorX + (k % 2 === 0 ? -1 : 1) * (DOOR_W / 2 + 1.2 + Math.floor(k / 2) * 1.6);
          fixture({ kind: OVERFLOW_FIXTURES[node?.name ?? ""] ?? "hold", key: e.to, x: fx, z: wz(front - 1.2), label: node?.name, wing: wing.kind });
          plan.anchors.set(e.to, [fx, 1.2, wz(front - 1.2)]);
        });
        transfers.forEach((e, i) => {
          const bx = backDoors[i], back = front + r.d;
          fixture({ kind: "transfer", key: e.to, x: bx, z: wz(back), label: nodeByKey.get(e.to)?.name, wing: wing.kind });
          plan.anchors.set(e.to, [bx, 1.2, wz(back)]);
          // Out through the back door, then along the walkway behind the room.
          out(e.to, "transfer").forEach((t) => pending.push({ kind: "transfer", from: [bx, PATH_Y, wz(back + 0.6)], building: center.id, to: t.to, key: e.to, fromRoom: r.key, behindZ: wz(back + ROOM_GAP / 2) }));
        });
      });
    });

    // The outer walls, the doors open.
    plan.walls.push(...wallAlongX(x0, x0 + width, wz(0), WALL_H, doorXs), ...wallAlongX(x0, x0 + width, wz(depth), WALL_H, []));
    plan.walls.push({ x: x0, y, z: wz(depth / 2), w: 0.25, d: depth, h: WALL_H }, { x: x0 + width, y, z: wz(depth / 2), w: 0.25, d: depth, h: WALL_H });
  });

  // Paths to the rooms. In the same building they keep to the walkways, in straight lines at right
  // angles, and take the shortest way: along the corridor and straight in at a front-row room's door;
  // to a room further back, down the nearer aisle beside it and along the walkway in front of its row.
  // An overflow transfer leaves through its room's back door, along the walkway behind it to the nearer
  // aisle. To another building: over a skybridge.
  const y = PATH_Y;
  type Door = NonNullable<ReturnType<typeof doorOf.get>>;
  const length = (points: Vec3[]) => points.reduce((s, q, i) => (i ? s + Math.abs(q[0] - points[i - 1][0]) + Math.abs(q[2] - points[i - 1][2]) : 0), 0);
  const shortest = (options: Vec3[][]) => options.reduce((best, o) => (length(o) < length(best) ? o : best));
  const inTo = (door: Door, corridor: number): Vec3[][] => door.frontRow
    ? [[[door.at[0], y, corridor], door.at]]
    : door.aisles.map((ax): Vec3[] => [[ax, y, corridor], [ax, y, door.walkZ], [door.at[0], y, door.walkZ], door.at]);
  const withoutRepeats = (points: Vec3[]) => points.filter((q, i) => i === 0 || Math.hypot(q[0] - points[i - 1][0], q[2] - points[i - 1][2]) > 0.01);
  pending.forEach((p) => {
    const door = doorOf.get(p.to);
    if (!door) return;
    if (door.building === p.building) {
      const source = p.fromRoom ? doorOf.get(p.fromRoom) : undefined;
      const corridor = p.corridor ?? door.corridorZ;
      const behind = p.behindZ ?? source?.walkZ;
      const outs: Vec3[][] = source && behind !== undefined
        ? source.aisles.map((ax): Vec3[] => [p.from, [p.from[0], y, behind], [ax, y, behind], [ax, y, corridor]])
        : [[p.from, [p.from[0], y, corridor]]];
      const options = outs.flatMap((o) => inTo(door, corridor).map((i) => [...o, ...i]));
      plan.paths.push({ kind: p.kind, key: p.key, wing: door.wing, points: withoutRepeats(shortest(options)) });
      return;
    }
    const points: Vec3[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      points.push([p.from[0] + (door.at[0] - p.from[0]) * t, PATH_Y + Math.sin(Math.PI * t) * 9, p.from[2] + (door.at[2] - p.from[2]) * t]);
    }
    plan.paths.push({ kind: p.kind === "route" ? "skybridge" : p.kind, key: p.key, wing: door.wing, points });
  });

  const minX = Math.min(0, ...plan.buildings.map((b) => b.x)), maxX = Math.max(0, ...plan.buildings.map((b) => b.x + b.w));
  const maxZ = Math.max(0, ...plan.buildings.map((b) => b.z)), minZ = Math.min(0, ...plan.buildings.map((b) => b.z - b.d));
  plan.bounds = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ, h: 0 };
  return plan;
}

// A wall along x at depth z, from x0 to x1, with door-wide gaps at the given x positions.
function wallAlongX(x0: number, x1: number, z: number, h: number, doors: number[], wing?: Wing): Wall[] {
  const gaps = doors.map((d) => [d - DOOR_W / 2, d + DOOR_W / 2]).sort((a, b) => a[0] - b[0]);
  const walls: Wall[] = [];
  let from = x0;
  gaps.forEach(([g0, g1]) => {
    if (g0 > from) walls.push({ x: (from + g0) / 2, y: 0, z, w: g0 - from, d: 0.2, h, wing });
    from = Math.max(from, g1);
  });
  if (x1 > from) walls.push({ x: (from + x1) / 2, y: 0, z, w: x1 - from, d: 0.2, h, wing });
  return walls;
}
