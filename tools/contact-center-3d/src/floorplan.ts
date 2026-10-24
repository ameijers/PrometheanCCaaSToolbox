// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Graph, GraphEdge, GraphNode, Stream } from "../../environment-3d-explorer/src/model";
import { Grouping } from "./centers";

// The floor plan: every customer center becomes a building on a campus. A building has a floor per
// kind of work it handles (phone, chat & messaging, email & records), stacked with room to look in
// between. Each floor is laid out from front to back the way a conversation goes through it:
//
//   entrance  - a door per voice channel with its phone numbers above it (phone floor), or a sign for
//               the digital channels (other floors)
//   reception - one front desk for the whole floor, a counter on it per workstream; bots as kiosks in front
//   corridor  - a signpost per routing rule; paths on the floor lead from each sign to its room
//   rooms     - one per queue, in a grid: desks with an agent behind each, chairs to wait on by the door,
//               opening hours on a sign, overflow (mailbox, phone booth, exit, door through) outside
//
// A workstream is on the floor of its channel, a queue's room on the floor of its type. A queue's room
// is in the center that routes to it most; other centers (and other floors) reach it over a bridge.
// An agent in several queues has one desk. Queues no shown workstream routes to get a building of
// their own, unless only hidden workstreams route to them. Units are roughly metres. Pure.

export type Vec3 = [number, number, number];
export type FloorKind = Stream;

export const FLOOR_ORDER: FloorKind[] = ["voice", "messaging", "records"];
export const FLOOR_LABELS: Record<FloorKind, string> = { voice: "Phone", messaging: "Chat & messaging", records: "Email & records" };

export type AreaKind = "building" | "slab" | "entrance" | "lobby" | "corridor" | "room";
export interface Area { kind: AreaKind; key?: string; centerId: string; floor: FloorKind; x: number; y: number; z: number; w: number; d: number; name?: string; color: string }

// A wall piece, centred on (x, z), standing on its floor at height y.
export interface Wall { x: number; y: number; z: number; w: number; d: number; h: number }

export type FixtureKind = "door" | "portal" | "numbers" | "reception" | "counter" | "kiosk" | "signpost" | "desk" | "chair" | "hours" | "mailbox" | "booth" | "exit" | "transfer" | "hold";
export interface Fixture { kind: FixtureKind; key?: string; x: number; y: number; z: number; w?: number; label?: string }

export type PathKind = "route" | "default" | "transfer" | "skybridge";
export interface Path { kind: PathKind; points: Vec3[]; key?: string }

export interface Floor { kind: FloorKind; y: number }
export interface Building { centerId: string; name: string; color: string; x: number; z: number; w: number; d: number; floors: Floor[] }

export interface Plan {
  buildings: Building[];
  areas: Area[];
  walls: Wall[];
  fixtures: Fixture[];
  paths: Path[];
  // Where each record is, to fly to it and mark it. Centers are "center:<id>".
  anchors: Map<string, Vec3>;
  // Members of a queue who sit at a desk in another room.
  elsewhere: Map<string, number>;
  bounds: { x: number; z: number; w: number; d: number; h: number };
}

