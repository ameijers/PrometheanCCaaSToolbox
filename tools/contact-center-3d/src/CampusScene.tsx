// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Severity } from "../../environment-3d-explorer/src/health";
import { hash } from "../../environment-3d-explorer/src/layout";
import { CameraGoal, CameraRig, Mode, Ride, SceneHandle } from "../../environment-3d-explorer/src/Scene";
import { Area, Fixture, FixtureKind, Path, PathKind, Plan, Vec3, Wall, Wing, WING_COLORS } from "./floorplan";
import { isDisplay, lookOf, Model, Models, useModels } from "./models";
import { inAny, lobbyPlants, obstacles, Rect } from "./walk";

// The campus in 3D: open-roofed buildings seen from above, like a doll's house. Floors, walls, desks
// and people are instanced boxes, so a large center stays smooth.

// Near black behind the buildings, so they stand out.
export const SKY = "#05070b";
const WALL = "#f8fafc";
const WOOD = "#b98b5e";
const SCREEN = "#1e293b";
const PERSON = "#475569";
const SKIN = "#f1c7a4";

export const SEVERITY_COLORS: Record<Severity, string> = { problem: "#ef4444", warning: "#f59e0b" };

const AREA_TINT: Record<Area["kind"], number> = { building: 0.8, entrance: 0.6, lobby: 0.45, corridor: 0.72, wing: 0.72, room: 0.55 };
// The lines' looks; the page's legend explains them from the same list.
export const PATH_STYLE: Record<PathKind, { color: string; dashed: boolean; width: number; label: string }> = {
  route: { color: "#f43f5e", dashed: false, width: 2, label: "Routing rule to its room" },
  only: { color: "#f59e0b", dashed: false, width: 2, label: "Only route: workstream's default queue (no routing rules)" },
  skybridge: { color: "#38bdf8", dashed: false, width: 2.2, label: "Routing rule to a room in another customer center (skybridge)" },
  default: { color: "#facc15", dashed: true, width: 1.2, label: "Workstream's default queue" },
  transfer: { color: "#fb7185", dashed: true, width: 1.6, label: "Overflow: transfer to another queue" }
};
// Labels keep one small size. Inside a building they only show when the camera is this close (metres),
// so the campus from afar isn't a heap of labels and labels near you stay readable while exploring.
const ROOM_LABEL_RANGE = 150;
const SIGN_LABEL_RANGE = 90;
const SMALL_LABEL_RANGE = 60;
const LABELLED: FixtureKind[] = ["signpost", "numbers", "hours", "mailbox", "booth", "exit", "transfer", "hold", "kiosk", "counter", "portal", "notice"];
const PALETTE = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa", "#a78bfa", "#f472b6", "#94a3b8", "#c084fc"];
export const colorFor = (name: string) => PALETTE[Math.floor(((hash(name, 21) + 1) / 2) * PALETTE.length) % PALETTE.length];

// turn: which way they face (0: into the room, away from its front; Math.PI / 2: towards -x, e.g. from
// beside a desk towards the agent). chair: they bring their own (a visitor's chair beside a desk).
export interface Caller { key: string; at: Vec3; color: string; standing: boolean; turn?: number; chair?: boolean }
// seconds: how long the walk takes; until: when it's there (ms since 1970), for the page to let it go.
export interface Walker { id: string; points: Vec3[]; color: string; seconds: number; until: number }

interface Props {
  plan: Plan;
  mode: Mode;
  goal?: CameraGoal;
  selected?: string;
  // Only this wing's rooms (the reception and corridor always show).
  wing?: Wing;
  showUnits?: boolean;
  issues?: Map<string, Severity>;
  // Live activity: desk screens in the agent's presence colour, callers waiting or at a desk, new ones walking in.
  screens?: Map<string, string>;
  callers?: Caller[];
  walkers?: Walker[];
  labelSuffix?: Map<string, string>;
  ride?: Ride;
  handle?: React.MutableRefObject<SceneHandle | null>;
  // at: where the record was clicked, when it stands in more than one place (an agent's desks).
  onSelect(key: string, at?: Vec3): void;
  // Where the selection ring goes, when that's not the record's own spot (the desk that was clicked).
  selectedSpot?: Vec3;
}

const tint = (color: string, amount: number) => new THREE.Color(color).lerp(new THREE.Color("#ffffff"), amount);
interface BoxItem { x: number; y: number; z: number; w: number; h: number; d: number; color?: THREE.Color; key?: string }

