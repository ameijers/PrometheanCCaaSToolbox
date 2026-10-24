// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Plan, Vec3 } from "./floorplan";

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

export function walkRoute(plan: Plan, path: string[]): Vec3[] {
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
    const at = (prev && plan.desks.get(`${prev}|${key}`)) || plan.anchors.get(key);
    if (!at) return;
    // Leaving a room for an overflow outside its front door: back out through the door first.
    const prevDoor = prev ? plan.doors.get(prev) : undefined;
    if (prevDoor && at[2] > prevDoor[2]) { add(inside(prevDoor)); add(prevDoor); add(outside(prevDoor)); }
    add(at);
  });
  return points;
}
