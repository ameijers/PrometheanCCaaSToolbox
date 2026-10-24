// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, ThreeEvent, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Severity } from "../../environment-3d-explorer/src/health";
import { hash } from "../../environment-3d-explorer/src/layout";
import { CameraGoal, CameraRig, Mode, Ride, SceneHandle } from "../../environment-3d-explorer/src/Scene";
import { Area, Fixture, FixtureKind, Path, PathKind, Plan, Vec3, Wall, Wing, WING_COLORS } from "./floorplan";

// The campus in 3D: open-roofed buildings seen from above, like a doll's house. Floors, walls, desks
// and people are instanced boxes, so a large center stays smooth.

export const SKY = "#dfe7ef";
const GROUND = "#cfd9e4";
const WALL = "#f8fafc";
const WOOD = "#b98b5e";
const SCREEN = "#1e293b";
const PERSON = "#475569";
const SKIN = "#f1c7a4";

export const SEVERITY_COLORS: Record<Severity, string> = { problem: "#ef4444", warning: "#f59e0b" };

const AREA_TINT: Record<Area["kind"], number> = { building: 0.8, entrance: 0.6, lobby: 0.45, corridor: 0.72, wing: 0.72, room: 0.55 };
// The lines' looks; the page's legend explains them from the same list.
export const PATH_STYLE: Record<PathKind, { color: string; dashed: boolean; width: number; label: string }> = {
  route: { color: "#be123c", dashed: false, width: 2, label: "Routing rule to its room" },
  skybridge: { color: "#0284c7", dashed: false, width: 2.2, label: "Routing rule to a room in another customer center (skybridge)" },
  default: { color: "#ca8a04", dashed: true, width: 1.2, label: "Workstream's default queue" },
  transfer: { color: "#dc2626", dashed: true, width: 1.6, label: "Overflow: transfer to another queue" }
};
// Labels inside a building shrink with distance (full size about this far away), so a big center
// isn't a heap of labels from afar and they read well when you come close.
const LABEL_DISTANCE = 60;
const LABELLED: FixtureKind[] = ["signpost", "numbers", "hours", "mailbox", "booth", "exit", "transfer", "hold", "kiosk", "counter", "portal"];
const PALETTE = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa", "#a78bfa", "#f472b6", "#94a3b8", "#c084fc"];
export const colorFor = (name: string) => PALETTE[Math.floor(((hash(name, 21) + 1) / 2) * PALETTE.length) % PALETTE.length];

export interface Caller { key: string; at: Vec3; color: string; standing: boolean }
export interface Walker { id: string; points: Vec3[]; color: string }

interface Props {
  plan: Plan;
  mode: Mode;
  goal?: CameraGoal;
  selected?: string;
  // The center whose details are labelled (rooms, counters, signs); every building's name always is.
  focusCenter?: string;
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
  onSelect(key: string): void;
}

const tint = (color: string, amount: number) => new THREE.Color(color).lerp(new THREE.Color("#ffffff"), amount);
interface BoxItem { x: number; y: number; z: number; w: number; h: number; d: number; color?: THREE.Color; key?: string }

// Boxes of any size from one unit cube: position, scale and colour per instance.
function Boxes({ items, color, opacity = 1, emissive, onPick }: { items: BoxItem[]; color?: string; opacity?: number; emissive?: boolean; onPick?: (key: string | undefined) => void }) {
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
      onClick={onPick ? (e: ThreeEvent<MouseEvent>) => { if (e.delta > 4 || e.instanceId === undefined) return; e.stopPropagation(); onPick(items[e.instanceId]?.key); } : undefined}
      raycast={onPick ? undefined : () => null}
    >
      {emissive
        ? <meshBasicMaterial toneMapped={false} />
        : <meshStandardMaterial transparent={opacity < 1} opacity={opacity} roughness={0.85} />}
    </instancedMesh>
  );
}