// Boxes of any size from one unit cube: position, scale and colour per instance.
function Boxes({ items, color, opacity = 1, emissive, onPick }: { items: BoxItem[]; color?: string; opacity?: number; emissive?: boolean; onPick?: (key: string | undefined, item: BoxItem) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const base = new THREE.Color(color ?? "#ffffff");
    items.forEach((b, i) => {
      m.compose(new THREE.Vector3(b.x, b.y + b.h / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, b.color ?? base);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, color]);
  if (!items.length) return null;
  return (
    <instancedMesh
      key={items.length} ref={ref} args={[geometry, undefined, items.length]}
      onClick={onPick ? (e: ThreeEvent<MouseEvent>) => { if (e.delta > 4 || e.instanceId === undefined) return; e.stopPropagation(); onPick(items[e.instanceId]?.key, items[e.instanceId]); } : undefined}
      raycast={onPick ? undefined : () => null}
    >
      {emissive
        ? <meshBasicMaterial toneMapped={false} />
        : <meshStandardMaterial transparent={opacity < 1} opacity={opacity} roughness={0.85} />}
    </instancedMesh>
  );
}

interface DesksProps { desks: Fixture[]; screens?: Map<string, string>; showUnits?: boolean; onPick(key: string, at: Vec3): void }

// Which desk was clicked: the agent may sit in several rooms.
function pickDesk(desks: Fixture[], onPick: DesksProps["onPick"]) {
  return (key: string | undefined, item: { x: number; z: number }) => {
    const desk = desks.find((d) => d.key === key && Math.abs(d.x - item.x) < 1 && Math.abs(d.z - item.z) < 1.2);
    if (key) onPick(key, desk ? [desk.x, 1.4, desk.z + 0.6] : [item.x, 1.4, item.z]);
  };
}

// Desks: the 3D models, or the box desks while they load (or if they can't).
function Desks(props: DesksProps) {
  return (
    <ModelsOrBoxes fallback={<BoxDesks {...props} />}>
      <ModelDesks {...props} />
    </ModelsOrBoxes>
  );
}

// Shows the fallback while the models load, and keeps it if loading fails.
class ModelsOrBoxes extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : <Suspense fallback={this.props.fallback}>{this.props.children}</Suspense>; }
}

// How high a sitting person is placed on a chair (their model's lowest point is the seat).
const SEATED_Y = 0.5;

interface ModelItem { x: number; y: number; z: number; key?: string; turn?: number; scale?: number }

// A part of a model coloured per copy (a screen's display in the agent's presence colour); glow: lit.
interface Tint { part(material: THREE.Material): boolean; colors: THREE.Color[]; glow?: boolean }

