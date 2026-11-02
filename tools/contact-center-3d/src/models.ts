// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The 3D models: furniture from Kenney's Furniture Kit (CC0, in ../models), in the campus's own calm
// colours, and people as slim scale-model figures made here (as in an architect's model). The .glb files
// are inlined in the bundle (a web resource can't be a .glb file), loaded once, and turned into plain
// parts, so the scene can draw hundreds of each with one instanced mesh per part.

import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { mergeBufferGeometries, SkeletonUtils } from "three-stdlib";
import deskUrl from "../models/desk.glb";
import chairUrl from "../models/chairDesk.glb";
import screenUrl from "../models/computerScreen.glb";
import keyboardUrl from "../models/computerKeyboard.glb";
import waitingChairUrl from "../models/chairModernCushion.glb";
import plantUrl from "../models/pottedPlant.glb";

export interface ModelPart { geometry: THREE.BufferGeometry; material: THREE.Material }
// size: the model's box at our scale; it stands on y = 0, centred on x and z.
export interface Model { parts: ModelPart[]; size: THREE.Vector3 }

// Kenney's models are small: this makes a person about 1.7 m.
export const MODEL_SCALE = 2.5;

// scale: on top of MODEL_SCALE (Kenney's characters have big heads, so they're made smaller).
interface Options { yaw?: number; pose?: string; scale?: number }

// Per loaded file, the models made from it (one per turn, pose and scale).
const made = new WeakMap<object, Map<string, Model>>();

// The model's meshes as geometry in its own space, turned by yaw, scaled, standing on the floor.
// Characters are put in a pose (an animation, e.g. "sit") first and the pose baked into the geometry.
export function toModel(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }, { yaw = 0, pose, scale = 1 }: Options = {}): Model {
  const id = `${yaw}|${pose ?? ""}|${scale}`;
  const cache = made.get(gltf) ?? new Map<string, Model>();
  made.set(gltf, cache);
  const cached = cache.get(id);
  if (cached) return cached;
  // A pose goes on a fresh copy, so it starts from the rest pose: an animation that doesn't move every
  // bone (idle leaves the legs alone) would otherwise keep the pose baked before it.
  const scene = pose ? (SkeletonUtils.clone(gltf.scene) as THREE.Group) : gltf.scene;
  const clip = pose ? gltf.animations.find((a) => a.name === pose) : undefined;
  if (clip) {
    const mixer = new THREE.AnimationMixer(scene);
    mixer.clipAction(clip).play();
    mixer.setTime(clip.duration / 2);
  }
  scene.updateMatrixWorld(true);
  const turn = new THREE.Matrix4().makeRotationY(yaw);
  const parts: ModelPart[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let geometry: THREE.BufferGeometry;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = mesh as THREE.SkinnedMesh;
      skinned.skeleton.update();
      const source = skinned.geometry;
      const count = source.attributes.position.count;
      const positions = new Float32Array(count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        skinned.getVertexPosition(i, v);
        v.applyMatrix4(skinned.matrixWorld);
        positions.set([v.x, v.y, v.z], i * 3);
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      if (source.attributes.uv) geometry.setAttribute("uv", source.attributes.uv.clone());
      if (source.index) geometry.setIndex(source.index.clone());
      geometry.computeVertexNormals();
    } else {
      geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    }
    geometry.applyMatrix4(turn);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.length === 1 || !geometry.groups.length) parts.push({ geometry, material: materials[0] });
    // A mesh with several materials: a part per material.
    else geometry.groups.forEach((g) => {
      const piece = geometry.clone();
      piece.clearGroups();
      piece.setIndex(Array.from((geometry.index!.array as ArrayLike<number>)).slice(g.start, g.start + g.count));
      parts.push({ geometry: piece, material: materials[g.materialIndex ?? 0] });
    });
  });
  const box = new THREE.Box3();
  parts.forEach((p) => { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); });
  const centre = box.getCenter(new THREE.Vector3());
  const k = MODEL_SCALE * scale;
  const place = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z));
  parts.forEach((p) => { p.geometry.applyMatrix4(place); p.geometry.computeBoundingSphere(); });
  const model = { parts, size: box.getSize(new THREE.Vector3()).multiplyScalar(k) };
  cache.set(id, model);
  return model;
}

// Turns, so each model faces the way the scene needs. Kenney's models face +z. A desk's agent sits on its
// +z side facing -z, so the desk, screen and keyboard keep facing +z (towards the agent) and the chair
// and people turn round; waiting callers face into the room the same way (their back to its front).
const DESK_YAW = 0, CHAIR_YAW = Math.PI, SCREEN_YAW = 0, KEYBOARD_YAW = 0;

// The part of the screen model that is the display (its material in the Furniture Kit).
export const isDisplay = (material: THREE.Material) => material.name === "metal";