// Desks with a person behind each, the screen in the agent's presence colour, skill badges on the
// front edge and, when asked, a carpet tile in the business unit's colour.
function Desks({ desks, screens, showUnits, onPick }: { desks: Fixture[]; screens?: Map<string, string>; showUnits?: boolean; onPick(key: string): void }) {
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
  const pick = (key: string | undefined) => { if (key) onPick(key); };
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

// Callers: sitting on a room's waiting bench, or standing at an agent's desk.
function Callers({ callers }: { callers: Caller[] }) {
  const parts = useMemo(() => ({
    bodies: callers.map((c) => ({ x: c.at[0], y: c.at[1] + (c.standing ? 0 : 0.45), z: c.at[2], w: 0.45, h: c.standing ? 1.2 : 0.75, d: 0.35, color: new THREE.Color(c.color) })),
    heads: callers.map((c) => ({ x: c.at[0], y: c.at[1] + (c.standing ? 1.25 : 1.22), z: c.at[2], w: 0.3, h: 0.3, d: 0.3, color: new THREE.Color(SKIN) }))
  }), [callers]);
  return <><Boxes items={parts.bodies} /><Boxes items={parts.heads} /></>;
}

// A new caller walking from the way in to the room, then gone.
const WALK_SECONDS = 5;
function WalkerFigure({ walker }: { walker: Walker }) {
  const ref = useRef<THREE.Group>(null);
  const start = useRef<number | undefined>(undefined);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(walker.points.map((p) => new THREE.Vector3(...p)), false, "catmullrom", 0.1), [walker.points]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (start.current === undefined) start.current = clock.getElapsedTime();
    const t = Math.min(1, (clock.getElapsedTime() - start.current) / WALK_SECONDS);
    ref.current.position.copy(curve.getPointAt(t));
    ref.current.position.y += Math.abs(Math.sin(clock.getElapsedTime() * 9)) * 0.08;
    ref.current.visible = t < 1;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.6, 0]} raycast={() => null}><boxGeometry args={[0.45, 1.2, 0.35]} /><meshBasicMaterial color={walker.color} /></mesh>
      <mesh position={[0, 1.4, 0]} raycast={() => null}><boxGeometry args={[0.3, 0.3, 0.3]} /><meshBasicMaterial color={SKIN} /></mesh>
    </group>
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
        {box([0, 0.55, -1.1], [0.5, 1.1, 0.4], PERSON)}{box([0, 1.25, -1.1], [0.3, 0.3, 0.3], SKIN)}
        {/* The context variables a call brings: a clipboard on the counter. */}
        {(f.variables?.length ?? 0) > 0 && <>{box([0.9, 1.24, 0.35], [0.45, 0.04, 0.6], "#f8fafc")}{box([0.9, 1.27, 0.12], [0.2, 0.03, 0.08], "#475569")}</>}
      </>}
      {kind === "portal" && <>{box([0, 2, 0], [6, 2.6, 0.2], "#1e293b")}{box([0, 2, 0.12], [5.6, 2.2, 0.05], "#38bdf8", { emissive: "#38bdf8", emissiveIntensity: 0.5 })}</>}
      {kind === "kiosk" && <>{box([0, 0.7, 0], [0.7, 1.4, 0.5], "#a855f7")}{box([0, 1.55, 0.1], [0.8, 0.55, 0.08], "#ede9fe", { emissive: "#c4b5fd", emissiveIntensity: 0.6 })}</>}
      {kind === "signpost" && <>{box([0, 1, 0], [0.12, 2, 0.12], "#475569")}{box([0, 1.85, 0], [1.6, 0.5, 0.08], "#be123c")}</>}
      {/* A waiting bench: seat, a back against the wall behind it, two legs. */}
      {kind === "bench" && <>{box([0, 0.45, 0], [f.w ?? 3, 0.08, 0.55], "#0369a1")}{box([0, 0.75, 0.25], [f.w ?? 3, 0.55, 0.08], "#0369a1")}{box([-(f.w ?? 3) / 2 + 0.2, 0.2, 0], [0.1, 0.42, 0.45], "#334155")}{box([(f.w ?? 3) / 2 - 0.2, 0.2, 0], [0.1, 0.42, 0.45], "#334155")}</>}
      {kind === "hours" && box([0, 2.1, 0.05], [0.9, 0.6, 0.06], "#0f172a")}
      {kind === "mailbox" && <>{box([0, 0.55, 0], [0.1, 1.1, 0.1], "#475569")}{box([0, 1.2, 0], [0.55, 0.4, 0.4], "#dc2626")}</>}
      {kind === "booth" && box([0, 1.2, 0], [1, 2.4, 1], "#38bdf8", { transparent: true, opacity: 0.55 })}
      {kind === "exit" && <>{box([0, 2.3, 0], [1, 0.35, 0.08], "#16a34a", { emissive: "#22c55e", emissiveIntensity: 0.4 })}{box([0, 1.1, 0], [0.1, 2.2, 0.1], "#475569")}</>}
      {kind === "transfer" && <>{box([-1.2, 1.15, 0], [0.16, 2.3, 0.3], "#7c3aed")}{box([1.2, 1.15, 0], [0.16, 2.3, 0.3], "#7c3aed")}{box([0, 2.35, 0], [2.56, 0.18, 0.3], "#7c3aed")}{box([0, 0.02, 0], [2.2, 0.04, 1], "#c4b5fd")}</>}
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