// Many copies of one model: an instanced mesh per part, each copy moved to its spot.
function ModelInstances({ model, items, onPick, tint }: { model: Model; items: ModelItem[]; onPick?: (key: string | undefined, item: ModelItem) => void; tint?: Tint }) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const tinted = useMemo(() => (tint?.glow ? new THREE.MeshBasicMaterial({ toneMapped: false }) : new THREE.MeshStandardMaterial({ roughness: 0.5 })), [tint?.glow]);
  useEffect(() => () => tinted.dispose(), [tinted]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    refs.current.forEach((mesh, p) => {
      if (!mesh) return;
      items.forEach((it, i) => { m.makeRotationY(it.turn ?? 0).scale(new THREE.Vector3(it.scale ?? 1, it.scale ?? 1, it.scale ?? 1)).setPosition(it.x, it.y, it.z); mesh.setMatrixAt(i, m); });
      if (tint && tint.part(model.parts[p].material)) {
        items.forEach((_, i) => mesh.setColorAt(i, tint.colors[i]));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [items, model, tint]);
  if (!items.length) return null;
  return (
    <>
      {model.parts.map((part, p) => (
        <instancedMesh
          key={`${p}:${items.length}`} ref={(el) => { refs.current[p] = el; }} args={[part.geometry, tint?.part(part.material) ? tinted : part.material, items.length]}
          onClick={onPick ? (e: ThreeEvent<MouseEvent>) => { if (e.delta > 4 || e.instanceId === undefined) return; e.stopPropagation(); onPick(items[e.instanceId]?.key, items[e.instanceId]); } : undefined}
          raycast={onPick ? undefined : () => null}
        />
      ))}
    </>
  );
}

// Desks from the models: a desk, a screen and keyboard on it, an office chair and an agent sitting
// on it, facing the screen. The display glows in the agent's presence colour; skill badges and the
// business unit carpet as with the box desks.
function ModelDesks({ desks, screens, showUnits, onPick }: DesksProps) {
  const models = useModels();
  const parts = useMemo(() => {
    const top = models.desk.size.y;
    const at = (f: Fixture, dx: number, dy: number, dz: number, extra: Partial<ModelItem> = {}): ModelItem => ({ x: f.x + dx, y: f.y + dy, z: f.z + dz, key: f.key, ...extra });
    const box = (f: Fixture, dx: number, dy: number, dz: number, w: number, h: number, d: number, extra: Partial<BoxItem> = {}): BoxItem => ({ x: f.x + dx, y: f.y + dy, z: f.z + dz, w, h, d, key: f.key, ...extra });
    return {
      desks: desks.map((f) => at(f, 0, 0, 0)),
      screens: desks.map((f) => at(f, 0, top, -0.2)),
      keyboards: desks.map((f) => at(f, 0, top, 0.2, { key: undefined })),
      chairs: desks.map((f) => at(f, 0, 0, 0.95, { key: undefined })),
      agents: models.people.sit.map((_, i) => desks.filter((f) => lookOf(f.key ?? "", hash) === i).map((f) => at(f, 0, SEATED_Y, 0.95))),
      badges: desks.flatMap((f) => (f.skills ?? []).slice(0, 3).map((s, i) => box(f, -0.5 + i * 0.5, top - 0.25, 0.42, 0.3, 0.18, 0.04, { color: new THREE.Color(colorFor(s)) }))),
      carpets: showUnits ? desks.filter((f) => f.unit).map((f) => box(f, 0, 0.03, 0.3, 3, 0.02, 3, { color: new THREE.Color(colorFor(f.unit!)), key: undefined })) : []
    };
  }, [desks, screens, showUnits, models]);
  const display = useMemo<Tint>(() => ({ part: isDisplay, glow: !!screens, colors: desks.map((f) => new THREE.Color(screens?.get(f.key ?? "") ?? SCREEN)) }), [desks, screens]);
  const pick = pickDesk(desks, onPick);
  return (
    <>
      <Boxes items={parts.carpets} />
      <ModelInstances model={models.desk} items={parts.desks} onPick={pick} />
      <ModelInstances model={models.screen} items={parts.screens} onPick={pick} tint={display} />
      <ModelInstances model={models.keyboard} items={parts.keyboards} />
      <ModelInstances model={models.chair} items={parts.chairs} />
      {models.people.sit.map((m, i) => <ModelInstances key={i} model={m} items={parts.agents[i]} onPick={pick} />)}
      <Boxes items={parts.badges} emissive />
    </>
  );
}

// The box desks: a person behind each, the screen in the agent's presence colour, skill badges on
// the front edge and, when asked, a carpet tile in the business unit's colour.
function BoxDesks({ desks, screens, showUnits, onPick }: DesksProps) {
  const parts = useMemo(() => {
    const at = (f: Fixture, dx: number, dy: number, dz: number, w: number, h: number, d: number, extra: Partial<BoxItem> = {}): BoxItem => ({ x: f.x + dx, y: f.y + dy, z: f.z + dz, w, h, d, key: f.key, ...extra });
    return {
      tops: desks.map((f) => at(f, 0, 0.72, 0, 1.8, 0.08, 0.9)),
      legs: desks.map((f) => at(f, 0, 0, 0, 1.6, 0.72, 0.7, { key: undefined })),
      screens: desks.map((f) => at(f, 0, 0.8, -0.25, 0.7, 0.45, 0.05, { color: new THREE.Color(screens?.get(f.key ?? "") ?? SCREEN) })),
      chairs: desks.map((f) => at(f, 0, 0, 0.85, 0.6, 0.5, 0.6, { key: undefined })),
      bodies: desks.map((f) => at(f, 0, 0.5, 0.85, 0.5, 0.75, 0.35)),
      heads: desks.map((f) => at(f, 0, 1.28, 0.85, 0.3, 0.3, 0.3)),
      badges: desks.flatMap((f) => (f.skills ?? []).slice(0, 3).map((s, i) => at(f, -0.5 + i * 0.5, 0.8, 0.46, 0.3, 0.18, 0.04, { color: new THREE.Color(colorFor(s)) }))),
      carpets: showUnits ? desks.filter((f) => f.unit).map((f) => at(f, 0, 0.03, 0.3, 3, 0.02, 3, { color: new THREE.Color(colorFor(f.unit!)), key: undefined })) : []
    };
  }, [desks, screens, showUnits]);
  const pick = pickDesk(desks, onPick);
  return (
    <>
      <Boxes items={parts.carpets} />
      <Boxes items={parts.tops} color={WOOD} onPick={pick} />
      <Boxes items={parts.legs} color="#8b6b4a" />
      <Boxes items={parts.screens} emissive={!!screens} onPick={pick} />
      <Boxes items={parts.chairs} color="#334155" />
      <Boxes items={parts.bodies} color={PERSON} onPick={pick} />
      <Boxes items={parts.heads} color={SKIN} onPick={pick} />
      <Boxes items={parts.badges} emissive />
    </>
  );
}

// Callers: sitting on a room's waiting chairs (standing beside them when they're full) or on a visitor's
// chair beside an agent's desk, on a small mat in their state's colour.
function Callers({ callers }: { callers: Caller[] }) {
  return <ModelsOrBoxes fallback={<BoxCallers callers={callers} />}><ModelCallers callers={callers} /></ModelsOrBoxes>;
}

function ModelCallers({ callers }: { callers: Caller[] }) {
  const models = useModels();
  const parts = useMemo(() => {
    const item = (c: Caller): ModelItem => ({ x: c.at[0], y: c.at[1] + (c.standing ? 0 : SEATED_Y), z: c.at[2], turn: c.turn });
    const pose = (standing: boolean, look: number) => callers.filter((c, i) => c.standing === standing && lookOf(`${c.key}:${i}`, hash) === look).map(item);
    return {
      sit: [0, 1].map((look) => pose(false, look)),
      stand: [0, 1].map((look) => pose(true, look)),
      chairs: callers.filter((c) => c.chair).map((c): ModelItem => ({ x: c.at[0], y: c.at[1], z: c.at[2], turn: c.turn, scale: Math.min(1, 0.78 / models.waitingChair.size.x) })),
      mats: callers.map((c) => ({ x: c.at[0], y: c.at[1] + 0.03, z: c.at[2], w: 0.9, h: 0.02, d: 0.9, color: new THREE.Color(c.color) }))
    };
  }, [callers, models]);
  return (
    <>
      <Boxes items={parts.mats} emissive />
      <ModelInstances model={models.waitingChair} items={parts.chairs} />
      {models.people.sit.map((m, i) => <ModelInstances key={`sit${i}`} model={m} items={parts.sit[i]} />)}
      {models.people.stand.map((m, i) => <ModelInstances key={`stand${i}`} model={m} items={parts.stand[i]} />)}
    </>
  );
}

function BoxCallers({ callers }: { callers: Caller[] }) {
  const parts = useMemo(() => ({
    bodies: callers.map((c) => ({ x: c.at[0], y: c.at[1] + (c.standing ? 0 : 0.45), z: c.at[2], w: 0.45, h: c.standing ? 1.2 : 0.75, d: 0.35, color: new THREE.Color(c.color) })),
    heads: callers.map((c) => ({ x: c.at[0], y: c.at[1] + (c.standing ? 1.25 : 1.22), z: c.at[2], w: 0.3, h: 0.3, d: 0.3, color: new THREE.Color(SKIN) }))
  }), [callers]);
  return <><Boxes items={parts.bodies} /><Boxes items={parts.heads} /></>;
}

// A new caller walking from the way in to the room, then gone.
function WalkerFigure({ walker, blocks }: { walker: Walker; blocks: Rect[] }) {
  return (
    <ModelsOrBoxes fallback={<WalkerMover walker={walker} blocks={blocks}><WalkerBoxes color={walker.color} /></WalkerMover>}>
      <WalkerMover walker={walker} blocks={blocks} turn><WalkerModel walker={walker} /></WalkerMover>
    </ModelsOrBoxes>
  );
}

function WalkerModel({ walker }: { walker: Walker }) {
  const models = useModels();
  const model = models.people.walk[lookOf(walker.id, hash)];
  // Its own materials, so it can turn see-through on its own.
  const materials = useMemo(() => model.parts.map((p) => p.material.clone()), [model]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return (
    <>
      {model.parts.map((p, i) => <mesh key={i} geometry={p.geometry} material={materials[i]} raycast={() => null} />)}
    </>
  );
}

function WalkerBoxes({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 0.6, 0]} raycast={() => null}><boxGeometry args={[0.45, 1.2, 0.35]} /><meshBasicMaterial color={color} /></mesh>
      <mesh position={[0, 1.4, 0]} raycast={() => null}><boxGeometry args={[0.3, 0.3, 0.3]} /><meshBasicMaterial color={SKIN} /></mesh>
    </>
  );
}

// How see-through a walking caller is while passing through furniture.
const THROUGH_OPACITY = 0.3;

// Moves its figure along the walker's way; turn: face the way it goes (the model faces -z unturned).
// Passing through furniture on its way (blocks), it fades to see-through, and back once it's past.
function WalkerMover({ walker, blocks, turn, children }: { walker: Walker; blocks: Rect[]; turn?: boolean; children: React.ReactNode }) {
  const opacity = useRef(1);
  const ref = useRef<THREE.Group>(null);
  const start = useRef<number | undefined>(undefined);
  // Straight from point to point, the way the lines go (a smooth curve would cut corners through walls).
  const curve = useMemo(() => {
    const way = new THREE.CurvePath<THREE.Vector3>();
    const points = walker.points.map((p) => new THREE.Vector3(...p));
    points.slice(1).forEach((q, i) => way.add(new THREE.LineCurve3(points[i], q)));
    return way;
  }, [walker.points]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (start.current === undefined) start.current = clock.getElapsedTime();
    const t = Math.min(1, (clock.getElapsedTime() - start.current) / walker.seconds);
    ref.current.position.copy(curve.getPointAt(t));
    ref.current.position.y += Math.abs(Math.sin(clock.getElapsedTime() * 9)) * 0.08;
    if (turn) { const d = curve.getTangentAt(Math.min(t, 0.999)); ref.current.rotation.y = Math.atan2(-d.x, -d.z); }
    const at = ref.current.position;
    // On the floor only: over a curved line between centers there's nothing to pass through.
    const target = at.y < 1 && inAny(blocks, at.x, at.z) ? THROUGH_OPACITY : 1;
    if (Math.abs(opacity.current - target) > 0.01) {
      opacity.current += (target - opacity.current) * 0.25;
      ref.current.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!m) return;
        m.transparent = opacity.current < 0.99;
        m.opacity = opacity.current;
        m.depthWrite = opacity.current >= 0.99;
      });
    }
    ref.current.visible = t < 1;
  });
  return <group ref={ref}>{children}</group>;
}