export interface PlanOptions {
  // Only this kind of floor, at ground level; every kind when left out.
  floor?: FloorKind;
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
const ROOMS_FROM = ENTRANCE_D + LOBBY_D + CORRIDOR_D + 1;
const ROOM_GAP = 3;
const DOOR_W = 2.4;
export const WALL_H = 3.5, ROOM_WALL_H = 2.6;
// Floors sit this far apart, so you can look in between them.
export const FLOOR_GAP = 16;
const CAMPUS_GAP = 18;
const MIN_W = 24;

const OVERFLOW_FIXTURES: Record<string, FixtureKind> = {
  "Voicemail": "mailbox", "Direct callback": "booth", "Scheduled callback": "booth", "Transfer to phone": "booth",
  "End conversation": "exit", "Queue transfer": "transfer", "Remain in queue": "hold"
};

interface Room { key: string; name: string; desks: string[]; w: number; d: number; x: number; dz: number }
interface FloorLayout { kind: FloorKind; workstreams: string[]; doors: (string | undefined)[]; bots: string[]; rules: GraphNode[]; rooms: Room[]; w: number; d: number }

export function buildPlan(graph: Graph, grouping: Grouping, options: PlanOptions = {}): Plan {
  const nodeByKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const out = (key: string, kind?: GraphEdge["kind"]) => graph.edges.filter((e) => e.from === key && (!kind || e.kind === kind));
  const into = (key: string, kind?: GraphEdge["kind"]) => graph.edges.filter((e) => e.to === key && (!kind || e.kind === kind));
  const order = (n: GraphNode) => Number(n.details.find(([l]) => l === "Order")?.[1] ?? 0);
  const hidden = new Set((grouping.hidden ?? []).map((id) => `workstream:${id}`));
  const rulesOf = (wsKey: string) => out(wsKey, "routes").map((e) => nodeByKey.get(e.to)!).filter(Boolean).sort((a, b) => order(a) - order(b));
  const floorOfWorkstream = (wsKey: string): FloorKind => nodeByKey.get(wsKey)?.facts?.stream ?? "messaging";

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
  const floorOfQueue = (q: GraphNode): FloorKind => q.facts?.stream ?? (into(q.key).map((e) => e.from).map((k) => centerOfWorkstream.has(k) ? floorOfWorkstream(k) : undefined).find(Boolean) ?? "voice");

  // One desk per agent: in the first of their queues (by name) that's drawn.
  const homeOf = new Map<string, string>();
  graph.nodes.filter((n) => n.kind === "agent").forEach((a) => {
    const home = into(a.key, "member").map((e) => nodeByKey.get(e.from)!).filter((q) => q && ownerOf.has(q.key)).sort((x, y) => x.name.localeCompare(y.name))[0];
    if (home) homeOf.set(a.key, home.key);
  });
  const elsewhere = new Map<string, number>();
  queues.forEach((q) => elsewhere.set(q.key, out(q.key, "member").filter((e) => homeOf.get(e.to) !== q.key).length));

  const centers = grouping.centers.map((c) => ({ id: c.id, name: c.name, color: c.color, workstreams: c.workstreams.map((id) => `workstream:${id}`).filter((k) => centerOfWorkstream.has(k)) }));
  if ([...ownerOf.values()].includes(UNROUTED_CENTER)) centers.push({ id: UNROUTED_CENTER, name: "Not routed", color: UNROUTED_COLOR, workstreams: [] });

  // Every building's floors, sized.
  const layouts = centers.map((c) => {
    const floors: FloorLayout[] = FLOOR_ORDER.filter((kind) => !options.floor || options.floor === kind).map((kind) => {
      const workstreams = c.workstreams.filter((k) => floorOfWorkstream(k) === kind);
      const doors = workstreams.flatMap((k) => [...into(k, "channel"), ...into(k, "handoff").flatMap((b) => into(b.from, "bot"))].map((e) => e.from));
      const bots = workstreams.flatMap((k) => into(k, "handoff").map((e) => e.from));
      const rules = workstreams.flatMap((k) => rulesOf(k));
      const rooms = queues.filter((q) => ownerOf.get(q.key) === c.id && floorOfQueue(q) === kind).map((q): Room => {
        const desks = out(q.key, "member").map((e) => e.to).filter((a) => homeOf.get(a) === q.key);
        const cols = Math.max(2, Math.ceil(Math.sqrt(desks.length)));
        const rows = Math.max(1, Math.ceil(desks.length / cols));
        return { key: q.key, name: q.name, desks, w: Math.max(ROOM_MIN_W, cols * DESK + 3), d: rows * DESK + WAITING + 2, x: 0, dz: 0 };
      });
      // Rooms in a grid that's about as wide as it's deep: 4 rooms are 2 x 2, 9 are 3 x 3.
      const cols = Math.max(1, Math.ceil(Math.sqrt(rooms.length)));
      let dz = ROOMS_FROM, width = 0;
      for (let r = 0; r < rooms.length; r += cols) {
        const row = rooms.slice(r, r + cols);
        let x = 2;
        row.forEach((room) => { room.x = x; room.dz = dz; x += room.w + ROOM_GAP; });
        width = Math.max(width, x - ROOM_GAP + 2);
        dz += Math.max(...row.map((room) => room.d)) + ROOM_GAP;
      }
      const w = Math.max(MIN_W, width, rules.length * RULE_GAP + 4, doors.length * 4 + 4, workstreams.length * COUNTER_W + 8);
      return { kind, workstreams, doors: kind === "voice" ? (doors.length ? doors : workstreams.length ? [undefined] : []) : [], bots, rules, rooms, w, d: (rooms.length ? dz - ROOM_GAP : ROOMS_FROM) + 2 };
    }).filter((f) => f.workstreams.length || f.rooms.length);
    return { center: c, floors, width: Math.max(MIN_W, ...floors.map((f) => f.w)), depth: Math.max(ROOMS_FROM + 2, ...floors.map((f) => f.d)) };
  }).filter((l) => l.floors.length);

  const plan: Plan = { buildings: [], areas: [], walls: [], fixtures: [], paths: [], anchors: new Map(), elsewhere, bounds: { x: 0, z: 0, w: 0, d: 0, h: 0 } };
  const doorOf = new Map<string, { at: Vec3; building: string; floor: FloorKind }>();
  const pending: { kind: PathKind; from: Vec3; building: string; floor: FloorKind; to: string; key?: string; corridor?: number }[] = [];

  // The campus: buildings in rows, front facing the viewer (+z).
  const rowLimit = Math.max(120, Math.sqrt(layouts.reduce((s, l) => s + l.width * l.depth, 0)) * 1.6);
  let cx = 0, cz = 0, rowDepth = 0;
  layouts.forEach(({ center, floors, width, depth }) => {
    if (cx + width > rowLimit && cx > 0) { cx = 0; cz -= rowDepth + CAMPUS_GAP; rowDepth = 0; }
    const x0 = cx, z0 = cz;
    cx += width + CAMPUS_GAP;
    rowDepth = Math.max(rowDepth, depth);
    const wz = (d: number) => z0 - d;
    const building: Building = { centerId: center.id, name: center.name, color: center.color, x: x0, z: z0, w: width, d: depth, floors: floors.map((f, i) => ({ kind: f.kind, y: i * FLOOR_GAP })) };
    plan.buildings.push(building);
    plan.anchors.set(`center:${center.id}`, [x0 + width / 2, 0, wz(depth / 2)]);

    floors.forEach((f, level) => {
      const y = level * FLOOR_GAP;
      const area = (kind: AreaKind, x: number, z: number, w: number, d: number, key?: string, name?: string) =>
        plan.areas.push({ kind, key, centerId: center.id, floor: f.kind, x, y, z, w, d, name, color: center.color });
      const fixture = (kind: FixtureKind, x: number, z: number, key?: string, label?: string, w?: number) => plan.fixtures.push({ kind, key, x, y, z, label, w });
      const mid = x0 + width / 2;

      area(level === 0 ? "building" : "slab", mid, wz(depth / 2), width, depth, `center:${center.id}`, `${FLOOR_LABELS[f.kind]}`);
      area("entrance", mid, wz(ENTRANCE_D / 2), width - 4, ENTRANCE_D);
      area("corridor", mid, wz(ENTRANCE_D + LOBBY_D + CORRIDOR_D / 2), width, CORRIDOR_D);

      // The way in: doors with phone numbers on the phone floor, a sign for the digital channels elsewhere.
      const doorXs = f.doors.map((_, j) => x0 + 2 + ((width - 4) * (j + 1)) / (f.doors.length + 1));
      f.doors.forEach((channelKey, j) => {
        const dx = doorXs[j];
        fixture("door", dx, wz(0), channelKey, channelKey ? nodeByKey.get(channelKey)?.name : "Entrance");
        if (!channelKey) return;
        plan.anchors.set(channelKey, [dx, y + 1.2, wz(0.5)]);
        const numbers = into(channelKey, "number").map((e) => nodeByKey.get(e.from)!).filter(Boolean);
        if (numbers.length) {
          fixture("numbers", dx, wz(0), numbers[0].key, numbers.map((n) => n.name).join(" · "));
          numbers.forEach((n) => plan.anchors.set(n.key, [dx, y + 4, wz(0)]));
        }
      });
      if (f.kind !== "voice" && f.workstreams.length) fixture("portal", mid, wz(0.6), undefined, f.workstreams.map((k) => nodeByKey.get(k)?.name).join(" · "));

      // One front desk for the floor, a counter on it per workstream, the bots in front.
      if (f.workstreams.length) {
        const deskW = Math.max(6, f.workstreams.length * COUNTER_W + 2);
        const deskZ = wz(ENTRANCE_D + 6);
        area("lobby", mid, wz(ENTRANCE_D + LOBBY_D / 2), width - 4, LOBBY_D, undefined, "Reception");
        fixture("reception", mid, deskZ, undefined, center.name, deskW);
        f.workstreams.forEach((k, i) => {
          const counterX = mid - deskW / 2 + 1 + COUNTER_W / 2 + i * COUNTER_W;
          fixture("counter", counterX, deskZ, k, nodeByKey.get(k)?.name, COUNTER_W - 0.3);
          plan.anchors.set(k, [counterX, y + 1, deskZ]);
          out(k, "default").forEach((e) => pending.push({ kind: "default", from: [counterX, y + 0.06, deskZ - 1], building: center.id, floor: f.kind, to: e.to, key: k, corridor: wz(ENTRANCE_D + LOBBY_D + CORRIDOR_D / 2 + 1) }));
        });
        f.bots.forEach((bot, i) => {
          const bx = mid + (i - (f.bots.length - 1) / 2) * 4;
          fixture("kiosk", bx, wz(ENTRANCE_D + 2.2), bot, nodeByKey.get(bot)?.name);
          plan.anchors.set(bot, [bx, y + 1.2, wz(ENTRANCE_D + 2.2)]);
        });
      }

      // A signpost per rule at the corridor, a path to its room.
      const signZ = ENTRANCE_D + LOBBY_D + 1.5;
      f.rules.forEach((rule, k) => {
        const sx = x0 + 2 + ((width - 4) * (k + 1)) / (f.rules.length + 1);
        fixture("signpost", sx, wz(signZ), rule.key, rule.name);
        plan.anchors.set(rule.key, [sx, y + 1.8, wz(signZ)]);
        out(rule.key, "routes").forEach((e) => pending.push({ kind: "route", from: [sx, y + 0.06, wz(signZ)], building: center.id, floor: f.kind, to: e.to, key: rule.key, corridor: wz(ENTRANCE_D + LOBBY_D + CORRIDOR_D / 2) }));
      });

      // Rooms.
      f.rooms.forEach((r) => {
        const rx = x0 + r.x, front = r.dz, doorX = rx + r.w / 2;
        area("room", rx + r.w / 2, wz(front + r.d / 2), r.w, r.d, r.key, r.name);
        plan.anchors.set(r.key, [rx + r.w / 2, y, wz(front + r.d / 2)]);
        doorOf.set(r.key, { at: [doorX, y + 0.06, wz(front)], building: center.id, floor: f.kind });
        plan.walls.push(...wallAlongX(rx, rx + r.w, y, wz(front), ROOM_WALL_H, [doorX]), ...wallAlongX(rx, rx + r.w, y, wz(front + r.d), ROOM_WALL_H, []));
        plan.walls.push({ x: rx, y, z: wz(front + r.d / 2), w: 0.2, d: r.d, h: ROOM_WALL_H }, { x: rx + r.w, y, z: wz(front + r.d / 2), w: 0.2, d: r.d, h: ROOM_WALL_H });

        [-3, -1.5, 1.5, 3].forEach((off) => fixture("chair", doorX + off, wz(front + 1.6)));
        const cols = Math.max(2, Math.ceil(Math.sqrt(r.desks.length)));
        r.desks.forEach((agentKey, n) => {
          const dx = rx + 1.5 + DESK / 2 + (n % cols) * DESK + (r.w - 3 - cols * DESK) / 2;
          const dz = front + WAITING + 1 + DESK / 2 + Math.floor(n / cols) * DESK;
          fixture("desk", dx, wz(dz), agentKey, nodeByKey.get(agentKey)?.name);
          plan.anchors.set(agentKey, [dx, y + 1.4, wz(dz + 0.6)]);
        });

        into(r.key, "hours").forEach((e) => {
          fixture("hours", doorX + DOOR_W / 2 + 0.9, wz(front - 0.1), e.from, nodeByKey.get(e.from)?.name);
          if (!plan.anchors.has(e.from)) plan.anchors.set(e.from, [doorX + DOOR_W / 2 + 0.9, y + 2, wz(front)]);
        });
        out(r.key, "overflow").forEach((e, k) => {
          const node = nodeByKey.get(e.to);
          const fx = doorX + (k % 2 === 0 ? -1 : 1) * (DOOR_W / 2 + 1.2 + Math.floor(k / 2) * 1.6);
          fixture(OVERFLOW_FIXTURES[node?.name ?? ""] ?? "hold", fx, wz(front - 1.2), e.to, node?.name);
          plan.anchors.set(e.to, [fx, y + 1.2, wz(front - 1.2)]);
          out(e.to, "transfer").forEach((t) => pending.push({ kind: "transfer", from: [fx, y + 0.06, wz(front - 1.2)], building: center.id, floor: f.kind, to: t.to, key: e.to }));
        });
      });

      // The floor's outer walls, the doors open on the phone floor.
      plan.walls.push(...wallAlongX(x0, x0 + width, y, wz(0), WALL_H, doorXs), ...wallAlongX(x0, x0 + width, y, wz(depth), WALL_H, []));
      plan.walls.push({ x: x0, y, z: wz(depth / 2), w: 0.25, d: depth, h: WALL_H }, { x: x0 + width, y, z: wz(depth / 2), w: 0.25, d: depth, h: WALL_H });
    });
  });

  // Paths to the rooms: along the corridor on the same floor, over a bridge to another floor or building.
  pending.forEach((p) => {
    const door = doorOf.get(p.to);
    if (!door) return;
    if (door.building === p.building && door.floor === p.floor) {
      const corridor = p.corridor ?? p.from[2];
      plan.paths.push({ kind: p.kind, key: p.key, points: [p.from, [p.from[0], p.from[1], corridor], [door.at[0], p.from[1], corridor], door.at] });
      return;
    }
    const points: Vec3[] = [];
    const lift = Math.max(p.from[1], door.at[1]) + 9;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const base = p.from[1] + (door.at[1] - p.from[1]) * t;
      points.push([p.from[0] + (door.at[0] - p.from[0]) * t, base + Math.sin(Math.PI * t) * (lift - Math.max(p.from[1], door.at[1])), p.from[2] + (door.at[2] - p.from[2]) * t]);
    }
    plan.paths.push({ kind: p.kind === "route" ? "skybridge" : p.kind, key: p.key, points });
  });

  const minX = Math.min(0, ...plan.buildings.map((b) => b.x)), maxX = Math.max(0, ...plan.buildings.map((b) => b.x + b.w));
  const maxZ = Math.max(0, ...plan.buildings.map((b) => b.z)), minZ = Math.min(0, ...plan.buildings.map((b) => b.z - b.d));
  plan.bounds = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ, h: Math.max(0, ...plan.buildings.map((b) => (b.floors.length - 1) * FLOOR_GAP)) };
  return plan;
}

// A wall along x at depth z, from x0 to x1, with door-wide gaps at the given x positions.
function wallAlongX(x0: number, x1: number, y: number, z: number, h: number, doors: number[]): Wall[] {
  const gaps = doors.map((d) => [d - DOOR_W / 2, d + DOOR_W / 2]).sort((a, b) => a[0] - b[0]);
  const walls: Wall[] = [];
  let from = x0;
  gaps.forEach(([g0, g1]) => {
    if (g0 > from) walls.push({ x: (from + g0) / 2, y, z, w: g0 - from, d: 0.2, h });
    from = Math.max(from, g1);
  });
  if (x1 > from) walls.push({ x: (from + x1) / 2, y, z, w: x1 - from, d: 0.2, h });
  return walls;
}