export function CampusScene({ plan, mode, goal, selected, focusCenter, wing, showUnits, issues, screens, callers, walkers, labelSuffix, ride, handle, onSelect }: Props): React.ReactElement {
  const shown = (item: { wing?: Wing }) => !wing || !item.wing || item.wing === wing;
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
  const centerOf = (x: number, z: number) => plan.buildings.find((b) => x >= b.x && x <= b.x + b.w && z <= b.z && z >= b.z - b.d)?.centerId;
  const showDetail = (x: number, z: number) => plan.buildings.length <= 2 || centerOf(x, z) === focusCenter;

  const selectedAt = selected ? plan.anchors.get(selected) : undefined;
  const markers = useMemo(() => [...(issues ?? new Map<string, Severity>()).entries()].map(([k, s]) => ({ key: k, severity: s, at: plan.anchors.get(k) })).filter((m): m is { key: string; severity: Severity; at: Vec3 } => !!m.at), [issues, plan]);
  const pick = (key: string | undefined) => { if (key) onSelect(key); };

  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [plan.bounds.x, 120, plan.bounds.z + 160], fov: 50, near: 0.3, far: 5000 }}>
      <color attach="background" args={[SKY]} />
      <hemisphereLight args={["#ffffff", "#94a3b8", 0.9]} />
      <directionalLight position={[80, 160, 120]} intensity={1.4} />
      <directionalLight position={[-120, 80, -60]} intensity={0.4} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[plan.bounds.x, -0.05, plan.bounds.z]} raycast={() => null}>
        <planeGeometry args={[plan.bounds.w + 400, plan.bounds.d + 400]} />
        <meshStandardMaterial color={GROUND} roughness={1} />
      </mesh>

      <Boxes items={floors} onPick={pick} />
      <Boxes items={walls} color={WALL} opacity={0.92} />
      <Desks desks={desks} screens={screens} showUnits={showUnits} onPick={onSelect} />
      {others.map((f, i) => <FixtureModel key={`${f.kind}:${f.key ?? i}:${i}`} f={f} onPick={onSelect} />)}
      {paths.map((p, i) => <PathLine key={i} path={p} />)}
      {callers && <Callers callers={callers.filter((c) => shown({ wing: wingOfRoom.get(c.key) }))} />}
      {walkers?.map((w) => <WalkerFigure key={w.id} walker={w} />)}

      {/* Names: every building and wing; inside, the center in focus. */}
      {plan.buildings.map((b) => (
        <Html key={b.centerId} position={[b.x + b.w / 2, 5, b.z + 1]} center zIndexRange={[20, 10]}>
          <button className="building-label" style={{ borderColor: b.color }} onClick={() => onSelect(`center:${b.centerId}`)}>{b.name}</button>
        </Html>
      ))}
      {plan.areas.filter((a) => a.kind === "wing" && shown(a)).map((a) => (
        <Html key={`wing:${a.centerId}:${a.wing}`} position={[a.x, 0.3, a.z + a.d / 2 - 1.2]} center distanceFactor={LABEL_DISTANCE * 1.8} zIndexRange={[16, 6]} style={{ pointerEvents: "none" }}>
          <div className="wing-label" style={{ background: WING_COLORS[a.wing!] }}>{a.name}</div>
        </Html>
      ))}
      {plan.areas.filter((a) => a.kind === "room" && shown(a) && showDetail(a.x, a.z)).map((a) => (
        <Html key={`room:${a.key}`} position={[a.x, 0.2, a.z + a.d / 2 - 0.8]} center distanceFactor={LABEL_DISTANCE * 1.4} zIndexRange={[15, 5]} style={{ pointerEvents: "none" }}>
          <div className="area-label room">{a.name}{labelSuffix?.get(a.key ?? "") && <span className="suffix"> · {labelSuffix.get(a.key ?? "")}</span>}</div>
        </Html>
      ))}
      {plan.fixtures.filter((f) => LABELLED.includes(f.kind) && f.label && shown(f) && showDetail(f.x, f.z)).map((f, i) => (
        <Html key={`label:${f.kind}:${f.key ?? i}:${i}`} position={[f.x, f.y + (f.kind === "numbers" ? 3.4 : f.kind === "signpost" ? 2.5 : f.kind === "counter" ? 1.9 : f.kind === "portal" ? 3.8 : 2.6), f.z]} center
          distanceFactor={LABEL_DISTANCE * (f.kind === "numbers" ? 0.55 : f.kind === "counter" ? 0.75 : 1)} zIndexRange={[15, 5]} style={{ pointerEvents: "none" }}>
          <div className={`fixture-label ${f.kind}`}>{f.label}</div>
        </Html>
      ))}

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