// The waiting chairs by each room's door, the person behind each counter, and plants in the lobbies.
function Furnishings({ plan, fixtures, onPick }: { plan: Plan; fixtures: Fixture[]; onPick(key: string): void }) {
  const benches = useMemo(() => fixtures.filter((f) => f.kind === "bench"), [fixtures]);
  const counters = useMemo(() => fixtures.filter((f) => f.kind === "counter"), [fixtures]);
  const lobbies = useMemo(() => plan.areas.filter((a) => a.kind === "lobby"), [plan]);
  return (
    <ModelsOrBoxes fallback={<BoxFurnishings benches={benches} counters={counters} onPick={onPick} />}>
      <ModelFurnishings plan={plan} benches={benches} counters={counters} lobbies={lobbies} onPick={onPick} />
    </ModelsOrBoxes>
  );
}

function ModelFurnishings({ plan, benches, counters, lobbies, onPick }: { plan: Plan; benches: Fixture[]; counters: Fixture[]; lobbies: Area[]; onPick(key: string): void }) {
  const models = useModels();
  const parts = useMemo(() => {
    // A chair per seat; narrower when the model is wider than the space a seat has.
    const fit = Math.min(1, 0.78 / models.waitingChair.size.x);
    const seats = benches.flatMap((f) => (plan.chairs.get(f.key ?? "") ?? []).map((s): ModelItem => ({ x: s[0], y: f.y, z: s[2], key: f.key, scale: fit })));
    // The receptionist stands behind the counter, facing the entrance.
    const staff = [0, 1].map((look) => counters.filter((f) => lookOf(f.key ?? "", hash) === look).map((f): ModelItem => ({ x: f.x, y: f.y, z: f.z - 1.1, key: f.key, turn: Math.PI })));
    const plants = lobbyPlants(plan).map((p): ModelItem => ({ x: p[0], y: p[1], z: p[2] }));
    return { seats, staff, plants };
  }, [plan, benches, counters, lobbies, models]);
  const pick = (key: string | undefined) => { if (key) onPick(key); };
  return (
    <>
      <ModelInstances model={models.waitingChair} items={parts.seats} onPick={pick} />
      {models.people.stand.map((m, i) => <ModelInstances key={i} model={m} items={parts.staff[i]} onPick={pick} />)}
      <ModelInstances model={models.plant} items={parts.plants} />
    </>
  );
}

