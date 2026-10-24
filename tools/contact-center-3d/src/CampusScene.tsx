// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Severity } from "../../environment-3d-explorer/src/health";
import { CameraGoal, CameraRig, Mode, SceneHandle } from "../../environment-3d-explorer/src/Scene";
import { Area, Fixture, FixtureKind, FLOOR_GAP, FLOOR_LABELS, Path, PathKind, Plan, Vec3, Wall } from "./floorplan";

// The campus in 3D: open-roofed buildings seen from above, like a doll's house. Floors and walls
// are instanced boxes, desks and the people behind them too, so a large center stays smooth.

export const SKY = "#dfe7ef";
const GROUND = "#cfd9e4";
const WALL = "#f8fafc";
const WOOD = "#b98b5e";
const SCREEN = "#1e293b";
const PERSON = "#475569";
const SKIN = "#f1c7a4";

export const SEVERITY_COLORS: Record<Severity, string> = { problem: "#ef4444", warning: "#f59e0b" };

const AREA_TINT: Record<Area["kind"], number> = { building: 0.78, slab: 0.78, entrance: 0.6, lobby: 0.45, corridor: 0.7, room: 0.55 };
const PATH_STYLE: Record<PathKind, { color: string; dashed: boolean; width: number }> = {
  route: { color: "#db2777", dashed: false, width: 2 },
  default: { color: "#ca8a04", dashed: true, width: 1.1 },
  transfer: { color: "#dc2626", dashed: true, width: 1.6 },
  skybridge: { color: "#0284c7", dashed: false, width: 2.4 }
};

interface Props {
  plan: Plan;
  mode: Mode;
  goal?: CameraGoal;
  selected?: string;
  // The center whose details are labelled (rooms, lobbies, signs); every building's name always is.
  focusCenter?: string;
  issues?: Map<string, Severity>;
  handle?: React.MutableRefObject<SceneHandle | null>;
  onSelect(key: string): void;
  onHover(key: string | undefined): void;
}

const tint = (color: string, amount: number) => new THREE.Color(color).lerp(new THREE.Color("#ffffff"), amount);

// Boxes of any size from one unit cube: position, scale and colour per instance.
function Boxes({ items, color, opacity = 1, onPick }: {
  items: { x: number; y: number; z: number; w: number; h: number; d: number; color?: THREE.Color; key?: string }[];
  color?: string; opacity?: number; onPick?: (key: string | undefined, e: ThreeEvent<MouseEvent>) => void;
}) {
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
      onClick={onPick ? (e) => { if (e.delta > 4 || e.instanceId === undefined) return; e.stopPropagation(); onPick(items[e.instanceId]?.key, e); } : undefined}
      raycast={onPick ? undefined : () => null}
    >
      <meshStandardMaterial transparent={opacity < 1} opacity={opacity} roughness={0.85} />
    </instancedMesh>
  );
}

