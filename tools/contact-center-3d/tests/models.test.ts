// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { toModel } from "../src/models";

// How far forward (towards -z, the way people face) a model reaches below the given height.
function reach(model: ReturnType<typeof toModel>, below: number): number {
  let min = 0;
  model.parts.forEach((p) => {
    const a = p.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) if (a.getY(i) < below) min = Math.min(min, a.getZ(i));
  });
  return -min;
}

describe("toModel", () => {
  test("each pose starts from the rest pose: standing after sitting has its legs down", async () => {
    (globalThis as unknown as { self: unknown }).self = globalThis;
    const buf = fs.readFileSync(path.join(__dirname, "../models/character-male-a.glb"));
    const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((ok, no) =>
      new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", ok as never, no));
    const sit = toModel(gltf, { yaw: Math.PI, pose: "sit" });
    const stand = toModel(gltf, { yaw: Math.PI, pose: "idle" });
    expect(stand.size.y).toBeGreaterThan(sit.size.y);
    // Sitting, the legs reach forward; standing, they don't.
    expect(reach(sit, 0.6)).toBeGreaterThan(reach(stand, 0.6) + 0.1);
    // The same pose again comes from the cache.
    expect(toModel(gltf, { yaw: Math.PI, pose: "sit" })).toBe(sit);
  });
});