// Without the models: a bench by each door and a block person behind each counter.
function BoxFurnishings({ benches, counters, onPick }: { benches: Fixture[]; counters: Fixture[]; onPick(key: string): void }) {
  const parts = useMemo(() => ({
    seats: benches.flatMap((f): BoxItem[] => [
      { x: f.x, y: f.y + 0.41, z: f.z, w: f.w ?? 3, h: 0.08, d: 0.55, key: f.key },
      { x: f.x, y: f.y + 0.48, z: f.z + 0.25, w: f.w ?? 3, h: 0.55, d: 0.08, key: f.key }
    ]),
    legs: benches.flatMap((f): BoxItem[] => [-1, 1].map((sx) => ({ x: f.x + sx * ((f.w ?? 3) / 2 - 0.2), y: f.y, z: f.z, w: 0.1, h: 0.42, d: 0.45 }))),
    bodies: counters.map((f): BoxItem => ({ x: f.x, y: f.y, z: f.z - 1.1, w: 0.5, h: 1.1, d: 0.4, key: f.key })),
    heads: counters.map((f): BoxItem => ({ x: f.x, y: f.y + 1.1, z: f.z - 1.1, w: 0.3, h: 0.3, d: 0.3, key: f.key }))
  }), [benches, counters]);
  const pick = (key: string | undefined) => { if (key) onPick(key); };
  return (
    <>
      <Boxes items={parts.seats} color="#0369a1" onPick={pick} />
      <Boxes items={parts.legs} color="#334155" />
      <Boxes items={parts.bodies} color={PERSON} onPick={pick} />
      <Boxes items={parts.heads} color={SKIN} onPick={pick} />
    </>
  );
}

