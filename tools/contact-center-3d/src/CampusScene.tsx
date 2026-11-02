// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, Vignette } from "@react-three/postprocessing";
import { Severity } from "../../environment-3d-explorer/src/health";
import { hash } from "../../environment-3d-explorer/src/layout";
import { CameraGoal, CameraRig, Mode, Ride, SceneHandle } from "../../environment-3d-explorer/src/Scene";
import { Area, Fixture, FixtureKind, Path, PathKind, Plan, Vec3, Wall, Wing, WING_COLORS } from "./floorplan";
import { isDisplay, lookOf, Model, Models, useModels } from "./models";
import { inAny, lobbyPlants, obstacles, Rect } from "./walk";

// The campus in 3D: each customer center an open-roofed building on a floating platform, seen from
// above like an architect's model, in deep blue with glowing edges and lines. Floors, walls and desks
// are instanced, so a large center stays smooth.

// Deep navy behind and below the campus; the fog fades far buildings into it.
export const SKY = "#0d1838";
// A narrow camera angle, close to isometric: little perspective, so nothing near the camera blows up.
// Camera distances are this many times what they were at the old 50 degrees.
export const FOV = 28;
export const CAMERA_DISTANCE = Math.tan((50 / 2) * Math.PI / 180) / Math.tan((FOV / 2) * Math.PI / 180);
const WALL = "#8fd3ff";
const WOOD = "#dbe6f5";
const SCREEN = "#17325e";
const PERSON = "#e6edf8";
const SKIN = "#eef3fb";
// What glows (edges, lines, lit screens) is drawn brighter than white, so only it blooms.
const GLOW = 2.4;
const EDGE = "#38bdf8";
const glow = (color: string, k = GLOW) => new THREE.Color(color).multiplyScalar(k);
// Floors by kind, in blues; an area's own colour (its center or wing) shows through a little.
const FLOOR: Record<Area["kind"], string> = { building: "#163866", entrance: "#1f4a86", lobby: "#1d467f", corridor: "#183d70", wing: "#1a4176", room: "#21508f" };
const AREA_MIX: Record<Area["kind"], number> = { building: 0.03, entrance: 0.05, lobby: 0.05, corridor: 0.03, wing: 0.07, room: 0.05 };

export const SEVERITY_COLORS: Record<Severity, string> = { problem: "#ef4444", warning: "#f59e0b" };

// The lines' looks; the page's legend explains them from the same list.
export const PATH_STYLE: Record<PathKind, { color: string; dashed: boolean; width: number; label: string }> = {
  route: { color: "#38bdf8", dashed: false, width: 2, label: "Routing rule to its room" },
  only: { color: "#22d3ee", dashed: false, width: 2, label: "Only route: workstream's default queue (no routing rules)" },
  skybridge: { color: "#7dd3fc", dashed: false, width: 2.2, label: "Routing rule to a room in another customer center (skybridge)" },
  default: { color: "#60a5fa", dashed: true, width: 1, label: "Workstream's default queue (bright when the workstream is selected)" },
  transfer: { color: "#e879f9", dashed: true, width: 1.4, label: "Overflow: transfer to another queue" }
};
// Labels keep one small size. Inside a building they only show when the camera is this close (metres),
// so the campus from afar isn't a heap of labels and labels near you stay readable while exploring.
const ROOM_LABEL_RANGE = 280;
const SIGN_LABEL_RANGE = 90;
const SMALL_LABEL_RANGE = 60;
// How high a room's card floats above its front edge.
const CARD_Y = 6.5;
const LABELLED: FixtureKind[] = ["signpost", "numbers", "hours", "mailbox", "booth", "exit", "transfer", "hold", "kiosk", "counter", "portal", "notice"];
const PALETTE = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa", "#a78bfa", "#f472b6", "#94a3b8", "#c084fc"];
export const colorFor = (name: string) => PALETTE[Math.floor(((hash(name, 21) + 1) / 2) * PALETTE.length) % PALETTE.length];

// turn: which way they face (0: into the room, away from its front; Math.PI / 2: towards -x, e.g. from
// beside a desk towards the agent). chair: they bring their own (a visitor's chair beside a desk).
export interface Caller { key: string; at: Vec3; color: string; standing: boolean; turn?: number; chair?: boolean }
// seconds: how long the walk takes; until: when it's there (ms since 1970), for the page to let it go.
export interface Walker { id: string; points: Vec3[]; color: string; seconds: number; until: number }

