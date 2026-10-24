// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Graph, GraphEdge, GraphNode } from "../../environment-3d-explorer/src/model";
import { Grouping } from "./centers";

// The floor plan: every customer center becomes a building on a campus, laid out from front to back
// the way a call goes through it:
//
//   entrance  - a door per voice channel, its phone numbers on a sign above
//   lobby     - one per workstream: reception (the workstream), a bot kiosk in front of it if there is one
//   corridor  - a signpost per routing rule; paths on the floor lead from each sign to its room
//   rooms     - one per queue: desks with an agent behind each, chairs to wait on by the door, the
//               opening hours on a sign, and the overflow (mailbox, phone booth, exit, door through) outside
//
// A queue's room is in the center that routes to it most; other centers reach it over a skybridge.
// An agent in several queues has one desk, in the first of them that has a room. Queues no workstream
// routes to get a building of their own. Units are roughly metres. Pure and deterministic.

export type Vec3 = [number, number, number];

export type AreaKind = "building" | "entrance" | "lobby" | "corridor" | "room";
export interface Area { kind: AreaKind; key?: string; centerId: string; x: number; z: number; w: number; d: number; name?: string; color: string }

// A wall piece, centred on (x, z), standing on the floor.
export interface Wall { x: number; z: number; w: number; d: number; h: number }

export type FixtureKind = "door" | "numbers" | "reception" | "kiosk" | "signpost" | "desk" | "chair" | "hours" | "mailbox" | "booth" | "exit" | "transfer" | "hold";
export interface Fixture { kind: FixtureKind; key?: string; x: number; z: number; label?: string }

export type PathKind = "route" | "default" | "transfer" | "skybridge";
export interface Path { kind: PathKind; points: Vec3[]; key?: string }

export interface Building { centerId: string; name: string; color: string; x: number; z: number; w: number; d: number }

export interface Plan {
  buildings: Building[];
  areas: Area[];
  walls: Wall[];
  fixtures: Fixture[];
  paths: Path[];
  // Where each record is, to fly to it and mark it: reception for a workstream, the room for a queue,
  // the person at the desk for an agent, and so on. Centers are "center:<id>".
  anchors: Map<string, Vec3>;
  // Agents who sit in another room, per queue (for the room's details).
  elsewhere: Map<string, number>;
  bounds: { x: number; z: number; w: number; d: number };
}

export const UNROUTED_CENTER = "unrouted";
const UNROUTED_COLOR = "#64748b";

// Layout sizes.
const DESK = 3.2;
const ROOM_MIN_W = 10;
const WAITING = 4;
const LOBBY_MIN_W = 12;
const RULE_GAP = 3.6;
const ENTRANCE_D = 4, LOBBY_D = 10, CORRIDOR_D = 7;
const ROOMS_FROM = ENTRANCE_D + LOBBY_D + CORRIDOR_D + 1;
const ROOM_GAP = 3;
const DOOR_W = 2.4;
export const WALL_H = 3.5, ROOM_WALL_H = 2.6, PARTITION_H = 1.2;
const CAMPUS_GAP = 18;

const OVERFLOW_FIXTURES: Record<string, FixtureKind> = {
  "Voicemail": "mailbox", "Direct callback": "booth", "Scheduled callback": "booth", "Transfer to phone": "booth",
  "End conversation": "exit", "Queue transfer": "transfer", "Remain in queue": "hold"
};

interface Room { key: string; name: string; desks: string[]; w: number; d: number; x: number; dz: number }