// The few-of-a-kind fixtures, each its own small model.
function FixtureModel({ f, onPick }: { f: Fixture; onPick(key: string): void }) {
  const click = (e: ThreeEvent<MouseEvent>) => { if (e.delta > 4 || !f.key) return; e.stopPropagation(); onPick(f.key); };
  const box = (pos: Vec3, size: Vec3, color: string, extra?: Partial<THREE.MeshStandardMaterialParameters>) => (
    <mesh position={pos} onClick={click}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.7} {...extra} />
    </mesh>
  );
  const kind: FixtureKind = f.kind;
  return (
    <group position={[f.x, f.y, f.z]}>
      {kind === "door" && <>{box([-1.25, 1.3, 0], [0.18, 2.6, 0.35], "#64748b")}{box([1.25, 1.3, 0], [0.18, 2.6, 0.35], "#64748b")}{box([0, 2.65, 0], [2.7, 0.2, 0.35], "#64748b")}{box([0, 0.02, -0.8], [2.2, 0.04, 1.2], "#94a3b8")}</>}
      {kind === "reception" && <>{box([0, 0.55, 0], [f.w ?? 4.2, 1.1, 1], "#e2e8f0")}{box([0, 1.12, 0.1], [(f.w ?? 4.2) + 0.2, 0.06, 1.2], WOOD)}</>}
      {kind === "counter" && <>
        {box([0, 1.18, 0.15], [f.w ?? 3, 0.08, 0.9], "#0ea5e9", { emissive: "#0ea5e9", emissiveIntensity: 0.25 })}
        {/* The context variables a call brings: a clipboard on the counter. */}
        {(f.variables?.length ?? 0) > 0 && <>{box([0.9, 1.24, 0.35], [0.45, 0.04, 0.6], "#f8fafc")}{box([0.9, 1.27, 0.12], [0.2, 0.03, 0.08], "#475569")}</>}
      </>}
      {/* The digital channels' screen, just inside the front wall, lit side facing into the lobby. */}
      {kind === "portal" && <>{box([0, 2, 0], [6, 2.6, 0.2], "#1e293b")}{box([0, 2, -0.12], [5.6, 2.2, 0.05], "#38bdf8", { emissive: "#38bdf8", emissiveIntensity: 0.5 })}</>}
      {kind === "kiosk" && <>{box([0, 0.7, 0], [0.7, 1.4, 0.5], "#a855f7")}{box([0, 1.55, 0.1], [0.8, 0.55, 0.08], "#ede9fe", { emissive: "#c4b5fd", emissiveIntensity: 0.6 })}</>}
      {kind === "signpost" && <>{box([0, 1, 0], [0.12, 2, 0.12], "#475569")}{box([0, 1.85, 0], [1.6, 0.5, 0.08], "#be123c")}</>}
      {kind === "hours" && box([0, 2.1, 0.05], [0.9, 0.6, 0.06], "#0f172a")}
      {kind === "mailbox" && <>{box([0, 0.55, 0], [0.1, 1.1, 0.1], "#475569")}{box([0, 1.2, 0], [0.55, 0.4, 0.4], "#dc2626")}</>}
      {kind === "booth" && box([0, 1.2, 0], [1, 2.4, 1], "#38bdf8", { transparent: true, opacity: 0.55 })}
      {kind === "exit" && <>{box([0, 2.3, 0], [1, 0.35, 0.08], "#16a34a", { emissive: "#22c55e", emissiveIntensity: 0.4 })}{box([0, 1.1, 0], [0.1, 2.2, 0.1], "#475569")}</>}
      {kind === "transfer" && <>{box([-1.2, 1.15, 0], [0.16, 2.3, 0.3], "#7c3aed")}{box([1.2, 1.15, 0], [0.16, 2.3, 0.3], "#7c3aed")}{box([0, 2.35, 0], [2.56, 0.18, 0.3], "#7c3aed")}{box([0, 0.02, 0], [2.2, 0.04, 1], "#c4b5fd")}</>}
      {/* A standing sign behind the front desk: no routing rules, so one way only. */}
      {kind === "notice" && <>{box([0, 0.8, 0], [0.08, 1.6, 0.08], "#475569")}{box([0, 1.6, 0], [1.2, 0.6, 0.06], "#f59e0b", { emissive: "#f59e0b", emissiveIntensity: 0.3 })}</>}
      {kind === "hold" && box([0, 0.5, 0], [0.8, 1, 0.8], "#f59e0b")}
    </group>
  );
}

// Where along a line (0 start, 1 end) arrowheads sit on a curved line, pointing the way it goes.
const ARROWS_AT = [0.3, 0.55, 0.8, 0.95];
const UP = new THREE.Vector3(0, 1, 0);

