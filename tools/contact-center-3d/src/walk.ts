// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { PATH_Y, Plan, Vec3 } from "./floorplan";

// Following a call through the building the way a caller would walk it, rather than in straight lines
// from record to record: from a signpost (or the front desk, or a transfer door) along the same
// walkway route as the line on the floor to the room's front door, in, and to the waiting bench, where
// it waits until you choose an agent. To overflow by the front door it walks back out of the door.
// Pure.

// Eye height of a walking caller.
const EYE = 1.2;

// Points on the floor (and records' markers) at eye height; a skybridge's points keep their height above it.
const lift = (p: Vec3, onLine: boolean): Vec3 => [p[0], onLine && p[1] > 1.5 ? p[1] + EYE : EYE, p[2]];
const close = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[2] - b[2]) < 0.05;

// startAt: where the first record stands when it stands in more than one place (the agent's desk that
// was clicked); an agent reached from a room is always at their desk in that room.
export function walkRoute(plan: Plan, path: string[], startAt?: Vec3): Vec3[] {
  const points: Vec3[] = [];
  const add = (p: Vec3, onLine = false) => { const q = lift(p, onLine); if (!points.length || !close(points[points.length - 1], q) || Math.abs(points[points.length - 1][1] - q[1]) > 0.05) points.push(q); };
  // The spot in front of a room's waiting bench.
  const atBench = (room: string): Vec3 | undefined => {
    const seats = plan.chairs.get(room);
    return seats ? [(seats[0][0] + seats[seats.length - 1][0]) / 2, 0, seats[0][2] - 1.1] : undefined;
  };
  // Just inside a room's front door, and just outside it.
  const inside = (door: Vec3): Vec3 => [door[0], 0, door[2] - 1.2];
  const outside = (door: Vec3): Vec3 => [door[0], 0, door[2] + 1.2];

  path.forEach((key, i) => {
    const prev = path[i - 1];
    const door = plan.doors.get(key);
    if (door) {
      // To a room: the line on the floor from where the call comes from, else straight to its door.
      const way = prev ? plan.paths.find((p) => p.key === prev && close(p.points[p.points.length - 1], door)) : undefined;
      if (way) way.points.slice(1).forEach((q) => add(q, true));
      else { add(outside(door)); add(door); }
      add(inside(door));
      const bench = atBench(key);
      if (bench) add(bench);
      return;
    }
    // An agent after a room: their desk in that room.
    const at = (i === 0 && startAt) || (prev && plan.desks.get(`${prev}|${key}`)) || plan.anchors.get(key);
    if (!at) return;
    // Leaving a room for an overflow outside its front door: back out through the door first.
    const prevDoor = prev ? plan.doors.get(prev) : undefined;
    if (prevDoor && at[2] > prevDoor[2]) { add(inside(prevDoor)); add(prevDoor); add(outside(prevDoor)); }
    add(at);
  });
  return points;
}

// A new caller walking in, live: in through their way in, to the front of their workstream's counter,
// through it, and along the line on the floor their call takes to the room (from a signpost of one of
// the workstream's rules, or the default queue's line from the counter), over the curved line when
// the room is in another customer center, in at its door and to a waiting seat. Straight walkways at
// right angles, the same as the lines. ruleKeys: the workstream's routing rules, to find the line by.
// On the floor (y 0); over a curved line, its height above the floor. Undefined when there's no line.
// How long a walk takes, in seconds: a brisk pace, so a long way doesn't take all day.
export const WALK_SPEED = 6;
export function walkSeconds(points: Vec3[]): number {
  const length = points.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - points[i][0], q[1] - points[i][1], q[2] - points[i][2]), 0);
  return Math.min(30, Math.max(3, length / WALK_SPEED));
}

export function walkInRoute(plan: Plan, call: { workstreamKey: string; queueKey: string; ruleKeys: string[] }): Vec3[] | undefined {
  const from = plan.entrances.get(call.workstreamKey);
  const counter = plan.anchors.get(call.workstreamKey);
  const door = plan.doors.get(call.queueKey);
  const seats = plan.chairs.get(call.queueKey);
  if (!from || !counter || !door || !seats?.length) return undefined;
  const keys = [call.workstreamKey, ...call.ruleKeys];
  const line = plan.paths.find((p) => p.key && keys.includes(p.key) && close(p.points[p.points.length - 1], door));
  if (!line) return undefined;
  const floor = (p: Vec3): Vec3 => [p[0], p[1] > 1.5 ? p[1] - PATH_Y : 0, p[2]];
  const points: Vec3[] = [];
  const add = (p: Vec3) => { const last = points[points.length - 1]; if (!last || !close(last, p) || Math.abs(last[1] - p[1]) > 0.05) points.push(p); };
  const front = counter[2] + 2, behind = counter[2] - 1;
  add([from[0], 0, from[2]]);
  add([from[0], 0, front]);
  add([counter[0], 0, front]);
  add([counter[0], 0, behind]);
  // To the line's start (a signpost; the default queue's line starts right behind the counter).
  const start = line.points[0];
  add([counter[0], 0, start[2]]);
  line.points.forEach((q) => add(floor(q)));
  const seat = seats[seats.length - 1];
  add([door[0], 0, door[2] - 1.2]);
  add([seat[0], 0, door[2] - 1.2]);
  add([seat[0], 0, seat[2]]);
  return points;
}

// Where furniture stands, as rectangles on the floor (centre, half width along x, half depth along z):
// walking callers pass through some of it on their way (a desk on an aisle, a signpost on a line), and
// turn see-through while they do.
export interface Rect { x: number; z: number; hw: number; hd: number }

// The plants in each lobby's corners.
export function lobbyPlants(plan: Plan): Vec3[] {
  return plan.areas.filter((a) => a.kind === "lobby").flatMap((a) => [-1, 1].flatMap((sx) => [-1, 1].map((sz): Vec3 => [a.x + sx * (a.w / 2 - 1), a.y, a.z + sz * (a.d / 2 - 1)])));
}

export function obstacles(plan: Plan): Rect[] {
  const around = (x: number, z: number, hw: number, hd: number): Rect => ({ x, z, hw, hd });
  return [
    ...plan.fixtures.flatMap((f): Rect[] => {
      switch (f.kind) {
        // The desk and the agent's chair behind it.
        case "desk": return [around(f.x, f.z + 0.3, 1, 1.15)];
        // The front desk and the receptionists behind it.
        case "reception": return [around(f.x, f.z - 0.5, (f.w ?? 4.2) / 2 + 0.1, 1.2)];
        case "signpost": return [around(f.x, f.z, 0.8, 0.25)];
        case "notice": return [around(f.x, f.z, 0.6, 0.25)];
        case "kiosk": return [around(f.x, f.z, 0.45, 0.35)];
        case "portal": return [around(f.x, f.z, 3, 0.4)];
        case "mailbox": case "exit": case "hold": return [around(f.x, f.z, 0.45, 0.45)];
        case "booth": return [around(f.x, f.z, 0.55, 0.55)];
        default: return [];
      }
    }),
    ...lobbyPlants(plan).map((p) => around(p[0], p[2], 0.4, 0.4))
  ];
}

// Whether a figure about this wide (radius) at (x, z) overlaps any of the rectangles.
export function inAny(rects: Rect[], x: number, z: number, radius = 0.3): boolean {
  return rects.some((r) => Math.abs(x - r.x) < r.hw + radius && Math.abs(z - r.z) < r.hd + radius);
}