export function buildPlan(graph: Graph, grouping: Grouping): Plan {
  const nodeByKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const out = (key: string, kind?: GraphEdge["kind"]) => graph.edges.filter((e) => e.from === key && (!kind || e.kind === kind));
  const into = (key: string, kind?: GraphEdge["kind"]) => graph.edges.filter((e) => e.to === key && (!kind || e.kind === kind));
  const order = (n: GraphNode) => Number(n.details.find(([l]) => l === "Order")?.[1] ?? 0);

  // Which center each workstream is in, and each center's workstreams.
  const centerOfWorkstream = new Map<string, string>();
  grouping.centers.forEach((c) => c.workstreams.forEach((id) => centerOfWorkstream.set(`workstream:${id}`, c.id)));
  const rulesOf = (wsKey: string) => out(wsKey, "routes").map((e) => nodeByKey.get(e.to)!).filter(Boolean).sort((a, b) => order(a) - order(b));

  // Queue rooms go where most routes to them come from.
  const votes = new Map<string, Map<string, number>>();
  const vote = (queueKey: string, centerId: string | undefined) => {
    if (!centerId) return;
    const v = votes.get(queueKey) ?? new Map<string, number>();
    v.set(centerId, (v.get(centerId) ?? 0) + 1);
    votes.set(queueKey, v);
  };
  centerOfWorkstream.forEach((centerId, wsKey) => {
    rulesOf(wsKey).forEach((rule) => out(rule.key, "routes").forEach((e) => vote(e.to, centerId)));
    out(wsKey, "default").forEach((e) => vote(e.to, centerId));
  });
  const centerIndex = new Map(grouping.centers.map((c, i) => [c.id, i]));
  const ownerOf = new Map<string, string>();
  votes.forEach((v, queueKey) => ownerOf.set(queueKey, [...v.entries()].sort((a, b) => b[1] - a[1] || (centerIndex.get(a[0]) ?? 0) - (centerIndex.get(b[0]) ?? 0))[0][0]));
  // A queue only reached by another queue's overflow transfer sits with that queue.
  const queues = graph.nodes.filter((n) => n.kind === "queue").sort((a, b) => a.name.localeCompare(b.name));
  for (let pass = 0; pass < 3; pass++) {
    queues.forEach((q) => {
      if (ownerOf.has(q.key)) return;
      const from = into(q.key, "transfer").map((e) => into(e.from, "overflow")[0]?.from).find((k) => k && ownerOf.has(k));
      if (from) ownerOf.set(q.key, ownerOf.get(from)!);
    });
  }
  queues.forEach((q) => { if (!ownerOf.has(q.key)) ownerOf.set(q.key, UNROUTED_CENTER); });

  // One desk per agent: in the first of their queues (by name) that has a room.
  const homeOf = new Map<string, string>();
  graph.nodes.filter((n) => n.kind === "agent").forEach((a) => {
    const home = into(a.key, "member").map((e) => nodeByKey.get(e.from)!).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name))[0];
    if (home) homeOf.set(a.key, home.key);
  });
  const elsewhere = new Map<string, number>();
  queues.forEach((q) => elsewhere.set(q.key, out(q.key, "member").filter((e) => homeOf.get(e.to) !== q.key).length));

  const centers = [...grouping.centers.map((c) => ({ id: c.id, name: c.name, color: c.color, workstreams: c.workstreams.map((id) => `workstream:${id}`).filter((k) => nodeByKey.has(k)) }))];
  if ([...ownerOf.values()].includes(UNROUTED_CENTER)) centers.push({ id: UNROUTED_CENTER, name: "Not routed", color: UNROUTED_COLOR, workstreams: [] });

  const plan: Plan = { buildings: [], areas: [], walls: [], fixtures: [], paths: [], anchors: new Map(), elsewhere, bounds: { x: 0, z: 0, w: 0, d: 0 } };
  const doorOf = new Map<string, Vec3>();
  const pendingPaths: { kind: PathKind; from: Vec3; to: string; key?: string; viaCorridor?: number }[] = [];

  // First the size of every building, then the campus, then everything in place.
  const layouts = centers.map((c) => {
    const lobbies = c.workstreams.map((wsKey) => {
      const channels = [...into(wsKey, "channel"), ...into(wsKey, "handoff").flatMap((b) => into(b.from, "bot"))].map((e) => e.from);
      const rules = rulesOf(wsKey);
      return { wsKey, channels, rules, w: Math.max(LOBBY_MIN_W, rules.length * RULE_GAP + 4, channels.length * 4 + 4) };
    });
    const rooms: Room[] = queues.filter((q) => ownerOf.get(q.key) === c.id).map((q) => {
      const desks = out(q.key, "member").map((e) => e.to).filter((a) => homeOf.get(a) === q.key);
      const cols = Math.max(2, Math.ceil(Math.sqrt(desks.length)));
      const rows = Math.max(1, Math.ceil(desks.length / cols));
      return { key: q.key, name: q.name, desks, w: Math.max(ROOM_MIN_W, cols * DESK + 3), d: rows * DESK + WAITING + 2, x: 0, dz: 0 };
    });
    const area = rooms.reduce((s, r) => s + r.w * r.d, 0);
    const width = Math.max(lobbies.reduce((s, l) => s + l.w, 0), ...rooms.map((r) => r.w + 4), Math.sqrt(area * 1.8), LOBBY_MIN_W) + 4;
    // Rooms in rows, left to right.
    let x = 2, dz = ROOMS_FROM, rowDepth = 0;
    rooms.forEach((r) => {
      if (x + r.w > width - 2 && x > 2) { x = 2; dz += rowDepth + ROOM_GAP; rowDepth = 0; }
      r.x = x; r.dz = dz;
      x += r.w + ROOM_GAP;
      rowDepth = Math.max(rowDepth, r.d);
    });
    const depth = (rooms.length ? dz + rowDepth : ROOMS_FROM) + 2;
    return { center: c, lobbies, rooms, width, depth };
  });

  // The campus: buildings in rows, front facing the viewer (+z).
  const rowLimit = Math.max(120, Math.sqrt(layouts.reduce((s, l) => s + l.width * l.depth, 0)) * 1.6);
  let cx = 0, cz = 0, rowDepth = 0;
  layouts.forEach((l) => {
    if (cx + l.width > rowLimit && cx > 0) { cx = 0; cz -= rowDepth + CAMPUS_GAP; rowDepth = 0; }
    const x0 = cx, z0 = cz;
    cx += l.width + CAMPUS_GAP;
    rowDepth = Math.max(rowDepth, l.depth);
    const { center, lobbies, rooms, width, depth } = l;
    const wz = (d: number) => z0 - d;
    plan.buildings.push({ centerId: center.id, name: center.name, color: center.color, x: x0, z: z0, w: width, d: depth });
    plan.areas.push({ kind: "building", centerId: center.id, x: x0 + width / 2, z: wz(depth / 2), w: width, d: depth, name: center.name, color: center.color });
    plan.anchors.set(`center:${center.id}`, [x0 + width / 2, 0, wz(depth / 2)]);

    // Lobbies share the full width.
    const lobbyTotal = lobbies.reduce((s, lb) => s + lb.w, 0);
    const stretch = lobbies.length ? (width - 4) / lobbyTotal : 1;
    let lx = x0 + 2;
    const frontDoors: number[] = [];
    lobbies.forEach((lb, i) => {
      const lw = lb.w * stretch;
      const mid = lx + lw / 2;
      const ws = nodeByKey.get(lb.wsKey)!;
      plan.areas.push({ kind: "entrance", centerId: center.id, x: mid, z: wz(ENTRANCE_D / 2), w: lw, d: ENTRANCE_D, color: center.color });
      plan.areas.push({ kind: "lobby", key: lb.wsKey, centerId: center.id, x: mid, z: wz(ENTRANCE_D + LOBBY_D / 2), w: lw, d: LOBBY_D, name: ws.name, color: center.color });

      // A door per channel in the front wall, its numbers above it.
      const doors = lb.channels.length ? lb.channels : [undefined];
      doors.forEach((channelKey, j) => {
        const dx = lx + (lw * (j + 1)) / (doors.length + 1);
        frontDoors.push(dx);
        plan.fixtures.push({ kind: "door", key: channelKey, x: dx, z: wz(0), label: channelKey ? nodeByKey.get(channelKey)?.name : "Entrance" });
        if (channelKey) {
          plan.anchors.set(channelKey, [dx, 1.2, wz(0.5)]);
          const numbers = into(channelKey, "number").map((e) => nodeByKey.get(e.from)!).filter(Boolean);
          if (numbers.length) {
            plan.fixtures.push({ kind: "numbers", key: numbers[0].key, x: dx, z: wz(0), label: numbers.map((n) => n.name).join(" · ") });
            numbers.forEach((n) => plan.anchors.set(n.key, [dx, 4, wz(0)]));
          }
        }
      });

      // Reception, and the bot's kiosk in front of it.
      plan.fixtures.push({ kind: "reception", key: lb.wsKey, x: mid, z: wz(ENTRANCE_D + 5.5), label: ws.name });
      plan.anchors.set(lb.wsKey, [mid, 1, wz(ENTRANCE_D + 5.5)]);
      const bot = into(lb.wsKey, "handoff")[0]?.from;
      if (bot) {
        plan.fixtures.push({ kind: "kiosk", key: bot, x: mid, z: wz(ENTRANCE_D + 2), label: nodeByKey.get(bot)?.name });
        plan.anchors.set(bot, [mid, 1.2, wz(ENTRANCE_D + 2)]);
      }

      // A signpost per rule at the corridor; a path to its room.
      const signZ = ENTRANCE_D + LOBBY_D + 1.5;
      lb.rules.forEach((rule, k) => {
        const sx = lx + (lw * (k + 1)) / (lb.rules.length + 1);
        plan.fixtures.push({ kind: "signpost", key: rule.key, x: sx, z: wz(signZ), label: rule.name });
        plan.anchors.set(rule.key, [sx, 1.8, wz(signZ)]);
        out(rule.key, "routes").forEach((e) => pendingPaths.push({ kind: "route", from: [sx, 0.06, wz(signZ)], to: e.to, key: rule.key, viaCorridor: wz(ENTRANCE_D + LOBBY_D + CORRIDOR_D / 2) }));
      });
      out(lb.wsKey, "default").forEach((e) => pendingPaths.push({ kind: "default", from: [mid, 0.06, wz(ENTRANCE_D + 6.5)], to: e.to, key: lb.wsKey, viaCorridor: wz(ENTRANCE_D + LOBBY_D + CORRIDOR_D / 2 + 1) }));

      // Low partitions between lobbies.
      if (i > 0) plan.walls.push({ x: lx, z: wz(ENTRANCE_D + LOBBY_D / 2), w: 0.2, d: LOBBY_D, h: PARTITION_H });
      lx += lw;
    });
    plan.areas.push({ kind: "corridor", centerId: center.id, x: x0 + width / 2, z: wz(ENTRANCE_D + LOBBY_D + CORRIDOR_D / 2), w: width, d: CORRIDOR_D, color: center.color });

    // Rooms.
    rooms.forEach((r) => {
      const rx = x0 + r.x, front = r.dz;
      const doorX = rx + r.w / 2;
      plan.areas.push({ kind: "room", key: r.key, centerId: center.id, x: rx + r.w / 2, z: wz(front + r.d / 2), w: r.w, d: r.d, name: r.name, color: center.color });
      plan.anchors.set(r.key, [rx + r.w / 2, 0, wz(front + r.d / 2)]);
      doorOf.set(r.key, [doorX, 0.06, wz(front)]);
      plan.walls.push(...wallAlongX(rx, rx + r.w, wz(front), ROOM_WALL_H, [doorX]), ...wallAlongX(rx, rx + r.w, wz(front + r.d), ROOM_WALL_H, []));
      plan.walls.push({ x: rx, z: wz(front + r.d / 2), w: 0.2, d: r.d, h: ROOM_WALL_H }, { x: rx + r.w, z: wz(front + r.d / 2), w: 0.2, d: r.d, h: ROOM_WALL_H });

      // Chairs to wait on by the door, then rows of desks.
      [-3, -1.5, 1.5, 3].forEach((off) => plan.fixtures.push({ kind: "chair", x: doorX + off, z: wz(front + 1.6) }));
      const cols = Math.max(2, Math.ceil(Math.sqrt(r.desks.length)));
      r.desks.forEach((agentKey, n) => {
        const dx = rx + 1.5 + DESK / 2 + (n % cols) * DESK + (r.w - 3 - cols * DESK) / 2;
        const dz = front + WAITING + 1 + DESK / 2 + Math.floor(n / cols) * DESK;
        plan.fixtures.push({ kind: "desk", key: agentKey, x: dx, z: wz(dz), label: nodeByKey.get(agentKey)?.name });
        plan.anchors.set(agentKey, [dx, 1.4, wz(dz + 0.6)]);
      });

      // Opening hours on the door; overflow just outside it.
      into(r.key, "hours").forEach((e) => {
        plan.fixtures.push({ kind: "hours", key: e.from, x: doorX + DOOR_W / 2 + 0.9, z: wz(front - 0.1), label: nodeByKey.get(e.from)?.name });
        if (!plan.anchors.has(e.from)) plan.anchors.set(e.from, [doorX + DOOR_W / 2 + 0.9, 2, wz(front)]);
      });
      out(r.key, "overflow").forEach((e, k) => {
        const node = nodeByKey.get(e.to);
        const fx = doorX + (k % 2 === 0 ? -1 : 1) * (DOOR_W / 2 + 1.2 + Math.floor(k / 2) * 1.6);
        plan.fixtures.push({ kind: OVERFLOW_FIXTURES[node?.name ?? ""] ?? "hold", key: e.to, x: fx, z: wz(front - 1.2), label: node?.name });
        plan.anchors.set(e.to, [fx, 1.2, wz(front - 1.2)]);
        out(e.to, "transfer").forEach((t) => pendingPaths.push({ kind: "transfer", from: [fx, 0.06, wz(front - 1.2)], to: t.to, key: e.to }));
      });
    });

    // The building's outer walls, with the doors open.
    plan.walls.push(...wallAlongX(x0, x0 + width, wz(0), WALL_H, frontDoors), ...wallAlongX(x0, x0 + width, wz(depth), WALL_H, []));
    plan.walls.push({ x: x0, z: wz(depth / 2), w: 0.25, d: depth, h: WALL_H }, { x: x0 + width, z: wz(depth / 2), w: 0.25, d: depth, h: WALL_H });
  });

  // Paths to the rooms: along the corridor in the same building, over a skybridge to another one.
  const buildingOf = (p: Vec3) => plan.buildings.find((b) => p[0] >= b.x && p[0] <= b.x + b.w && p[2] <= b.z && p[2] >= b.z - b.d);
  pendingPaths.forEach((p) => {
    const door = doorOf.get(p.to);
    if (!door) return;
    const same = buildingOf(p.from) === buildingOf(door);
    if (same && p.viaCorridor !== undefined) {
      plan.paths.push({ kind: p.kind, key: p.key, points: [p.from, [p.from[0], 0.06, p.viaCorridor], [door[0], 0.06, p.viaCorridor], door] });
    } else if (same) {
      plan.paths.push({ kind: p.kind, key: p.key, points: [p.from, door] });
    } else {
      const points: Vec3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        points.push([p.from[0] + (door[0] - p.from[0]) * t, 0.06 + Math.sin(Math.PI * t) * 9, p.from[2] + (door[2] - p.from[2]) * t]);
      }
      // A rule to another center is a skybridge; a default queue or a transfer there keeps its own (quieter) look.
      plan.paths.push({ kind: p.kind === "route" ? "skybridge" : p.kind, key: p.key, points });
    }
  });

  const minX = Math.min(0, ...plan.buildings.map((b) => b.x)), maxX = Math.max(0, ...plan.buildings.map((b) => b.x + b.w));
  const maxZ = Math.max(0, ...plan.buildings.map((b) => b.z)), minZ = Math.min(0, ...plan.buildings.map((b) => b.z - b.d));
  plan.bounds = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
  return plan;
}

// A wall along x at depth z, from x0 to x1, with door-wide gaps at the given x positions.
function wallAlongX(x0: number, x1: number, z: number, h: number, doors: number[]): Wall[] {
  const gaps = doors.map((d) => [d - DOOR_W / 2, d + DOOR_W / 2]).sort((a, b) => a[0] - b[0]);
  const walls: Wall[] = [];
  let from = x0;
  gaps.forEach(([g0, g1]) => {
    if (g0 > from) walls.push({ x: (from + g0) / 2, z, w: g0 - from, d: 0.2, h });
    from = Math.max(from, g1);
  });
  if (x1 > from) walls.push({ x: (from + x1) / 2, z, w: x1 - from, d: 0.2, h });
  return walls;
}