// A point and direction a fraction of the way along a polyline, by length.
export function alongLine(points: Vec3[], t: number): { at: Vec3; direction: Vec3 } {
  const lengths = points.slice(1).map((q, i) => Math.hypot(q[0] - points[i][0], q[1] - points[i][1], q[2] - points[i][2]));
  let rest = lengths.reduce((s, l) => s + l, 0) * t;
  for (let i = 0; i < lengths.length; i++) {
    if (rest <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? Math.min(1, rest / lengths[i]) : 0;
      const [a, b] = [points[i], points[i + 1]];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const n = Math.hypot(...d) || 1;
      return { at: [a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f], direction: [d[0] / n, d[1] / n, d[2] / n] };
    }
    rest -= lengths[i];
  }
  return { at: points[points.length - 1], direction: [0, 0, 1] };
}

// The labels inside buildings, near the camera only. They're all placed once; a few times a second
// each is shown or hidden by its distance to the camera, without redrawing anything.
interface NearLabel { key: string; at: Vec3; range: number; className: string; style?: React.CSSProperties; text: React.ReactNode }

function NearbyLabels({ plan, shown, labelSuffix }: { plan: Plan; shown(item: { wing?: Wing }): boolean; labelSuffix?: Map<string, string> }) {
  const camera = useThree((st) => st.camera);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const last = useRef(-1);
  const heightOf = (kind: FixtureKind) => (kind === "numbers" ? 3.4 : kind === "signpost" ? 2.5 : kind === "counter" ? 1.9 : kind === "portal" ? 3.8 : kind === "notice" ? 2.3 : 2.6);
  const labels = useMemo((): NearLabel[] => [
    ...plan.areas.filter((a) => a.kind === "wing" && shown(a)).map((a) => ({
      key: `wing:${a.centerId}:${a.wing}`, at: [a.x, 0.3, a.z + a.d / 2 - 1.2] as Vec3, range: ROOM_LABEL_RANGE,
      className: "wing-label", style: { background: WING_COLORS[a.wing!] }, text: a.name
    })),
    ...plan.areas.filter((a) => a.kind === "room" && shown(a)).map((a) => ({
      key: `room:${a.key}`, at: [a.x, 0.2, a.z + a.d / 2 - 0.8] as Vec3, range: ROOM_LABEL_RANGE, className: "area-label room",
      text: <>{a.name}{a.tag && <span className="tag"> · {a.tag}</span>}{labelSuffix?.get(a.key ?? "") && <span className="suffix"> · {labelSuffix.get(a.key ?? "")}</span>}</>
    })),
    ...plan.fixtures.filter((f) => LABELLED.includes(f.kind) && f.label && shown(f)).map((f, i) => ({
      key: `label:${f.kind}:${f.key ?? i}:${f.x}:${f.z}`, at: [f.x, f.y + heightOf(f.kind), f.z] as Vec3,
      range: f.kind === "numbers" || f.kind === "counter" ? SMALL_LABEL_RANGE : SIGN_LABEL_RANGE, className: `fixture-label ${f.kind}`, text: f.label
    }))
  ], [plan, shown, labelSuffix]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (t - last.current < 0.2 && last.current >= 0) return;
    last.current = t;
    const p = camera.position;
    labels.forEach((l) => {
      const node = nodes.current.get(l.key);
      if (node) node.style.display = Math.hypot(l.at[0] - p.x, l.at[1] - p.y, l.at[2] - p.z) < l.range ? "" : "none";
    });
  });
  return (
    <>
      {labels.map((l) => (
        <Html key={l.key} position={l.at} center zIndexRange={[15, 5]} style={{ pointerEvents: "none" }}>
          <div ref={(el) => { if (el) nodes.current.set(l.key, el); else nodes.current.delete(l.key); }} className={l.className} style={{ display: "none", ...l.style }}>{l.text}</div>
        </Html>
      ))}
    </>
  );
}

function PathLine({ path }: { path: Path }) {
  const style = PATH_STYLE[path.kind];
  // A line that leaves the floor (between buildings) gets arrowheads in its own colour.
  const curved = path.points.some((q) => q[1] > 1.5);
  const arrows = useMemo(() => (curved ? ARROWS_AT.map((t) => {
    const { at, direction } = alongLine(path.points, t);
    return { at, turn: new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(...direction)) };
  }) : []), [path.points, curved]);
  return (
    <>
      <Line points={path.points} color={style.color} lineWidth={style.width} dashed={style.dashed} dashSize={1} gapSize={0.6} transparent opacity={path.kind === "default" ? 0.6 : 1} />
      {arrows.map((a, i) => (
        <mesh key={i} position={a.at} quaternion={a.turn} raycast={() => null}>
          <coneGeometry args={[path.kind === "default" ? 0.5 : 0.7, path.kind === "default" ? 1.4 : 1.8, 12]} />
          <meshBasicMaterial color={style.color} transparent opacity={path.kind === "default" ? 0.7 : 1} />
        </mesh>
      ))}
    </>
  );
}