// People in three poses, each in both looks (a man and a woman).
export interface People { sit: Model[]; stand: Model[]; walk: Model[] }
export interface Models { desk: Model; chair: Model; screen: Model; keyboard: Model; waitingChair: Model; plant: Model; people: People }

type Loaded = { scene: THREE.Group; animations: THREE.AnimationClip[] };

// The campus's materials: light, matte furniture with darker seats, and a teal accent for plants.
const MATERIALS = {
  furniture: new THREE.MeshStandardMaterial({ color: "#eaf1fb", roughness: 0.5, metalness: 0.05 }),
  seat: new THREE.MeshStandardMaterial({ color: "#5a6f92", roughness: 0.6, metalness: 0.1 }),
  plant: new THREE.MeshStandardMaterial({ color: "#34b3a8", roughness: 0.7, emissive: "#0f766e", emissiveIntensity: 0.25 }),
  // The two looks of people: white, and a pale blue.
  personA: new THREE.MeshStandardMaterial({ color: "#eef3fb", roughness: 0.45, metalness: 0.05 }),
  personB: new THREE.MeshStandardMaterial({ color: "#a9cdf5", roughness: 0.45, metalness: 0.05 })
};

// A model in one material (a screen keeps its display, which the scene colours).
const restyled = new WeakMap<Model, Map<THREE.Material, Model>>();
function restyle(model: Model, material: THREE.Material): Model {
  const cache = restyled.get(model) ?? new Map<THREE.Material, Model>();
  restyled.set(model, cache);
  const hit = cache.get(material);
  if (hit) return hit;
  const next = { size: model.size, parts: model.parts.map((p) => ({ geometry: p.geometry, material: isDisplay(p.material) ? p.material : material })) };
  cache.set(material, next);
  return next;
}

export type Pose = "sit" | "stand" | "walk";

// A person as a scale-model figure: a slim tapered body and a round head, about 1.6 m standing; sitting,
// a shorter body with the thighs forward (towards -z, the way people face). It stands on y = 0.
export function figure(pose: Pose, material: THREE.Material): Model {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number) => { g.translate(x, y, z); parts.push(g.toNonIndexed()); };
  if (pose === "sit") {
    add(new THREE.CylinderGeometry(0.18, 0.23, 0.82, 18), 0, 0.41, 0.05);
    add(new THREE.BoxGeometry(0.42, 0.16, 0.5), 0, 0.08, -0.22);
    add(new THREE.SphereGeometry(0.17, 18, 14), 0, 1.02, 0.05);
  } else {
    add(new THREE.CylinderGeometry(0.16, 0.2, 1.22, 18), 0, 0.61, 0);
    add(new THREE.SphereGeometry(0.15, 18, 14), 0, 1.45, 0);
  }
  parts.forEach((g) => { g.deleteAttribute("uv"); });
  const geometry = mergeBufferGeometries(parts)!;
  // A little under life size, so a room reads as a calm pattern of desks.
  geometry.scale(0.88, 0.88, 0.88);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { parts: [{ geometry, material }], size: geometry.boundingBox!.getSize(new THREE.Vector3()) };
}

const figures = new Map<string, Model>();
const figureOf = (pose: Pose, look: 0 | 1) => {
  const key = `${pose}:${look}`;
  if (!figures.has(key)) figures.set(key, figure(pose, look ? MATERIALS.personB : MATERIALS.personA));
  return figures.get(key)!;
};

// Suspends until the models are loaded (wrap in <Suspense>).
export function useModels(): Models {
  const [desk, chair, screen, keyboard, waitingChair, plant] = useGLTF([deskUrl, chairUrl, screenUrl, keyboardUrl, waitingChairUrl, plantUrl], false, false) as unknown as Loaded[];
  const posed = (pose: Pose) => [figureOf(pose, 0), figureOf(pose, 1)];
  return {
    desk: restyle(toModel(desk, { yaw: DESK_YAW }), MATERIALS.furniture),
    chair: restyle(toModel(chair, { yaw: CHAIR_YAW }), MATERIALS.seat),
    screen: restyle(toModel(screen, { yaw: SCREEN_YAW }), MATERIALS.seat),
    keyboard: restyle(toModel(keyboard, { yaw: KEYBOARD_YAW }), MATERIALS.furniture),
    waitingChair: restyle(toModel(waitingChair, { yaw: CHAIR_YAW }), MATERIALS.seat),
    plant: restyle(toModel(plant), MATERIALS.plant),
    people: { sit: posed("sit"), stand: posed("stand"), walk: posed("walk") }
  };
}

// Which of the two looks a person has, the same every time.
export const lookOf = (key: string, hashed: (text: string) => number) => (hashed(key) > 0 ? 1 : 0);