// Desks with a person behind each: five instanced parts sharing positions.
function Desks({ desks, onPick }: { desks: Fixture[]; onPick(key: string): void }) {
  const parts = useMemo(() => {
    const at = (f: Fixture, dx: number, dy: number, dz: number, w: number, h: number, d: number, key?: string) => ({ x: f.x + dx, y: f.y + dy, z: f.z + dz, w, h, d, key });
    return {
      tops: desks.map((f) => at(f, 0, 0.72, 0, 1.8, 0.08, 0.9, f.key)),
      legs: desks.map((f) => at(f, 0, 0, 0, 1.6, 0.72, 0.7)),
      screens: desks.map((f) => at(f, 0, 0.8, -0.25, 0.7, 0.45, 0.05, f.key)),
      chairs: desks.map((f) => at(f, 0, 0, 0.85, 0.6, 0.5, 0.6)),
      bodies: desks.map((f) => at(f, 0, 0.5, 0.85, 0.5, 0.75, 0.35, f.key)),
      heads: desks.map((f) => at(f, 0, 1.28, 0.85, 0.3, 0.3, 0.3, f.key))
    };
  }, [desks]);
  const pick = (key: string | undefined) => { if (key) onPick(key); };
  return (
    <>
      <Boxes items={parts.tops} color={WOOD} onPick={pick} />
      <Boxes items={parts.legs} color="#8b6b4a" />
      <Boxes items={parts.screens} color={SCREEN} onPick={pick} />
      <Boxes items={parts.chairs} color="#334155" />
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
      {kind === "counter" && <>{box([0, 1.18, 0.15], [f.w ?? 3, 0.08, 0.9], "#0ea5e9", { emissive: "#0ea5e9", emissiveIntensity: 0.25 })}{box([0, 0.55, -1.1], [0.5, 1.1, 0.4], PERSON)}{box([0, 1.25, -1.1], [0.3, 0.3, 0.3], SKIN)}</>}
      {kind === "portal" && <>{box([0, 2, 0], [6, 2.6, 0.2], "#1e293b")}{box([0, 2, 0.12], [5.6, 2.2, 0.05], "#38bdf8", { emissive: "#38bdf8", emissiveIntensity: 0.5 })}</>}
      {kind === "kiosk" && <>{box([0, 0.7, 0], [0.7, 1.4, 0.5], "#a855f7")}{box([0, 1.55, 0.1], [0.8, 0.55, 0.08], "#ede9fe", { emissive: "#c4b5fd", emissiveIntensity: 0.6 })}</>}
      {kind === "signpost" && <>{box([0, 1, 0], [0.12, 2, 0.12], "#475569")}{box([0, 1.85, 0], [1.6, 0.5, 0.08], "#be185d")}</>}
      {kind === "chair" && box([0, 0.25, 0], [0.55, 0.5, 0.55], "#94a3b8")}
      {kind === "hours" && box([0, 2.1, 0.05], [0.9, 0.6, 0.06], "#0f172a")}
      {kind === "mailbox" && <>{box([0, 0.55, 0], [0.1, 1.1, 0.1], "#475569")}{box([0, 1.2, 0], [0.55, 0.4, 0.4], "#dc2626")}</>}
      {kind === "booth" && box([0, 1.2, 0], [1, 2.4, 1], "#38bdf8", { transparent: true, opacity: 0.55 })}
      {kind === "exit" && <>{box([0, 2.3, 0], [1, 0.35, 0.08], "#16a34a", { emissive: "#22c55e", emissiveIntensity: 0.4 })}{box([0, 1.1, 0], [0.1, 2.2, 0.1], "#475569")}</>}
      {kind === "transfer" && <>{box([0, 1.1, 0], [1.2, 2.2, 0.15], "#7c3aed")}</>}
      {kind === "hold" && box([0, 0.5, 0], [0.8, 1, 0.8], "#f59e0b")}
    </group>
  );
}

function PathLine({ path }: { path: Path }) {
  const style = PATH_STYLE[path.kind];
  return <Line points={path.points} color={style.color} lineWidth={style.width} dashed={style.dashed} dashSize={1} gapSize={0.6} transparent opacity={path.kind === "default" ? 0.55 : 0.85} />;
}

// Labels inside a building shrink with distance (full size about this far away), so a big center
// isn't a heap of labels from afar and they read well when you come close.
const LABEL_DISTANCE = 60;

const LABELLED: FixtureKind[] = ["signpost", "numbers", "hours", "mailbox", "booth", "exit", "transfer", "hold", "kiosk", "counter", "portal"];