interface Props {
  // The camera slowly circles what it looks at (during the guided tour, so no step stands still).
  drift?: boolean;
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
      agents: models.people.sit.map((_, i) => desks.filter((f) => lookOf(f.key ?? "", hash) === i).map((f) => at(f, 0, SEATED_Y, 0.78))),
      badges: desks.flatMap((f) => (f.skills ?? []).slice(0, 3).map((s, i) => box(f, -0.5 + i * 0.5, top - 0.25, 0.42, 0.3, 0.18, 0.04, { color: glow(colorFor(s), 1.3) }))),
      carpets: showUnits ? desks.filter((f) => f.unit).map((f) => box(f, 0, 0.03, 0.3, 3, 0.02, 3, { color: new THREE.Color(colorFor(f.unit!)), key: undefined })) : []
    };
  }, [desks, screens, showUnits, models]);
  const display = useMemo<Tint>(() => ({ part: isDisplay, glow: true, colors: desks.map((f) => (screens?.get(f.key ?? "") ? new THREE.Color(screens.get(f.key ?? "")!).lerp(new THREE.Color(SCREEN), 0.3).multiplyScalar(1.05) : new THREE.Color(SCREEN).multiplyScalar(0.9))) }), [desks, screens]);
  const pick = pickDesk(desks, onPick);
  return (
    <>
      <Boxes items={parts.carpets} />
      <ModelInstances model={models.desk} items={parts.desks} onPick={pick} />
      <ModelInstances model={models.screen} items={parts.screens} onPick={pick} tint={display} />
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
      mats: callers.map((c) => ({ x: c.at[0], y: c.at[1] + 0.03, z: c.at[2], w: 0.9, h: 0.02, d: 0.9, color: glow(c.color, 1.6) }))
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
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.15} {...extra} />
    </mesh>
  );
  // A lit part: drawn brighter than white, so it glows.
  const lit = (pos: Vec3, size: Vec3, color: string, k = GLOW) => (
    <mesh position={pos} onClick={click}>
      <boxGeometry args={size} />
      <meshBasicMaterial color={glow(color, k)} toneMapped={false} />
    </mesh>
  );
  const BODY = "#cfdbeb", DARK = "#3c5179";
  const kind: FixtureKind = f.kind;
  return (
    <group position={[f.x, f.y, f.z]}>
      {kind === "door" && <>{box([-1.25, 1.3, 0], [0.18, 2.6, 0.35], DARK)}{box([1.25, 1.3, 0], [0.18, 2.6, 0.35], DARK)}{box([0, 2.65, 0], [2.7, 0.2, 0.35], DARK)}{lit([0, 2.78, 0], [2.7, 0.05, 0.36], EDGE)}{lit([0, 0.03, -0.8], [2.2, 0.03, 1.2], "#1e6fb8", 1)}</>}
      {kind === "reception" && <>{box([0, 0.55, 0], [f.w ?? 4.2, 1.1, 1], BODY)}{box([0, 1.12, 0.1], [(f.w ?? 4.2) + 0.2, 0.06, 1.2], WOOD)}{lit([0, 0.3, 0.51], [(f.w ?? 4.2) - 0.2, 0.04, 0.02], EDGE)}</>}
      {kind === "counter" && <>
        {box([0, 1.18, 0.15], [f.w ?? 3, 0.08, 0.9], BODY)}
        {lit([0, 1.13, 0.61], [f.w ?? 3, 0.03, 0.02], EDGE)}
        {/* The context variables a call brings: a clipboard on the counter. */}
        {(f.variables?.length ?? 0) > 0 && <>{box([0.9, 1.24, 0.35], [0.45, 0.04, 0.6], "#f8fafc")}{lit([0.9, 1.27, 0.12], [0.2, 0.03, 0.08], "#fcd34d", 1.6)}</>}
      </>}
      {/* The digital channels' screen, just inside the front wall, lit side facing into the lobby. */}
      {kind === "portal" && <>
        {box([0, 2, 0], [6, 2.6, 0.2], "#16233f")}
        {box([0, 2, -0.11], [5.6, 2.2, 0.04], "#0b2350", { emissive: "#0b3a7a", emissiveIntensity: 0.6 })}
        {/* A display: a thin lit border and a faint grid of light. */}
        {lit([0, 3.1, -0.14], [5.6, 0.03, 0.02], EDGE, 1.6)}{lit([0, 0.9, -0.14], [5.6, 0.03, 0.02], EDGE, 1.6)}
        {lit([-2.8, 2, -0.14], [0.03, 2.2, 0.02], EDGE, 1.6)}{lit([2.8, 2, -0.14], [0.03, 2.2, 0.02], EDGE, 1.6)}
        {[1.45, 2, 2.55].map((y) => <React.Fragment key={y}>{lit([0, y, -0.14], [5.4, 0.015, 0.02], "#38bdf8", 0.9)}</React.Fragment>)}
        {[-1.4, 0, 1.4].map((x) => <React.Fragment key={x}>{lit([x, 2, -0.14], [0.015, 2, 0.02], "#38bdf8", 0.9)}</React.Fragment>)}
      </>}
      {kind === "kiosk" && <>{box([0, 0.7, 0], [0.7, 1.4, 0.5], BODY)}{lit([0, 1.55, 0.1], [0.8, 0.55, 0.08], "#a78bfa", 1.6)}</>}
      {kind === "signpost" && <>{box([0, 1, 0], [0.12, 2, 0.12], DARK)}{box([0, 1.85, 0], [1.6, 0.5, 0.08], DARK)}{lit([0, 1.85, 0.05], [1.5, 0.08, 0.02], PATH_STYLE.route.color)}</>}
      {kind === "hours" && <>{box([0, 2.1, 0.05], [0.9, 0.6, 0.06], DARK)}{lit([0, 2.1, 0.09], [0.7, 0.04, 0.02], "#e2e8f0", 1.4)}</>}
      {kind === "mailbox" && <>{box([0, 0.55, 0], [0.1, 1.1, 0.1], DARK)}{box([0, 1.2, 0], [0.55, 0.4, 0.4], BODY)}{lit([0, 1.42, 0], [0.56, 0.04, 0.41], "#f97316")}</>}
      {kind === "booth" && <>{box([0, 1.2, 0], [1, 2.4, 1], "#8fd3ff", { transparent: true, opacity: 0.25 })}{lit([0, 2.42, 0], [1.02, 0.04, 1.02], EDGE)}</>}
      {kind === "exit" && <>{lit([0, 2.3, 0], [1, 0.35, 0.08], "#22c55e", 1.6)}{box([0, 1.1, 0], [0.1, 2.2, 0.1], DARK)}</>}
      {kind === "transfer" && <>{box([-1.2, 1.15, 0], [0.16, 2.3, 0.3], DARK)}{box([1.2, 1.15, 0], [0.16, 2.3, 0.3], DARK)}{box([0, 2.35, 0], [2.56, 0.18, 0.3], DARK)}{lit([0, 2.47, 0], [2.56, 0.05, 0.31], PATH_STYLE.transfer.color)}{lit([0, 0.03, 0], [2.2, 0.03, 1], "#9d3a78", 1)}</>}
      {/* A standing sign behind the front desk: no routing rules, so one way only. */}
      {kind === "notice" && <>{box([0, 0.8, 0], [0.08, 1.6, 0.08], DARK)}{box([0, 1.6, 0], [1.2, 0.6, 0.06], DARK)}{lit([0, 1.6, 0.04], [1.1, 0.06, 0.02], PATH_STYLE.only.color)}</>}
      {kind === "hold" && <>{box([0, 0.5, 0], [0.8, 1, 0.8], BODY)}{lit([0, 1.02, 0], [0.82, 0.04, 0.82], "#fbbf24")}</>}
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
interface NearLabel { key: string; at: Vec3; range: number; className: string; style?: React.CSSProperties; text: React.ReactNode; from?: number }

function NearbyLabels({ plan, shown, labelSuffix }: { plan: Plan; shown(item: { wing?: Wing }): boolean; labelSuffix?: Map<string, string> }) {
  const camera = useThree((st) => st.camera);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const last = useRef(-1);
  const heightOf = (kind: FixtureKind) => (kind === "numbers" ? 3.4 : kind === "signpost" ? 2.5 : kind === "counter" ? 1.9 : kind === "portal" ? 3.8 : kind === "notice" ? 2.3 : 2.6);
  const labels = useMemo((): NearLabel[] => [
    ...plan.areas.filter((a) => a.kind === "wing" && shown(a)).map((a) => ({
      key: `wing:${a.centerId}:${a.wing}`, at: [a.x, 0.3, a.z + a.d / 2 - 1.2] as Vec3, range: ROOM_LABEL_RANGE * 3, from: ROOM_LABEL_RANGE,
      className: "wing-label", style: { borderLeftColor: WING_COLORS[a.wing!] }, text: a.name
    })),
    ...plan.areas.filter((a) => a.kind === "room" && shown(a)).map((a) => ({
      key: `room:${a.key}`, at: [a.x, CARD_Y, a.z + a.d / 2 - 1.2] as Vec3, range: ROOM_LABEL_RANGE, className: "holo-card",
      text: <><span className="holo-name">{a.name}</span>{(a.tag || labelSuffix?.get(a.key ?? "")) && <span className="holo-sub">{[a.tag, labelSuffix?.get(a.key ?? "")].filter(Boolean).join(" · ")}</span>}</>
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
      const d = Math.hypot(l.at[0] - p.x, l.at[1] - p.y, l.at[2] - p.z);
      if (node) node.style.display = d < l.range && d >= (l.from ?? 0) ? "" : "none";
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

function PathLine({ path, highlight }: { path: Path; highlight?: boolean }) {
  const style = PATH_STYLE[path.kind];
  // A line that leaves the floor (between buildings) gets arrowheads in its own colour.
  const curved = path.points.some((q) => q[1] > 1.5);
  const arrows = useMemo(() => (curved ? ARROWS_AT.map((t) => {
    const { at, direction } = alongLine(path.points, t);
    return { at, turn: new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(...direction)) };
  }) : []), [path.points, curved]);
  void arrows;
  // The default queue's line stays faint, unless its workstream is selected.
  const faint = path.kind === "default" && !highlight;
  const core = useMemo(() => (faint ? new THREE.Color(style.color) : glow(style.color, path.kind === "default" ? 1.6 : 2)), [style.color, path.kind, faint]);
  return (
    <>
      {!style.dashed ? (
        <>
          <Line points={path.points} color={core} lineWidth={curved ? 2.4 : 2} toneMapped={false} />
          <Line points={path.points} color={style.color} lineWidth={curved ? 7 : 6} transparent opacity={0.1} depthWrite={false} />
        </>
      ) : (
        <Line points={path.points} color={core} lineWidth={faint ? 0.8 : style.width} dashed={style.dashed} dashSize={0.8} gapSize={0.8} toneMapped={false} transparent opacity={faint ? 0.28 : 1} />
      )}
    </>
  );
}

// Light pulses running along the lines, the way a call goes: a few per line, by its length.
function FlowPulses({ paths }: { paths: Path[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const runs = useMemo(() => paths.filter((p) => p.kind !== "default" && p.points.length > 1).map((p) => {
    const lengths = p.points.slice(1).map((q, i) => Math.hypot(q[0] - p.points[i][0], q[1] - p.points[i][1], q[2] - p.points[i][2]));
    const total = lengths.reduce((a, b) => a + b, 0);
    return { points: p.points, lengths, total, count: Math.max(1, Math.min(4, Math.round(total / 28))), color: glow(PATH_STYLE[p.kind].color, 3), seed: (hash(p.points.map((x) => x.join(",")).join(";"), 3) + 1) / 2 };
  }).filter((r) => r.total > 1), [paths]);
  const pulses = useMemo(() => runs.flatMap((r) => Array.from({ length: r.count }, (_, i) => ({ run: r, offset: (r.seed + i / r.count) % 1 }))), [runs]);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.16, 12, 10), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    pulses.forEach((p, i) => mesh.setColorAt(i, p.run.color));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [pulses]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.getElapsedTime();
    pulses.forEach((p, i) => {
      const { run } = p;
      // About 9 metres a second, whatever the line's length.
      let rest = (((t * 9) / run.total + p.offset) % 1) * run.total;
      let at = run.points[run.points.length - 1];
      for (let s = 0; s < run.lengths.length; s++) {
        if (rest <= run.lengths[s]) {
          const f = run.lengths[s] ? rest / run.lengths[s] : 0;
          const [a, b] = [run.points[s], run.points[s + 1]];
          at = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
          break;
        }
        rest -= run.lengths[s];
      }
      m.makeTranslation(at[0], at[1], at[2]);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  if (!pulses.length) return null;
  return (
    <instancedMesh key={pulses.length} ref={ref} args={[geometry, undefined, pulses.length]} raycast={() => null} frustumCulled={false}>
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

// A glowing ring on the floor at each building's way in, slowly breathing.
function EntranceRings({ doors }: { doors: Fixture[] }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const k = 1 + 0.08 * Math.sin(clock.getElapsedTime() * 2);
    group.current?.children.forEach((c) => c.scale.set(k, k, 1));
  });
  const color = useMemo(() => glow("#38bdf8", 2.2), []);
  return (
    <group ref={group}>
      {doors.map((d, i) => (
        <mesh key={i} position={[d.x, 0.12, d.z - 0.8]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[1.25, 1.4, 48]} />
          <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// The sky: a vertical gradient, deep violet-navy at the top to navy at the horizon, behind everything.
function GradientSky() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4; canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#1c1a4a");
    g.addColorStop(0.55, "#0f1d45");
    g.addColorStop(1, "#0a1632");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <primitive attach="background" object={texture} />;
}

// Circuit traces on the platforms' floors: thin lines and pads, faint, like the examples' boards.
function circuitTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  ctx.strokeStyle = "rgba(125, 211, 252, 0.5)";
  ctx.fillStyle = "rgba(125, 211, 252, 0.7)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 46; i++) {
    let x = Math.round(rnd() * 16) * 32, y = Math.round(rnd() * 16) * 32;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      const len = (1 + Math.floor(rnd() * 3)) * 32;
      if (rnd() > 0.5) x += rnd() > 0.5 ? len : -len; else y += rnd() > 0.5 ? len : -len;
      // A 45-degree bend now and then.
      if (rnd() > 0.7) { x += 16; y += 16; }
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function CircuitFloors({ buildings }: { buildings: Area[] }) {
  const texture = useMemo(() => circuitTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <>
      {buildings.map((b) => {
        const map = texture.clone();
        map.needsUpdate = true;
        map.repeat.set(b.w / 40, b.d / 40);
        return (
          <mesh key={b.key ?? b.centerId} position={[b.x, 0.11, b.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <planeGeometry args={[b.w, b.d]} />
            <meshBasicMaterial map={map} transparent opacity={0.32} depthWrite={false} />
          </mesh>
        );
      })}
    </>
  );
}

// A room without desks (its agents aren't drawn, or it has none) shows faint desk places on its floor.
function DeskPlaces({ rooms, desks }: { rooms: Area[]; desks: Fixture[] }) {
  const items = useMemo(() => rooms
    .filter((a) => !desks.some((f) => Math.abs(f.x - a.x) <= a.w / 2 && Math.abs(f.z - a.z) <= a.d / 2))
    .flatMap((a) => {
      const cols = Math.max(1, Math.min(4, Math.floor((a.w - 3) / 3.2)));
      const rows = Math.max(1, Math.min(3, Math.floor((a.d - 5) / 3.4)));
      return Array.from({ length: cols * rows }, (_, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        return { x: a.x + (c - (cols - 1) / 2) * 3.2, y: 0.09, z: a.z - 0.6 + (r - (rows - 1) / 2) * 3.4, w: 1.8, h: 0.02, d: 0.9, color: new THREE.Color("#3b6fb6") };
      });
    }), [rooms, desks]);
  return <Boxes items={items} opacity={0.5} />;
}

// Thin lit stems from a room's front edge up to its floating card.
function CardStems({ rooms }: { rooms: Area[] }) {
  const items = useMemo(() => rooms.map((a) => ({ x: a.x, y: 0.1, z: a.z + a.d / 2 - 1.2, w: 0.05, h: CARD_Y - 0.6, d: 0.05, color: glow("#7dd3fc", 1.3) })), [rooms]);
  return <Boxes items={items} emissive />;
}

// The floor under the campus: a faint blue grid with dots, like a circuit board, fading into the fog.
function GridFloor({ plan }: { plan: Plan }) {
  const texture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(96, 165, 250, 0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    ctx.strokeStyle = "rgba(96, 165, 250, 0.08)";
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * size / 4, 0); ctx.lineTo(i * size / 4, size); ctx.moveTo(0, i * size / 4); ctx.lineTo(size, i * size / 4); ctx.stroke(); }
    ctx.fillStyle = "rgba(125, 211, 252, 0.35)";
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.arc(i * size / 4 + 1, j * size / 4 + 1, 1.6, 0, Math.PI * 2); ctx.fill(); }
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const extent = Math.max(plan.bounds.w ?? 400, plan.bounds.d ?? 400, 400) * 4;
  texture.repeat.set(extent / 16, extent / 16);
  return (
    <mesh position={[plan.bounds.x, -3.2, plan.bounds.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[extent, extent]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

// Each customer center stands on a platform: a thick slab under its floor, its top edge lit.
function Platforms({ buildings, onPick }: { buildings: Area[]; onPick(key: string): void }) {
  return (
    <>
      {buildings.map((b) => {
        const [x0, x1, z0, z1] = [b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2];
        const rim = (y: number): Vec3[] => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]];
        return (
          <group key={b.key ?? b.centerId}>
            <mesh position={[b.x, -0.7, b.z]} onClick={(e) => { if (e.delta > 4) return; e.stopPropagation(); onPick(`center:${b.centerId}`); }}>
              <boxGeometry args={[b.w + 1.2, 1.4, b.d + 1.2]} />
              <meshStandardMaterial color="#163a6e" roughness={0.35} metalness={0.35} />
            </mesh>
            <mesh position={[b.x, -2.2, b.z]} raycast={() => null}>
              <boxGeometry args={[b.w + 4, 1.6, b.d + 4]} />
              <meshStandardMaterial color="#0c2148" roughness={0.4} metalness={0.3} />
            </mesh>
            <Line points={rim(0.12).map(([x, y, z]) => [x + Math.sign(x - b.x) * 0.6, y, z + Math.sign(z - b.z) * 0.6] as Vec3)} color={glow(EDGE)} lineWidth={2} toneMapped={false} />
            <Line points={rim(-1.4).map(([x, y, z]) => [x + Math.sign(x - b.x) * 2, y, z + Math.sign(z - b.z) * 2] as Vec3)} color={glow("#3b82f6", 1.5)} lineWidth={1.4} toneMapped={false} />
            <Line points={rim(-3).map(([x, y, z]) => [x + Math.sign(x - b.x) * 2, y, z + Math.sign(z - b.z) * 2] as Vec3)} color={glow("#1e3a8a", 1.2)} lineWidth={1} toneMapped={false} />
          </group>
        );
      })}
    </>
  );
}

export function CampusScene({ drift, plan, mode, goal, selected, selectedSpot, wing, showUnits, issues, screens, callers, walkers, labelSuffix, ride, handle, onSelect }: Props): React.ReactElement {
  const shown = useMemo(() => (item: { wing?: Wing }) => !wing || !item.wing || item.wing === wing, [wing]);
  const floors = useMemo(() => plan.areas.filter(shown).map((a) => ({
    x: a.x, y: a.y + (a.kind === "building" ? 0 : a.kind === "wing" ? 0.015 : 0.03), z: a.z, w: a.w, h: a.kind === "building" ? 0.08 : 0.04, d: a.d,
    color: new THREE.Color(FLOOR[a.kind]).lerp(new THREE.Color(a.kind === "wing" && a.wing ? WING_COLORS[a.wing] : a.color), AREA_MIX[a.kind]),
    key: a.kind === "building" ? `center:${a.centerId}` : a.key
  })), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const buildings = useMemo(() => plan.areas.filter((a) => a.kind === "building"), [plan]);
  // A building's outer walls stand lower, so you can look into its rooms from the side.
  const walls = useMemo(() => {
    const onEdge = (w: Wall) => buildings.some((b) => {
      const alongX = w.w >= w.d;
      return alongX
        ? Math.abs(Math.abs(w.z - b.z) - b.d / 2) < 0.8 && Math.abs(w.x - b.x) <= b.w / 2 + 0.5
        : Math.abs(Math.abs(w.x - b.x) - b.w / 2) < 0.8 && Math.abs(w.z - b.z) <= b.d / 2 + 0.5;
    });
    return plan.walls.filter(shown).map((w: Wall) => ({ x: w.x, y: w.y, z: w.z, w: w.w, h: onEdge(w) ? w.h * 0.45 : w.h, d: w.d }));
  }, [plan, wing, buildings]); // eslint-disable-line react-hooks/exhaustive-deps
  // Glass walls with a lit top edge.
  const wallTops = useMemo(() => walls.map((w) => ({ x: w.x, y: w.y + w.h, z: w.z, w: w.w + 0.02, h: 0.06, d: w.d + 0.02, color: new THREE.Color("#7dd3fc").multiplyScalar(0.8) })), [walls]);
  const rooms = useMemo(() => plan.areas.filter((a) => a.kind === "room" && shown(a)), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const doors = useMemo(() => plan.fixtures.filter((f) => f.kind === "door" && shown(f)), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const desks = useMemo(() => plan.fixtures.filter((f) => f.kind === "desk" && shown(f)), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = useMemo(() => plan.fixtures.filter((f) => f.kind !== "desk" && f.kind !== "numbers" && shown(f)), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const paths = useMemo(() => plan.paths.filter(shown), [plan, wing]); // eslint-disable-line react-hooks/exhaustive-deps
  const wingOfRoom = useMemo(() => new Map(plan.areas.filter((a) => a.kind === "room").map((a) => [a.key, a.wing])), [plan]);
  const blocks = useMemo(() => obstacles(plan), [plan]);

  const selectedAt = selected ? selectedSpot ?? plan.anchors.get(selected) : undefined;
  const markers = useMemo(() => [...(issues ?? new Map<string, Severity>()).entries()].map(([k, s]) => ({ key: k, severity: s, at: plan.anchors.get(k) })).filter((m): m is { key: string; severity: Severity; at: Vec3 } => !!m.at), [issues, plan]);
  const pick = (key: string | undefined) => { if (key) onSelect(key); };

  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ position: [plan.bounds.x, 120 * CAMERA_DISTANCE, plan.bounds.z + 160 * CAMERA_DISTANCE], fov: FOV, near: 1, far: 9000 }}>
      <GradientSky />
      <fog attach="fog" args={[SKY, 800, 3600]} />
      <hemisphereLight args={["#cfe3ff", "#0a1532", 0.85]} />
      <directionalLight position={[80, 160, 120]} intensity={1.25} />
      <directionalLight position={[-120, 80, -60]} intensity={0.45} color="#7dd3fc" />

      <GridFloor plan={plan} />
      <Platforms buildings={buildings} onPick={onSelect} />
      <Boxes items={floors} onPick={pick} />
      <Boxes items={walls} color={WALL} opacity={0.12} />
      <Boxes items={wallTops} emissive />
      <CircuitFloors buildings={buildings} />
      <CardStems rooms={rooms} />
      <DeskPlaces rooms={rooms} desks={desks} />
      <EntranceRings doors={doors} />
      <Desks desks={desks} screens={screens} showUnits={showUnits} onPick={onSelect} />
      {others.filter((f) => f.kind !== "bench").map((f, i) => <FixtureModel key={`${f.kind}:${f.key ?? i}:${i}`} f={f} onPick={onSelect} />)}
      <Furnishings plan={plan} fixtures={others} onPick={onSelect} />
      {paths.map((p, i) => <PathLine key={i} path={p} highlight={!!selected && p.key === selected} />)}
      <FlowPulses paths={paths} />
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
        <mesh key={m.key} position={[m.at[0], m.at[1] + 2.8, m.at[2]]} raycast={() => null}>
          <octahedronGeometry args={[0.6, 0]} />
          <meshBasicMaterial color={glow(SEVERITY_COLORS[m.severity], 2)} toneMapped={false} />
        </mesh>
      ))}
      {selectedAt && (
        <mesh position={[selectedAt[0], 0.1, selectedAt[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[1.7, 1.95, 64]} />
          <meshBasicMaterial color={glow("#67e8f9", 2.6)} toneMapped={false} />
        </mesh>
      )}

      {/* Light that's brighter than white (edges, lines, lit screens) glows; the corners darken a little. */}
      <EffectComposer multisampling={4}>
        <N8AO aoRadius={3} distanceFalloff={1.2} intensity={2.4} color="#020617" halfRes />
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.25} intensity={0.9} radius={0.7} />
        <Vignette offset={0.3} darkness={0.55} />
      </EffectComposer>

      {mode === "orbit" && !ride && <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2.05} maxDistance={2500 * CAMERA_DISTANCE} />}
      <CameraRig mode={ride ? "walk" : mode} goal={goal} handle={handle} ride={ride} depth={1} rideScale={0.3 * CAMERA_DISTANCE} drift={drift} />
    </Canvas>
  );
}