export function CampusScene({ plan, mode, goal, selected, selectedSpot, wing, showUnits, issues, screens, callers, walkers, labelSuffix, ride, handle, onSelect }: Props): React.ReactElement {
  const shown = useMemo(() => (item: { wing?: Wing }) => !wing || !item.wing || item.wing === wing, [wing]);
  const floors = useMemo(() => plan.areas.filter(shown).map((a) => ({
    x: a.x, y: a.y + (a.kind === "building" ? 0 : a.kind === "wing" ? 0.015 : 0.03), z: a.z, w: a.w, h: a.kind === "building" ? 0.08 : 0.04, d: a.d,
    color: a.kind === "wing" && a.wing ? tint(WING_COLORS[a.wing], 0.82) : tint(a.color, AREA_TINT[a.kind]),
    key: a.kind === "building" ? `center:${a.centerId}` : a.key
  })), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const walls = useMemo(() => plan.walls.filter(shown).map((w: Wall) => ({ x: w.x, y: w.y, z: w.z, w: w.w, h: w.h, d: w.d })), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const desks = useMemo(() => plan.fixtures.filter((f) => f.kind === "desk" && shown(f)), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = useMemo(() => plan.fixtures.filter((f) => f.kind !== "desk" && f.kind !== "numbers" && shown(f)), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const paths = useMemo(() => plan.paths.filter(shown), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const wingOfRoom = useMemo(() => new Map(plan.areas.filter((a) => a.kind === "room").map((a) => [a.key, a.wing])), [plan]);
  const blocks = useMemo(() => obstacles(plan), [plan]);

  const selectedAt = selected ? selectedSpot ?? plan.anchors.get(selected) : undefined;
  const markers = useMemo(() => [...(issues ?? new Map<string, Severity>()).entries()].map(([k, s]) => ({ key: k, severity: s, at: plan.anchors.get(k) })).filter((m): m is { key: string; severity: Severity; at: Vec3 } => !!m.at), [issues, plan]);
  const pick = (key: string | undefined) => { if (key) onSelect(key); };

  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [plan.bounds.x, 120, plan.bounds.z + 160], fov: 50, near: 0.3, far: 5000 }}>
      <color attach="background" args={[SKY]} />
      <hemisphereLight args={["#ffffff", "#94a3b8", 0.9]} />
      <directionalLight position={[80, 160, 120]} intensity={1.4} />
      <directionalLight position={[-120, 80, -60]} intensity={0.4} />

      <Boxes items={floors} onPick={pick} />
      <Boxes items={walls} color={WALL} opacity={0.92} />
      <Desks desks={desks} screens={screens} showUnits={showUnits} onPick={onSelect} />
      {others.filter((f) => f.kind !== "bench").map((f, i) => <FixtureModel key={`${f.kind}:${f.key ?? i}:${i}`} f={f} onPick={onSelect} />)}
      <Furnishings plan={plan} fixtures={others} onPick={onSelect} />
      {paths.map((p, i) => <PathLine key={i} path={p} />)}
      {callers && <Callers callers={callers.filter((c) => shown({ wing: wingOfRoom.get(c.key) }))} />}
      {walkers?.map((w) => <WalkerFigure key={w.id} walker={w} blocks={blocks} />)}

      {/* Names: every building and wing; inside, the center in focus. */}
      {plan.buildings.map((b) => (
        <Html key={b.centerId} position={[b.x + b.w / 2, 5, b.z + 1]} center zIndexRange={[20, 10]}>
          <button className="building-label" style={{ borderColor: b.color }} onClick={() => onSelect(`center:${b.centerId}`)}>{b.name}</button>
        </Html>
      ))}
      <NearbyLabels plan={plan} shown={shown} labelSuffix={labelSuffix} />

      {markers.map((m) => (
        <mesh key={m.key} position={[m.at[0], m.at[1] + 2.6, m.at[2]]} raycast={() => null} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.6, 1.2, 3]} />
          <meshBasicMaterial color={SEVERITY_COLORS[m.severity]} />
        </mesh>
      ))}
      {selectedAt && (
        <mesh position={[selectedAt[0], 0.1, selectedAt[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[1.6, 2, 48]} />
          <meshBasicMaterial color="#0ea5e9" />
        </mesh>
      )}

      {mode === "orbit" && !ride && <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2.05} maxDistance={2500} />}
      <CameraRig mode={ride ? "walk" : mode} goal={goal} handle={handle} ride={ride} depth={1} rideScale={0.3} />
    </Canvas>
  );
}