export function CampusScene({ plan, mode, goal, selected, focusCenter, issues, handle, onSelect, onHover }: Props): React.ReactElement {
  const floors = useMemo(() => plan.areas.filter((a) => a.kind !== "slab").map((a) => ({ x: a.x, y: a.y + (a.kind === "building" ? 0 : 0.02), z: a.z, w: a.w, h: a.kind === "building" ? 0.08 : 0.04, d: a.d, color: tint(a.color, AREA_TINT[a.kind]), key: a.kind === "building" ? `center:${a.centerId}` : a.key })), [plan]);
  const slabs = useMemo(() => plan.areas.filter((a) => a.kind === "slab").map((a) => ({ x: a.x, y: a.y - 0.15, z: a.z, w: a.w, h: 0.15, d: a.d, color: tint(a.color, 0.55), key: a.key })), [plan]);
  const walls = useMemo(() => plan.walls.map((w: Wall) => ({ x: w.x, y: w.y, z: w.z, w: w.w, h: w.h, d: w.d })), [plan]);
  const desks = useMemo(() => plan.fixtures.filter((f) => f.kind === "desk"), [plan]);
  const others = useMemo(() => plan.fixtures.filter((f) => f.kind !== "desk" && f.kind !== "numbers"), [plan]);
  const centerOf = (x: number, z: number) => plan.buildings.find((b) => x >= b.x && x <= b.x + b.w && z <= b.z && z >= b.z - b.d)?.centerId;
  const showDetail = (x: number, z: number) => plan.buildings.length <= 2 || centerOf(x, z) === focusCenter;

  const selectedAt = selected ? plan.anchors.get(selected) : undefined;
  const markers = useMemo(() => [...(issues ?? new Map<string, Severity>()).entries()].map(([k, s]) => ({ key: k, severity: s, at: plan.anchors.get(k) })).filter((m): m is { key: string; severity: Severity; at: Vec3 } => !!m.at), [issues, plan]);
  const pickFloor = (key: string | undefined) => { if (key) onSelect(key); };

  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [plan.bounds.x, 120, plan.bounds.z + 160], fov: 50, near: 0.3, far: 5000 }}
      onPointerMissed={() => onHover(undefined)}>
      <color attach="background" args={[SKY]} />
      <hemisphereLight args={["#ffffff", "#94a3b8", 0.9]} />
      <directionalLight position={[80, 160, 120]} intensity={1.4} />
      <directionalLight position={[-120, 80, -60]} intensity={0.4} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[plan.bounds.x, -0.05, plan.bounds.z]} raycast={() => null}>
        <planeGeometry args={[plan.bounds.w + 400, plan.bounds.d + 400]} />
        <meshStandardMaterial color={GROUND} roughness={1} />
      </mesh>

      <Boxes items={floors} onPick={pickFloor} />
      <Boxes items={slabs} opacity={0.25} onPick={pickFloor} />
      <Boxes items={walls} color={WALL} opacity={0.92} />
      <Desks desks={desks} onPick={onSelect} />
      {others.map((f, i) => <FixtureModel key={`${f.kind}:${f.key ?? i}:${i}`} f={f} onPick={onSelect} />)}
      {plan.paths.map((p, i) => <PathLine key={i} path={p} />)}

      {/* Names: every building; inside, the center in focus. */}
      {plan.buildings.map((b) => (
        <Html key={b.centerId} position={[b.x + b.w / 2, (b.floors.length - 1) * FLOOR_GAP + 5, b.z + 1]} center zIndexRange={[20, 10]}>
          <button className="building-label" style={{ borderColor: b.color }} onClick={() => onSelect(`center:${b.centerId}`)}>{b.name}</button>
        </Html>
      ))}
      {plan.buildings.filter((b) => b.floors.length > 1).flatMap((b) => b.floors.map((fl) => (
        <Html key={`floor:${b.centerId}:${fl.kind}`} position={[b.x - 1, fl.y + 1.5, b.z]} center zIndexRange={[18, 8]} style={{ pointerEvents: "none" }}>
          <div className="floor-label" style={{ borderColor: b.color }}>{FLOOR_LABELS[fl.kind]}</div>
        </Html>
      )))}
      {plan.areas.filter((a) => a.kind === "room" && showDetail(a.x, a.z)).map((a) => (
        <Html key={`${a.kind}:${a.key ?? a.centerId + a.floor}`} position={[a.x, a.y + 0.2, a.z + a.d / 2 - (a.kind === "room" ? 0.8 : 1.5)]} center distanceFactor={LABEL_DISTANCE * 1.4} zIndexRange={[15, 5]} style={{ pointerEvents: "none" }}>
          <div className={`area-label ${a.kind}`}>{a.name}</div>
        </Html>
      ))}
      {plan.fixtures.filter((f) => LABELLED.includes(f.kind) && f.label && showDetail(f.x, f.z)).map((f, i) => (
        <Html key={`label:${f.kind}:${f.key ?? i}:${i}`} position={[f.x, f.y + (f.kind === "numbers" ? 3.4 : f.kind === "signpost" ? 2.5 : f.kind === "counter" ? 1.9 : f.kind === "portal" ? 3.8 : 2.6), f.z]} center distanceFactor={LABEL_DISTANCE * (f.kind === "numbers" ? 0.55 : f.kind === "counter" ? 0.75 : 1)} zIndexRange={[15, 5]} style={{ pointerEvents: "none" }}>
          <div className={`fixture-label ${f.kind}`}>{f.label}</div>
        </Html>
      ))}

      {markers.map((m) => (
        <group key={m.key} position={[m.at[0], m.at[1] + 2.6, m.at[2]]}>
          <mesh raycast={() => null} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.6, 1.2, 3]} />
            <meshBasicMaterial color={SEVERITY_COLORS[m.severity]} />
          </mesh>
        </group>
      ))}
      {selectedAt && (
        <mesh position={[selectedAt[0], 0.1, selectedAt[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[1.6, 2, 48]} />
          <meshBasicMaterial color="#0ea5e9" />
        </mesh>
      )}

      {mode === "orbit" && <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2.05} maxDistance={2500} />}
      <CameraRig mode={mode} goal={goal} handle={handle} depth={1} />
    </Canvas>
  );
}
