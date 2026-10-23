// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, Stars } from "@react-three/drei";
import { LAYER_SPACING, Vec3 } from "./layout";
import { Severity } from "./health";
import { GraphEdge, GraphNode, KIND_ORDER, KINDS, NodeKind } from "./model";

// The 3D view. One instanced mesh per kind keeps thousands of nodes cheap; all edges are one
// line-segments geometry. Everything outside the focused chain is dimmed (or hidden).

export type Mode = "orbit" | "walk";

export interface CameraGoal {
  position: Vec3;
  target: Vec3;
  // A new number makes the camera fly again, even to the same place.
  serial: number;
}

export const BACKGROUND = "#060a12";
// In front and to one side, so the layers show their depth.
export const START_POSITION: Vec3 = [210, 90, 290];
const BG = new THREE.Color(BACKGROUND);

const SHAPES: Record<NodeKind, () => THREE.BufferGeometry> = {
  phone: () => new THREE.SphereGeometry(0.9, 14, 10),
  channel: () => new THREE.OctahedronGeometry(1.4),
  workstream: () => new THREE.IcosahedronGeometry(2.8, 1),
  rule: () => new THREE.TetrahedronGeometry(1.4),
  queue: () => new THREE.BoxGeometry(2.4, 2.4, 2.4),
  agent: () => new THREE.SphereGeometry(0.85, 12, 8),
  skill: () => new THREE.DodecahedronGeometry(1.05)
};

interface SceneProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: Map<string, Vec3>;
  // The focused chain; undefined lights everything.
  lit?: Set<string>;
  selected?: string;
  hovered?: string;
  mode: Mode;
  goal?: CameraGoal;
  // Records with a health issue, when the overlay is on.
  issues?: Map<string, Severity>;
  onHover(key: string | undefined): void;
  onSelect(key: string): void;
}

function KindMesh({ kind, nodes, positions, lit, onHover, onSelect }: {
  kind: NodeKind; nodes: GraphNode[]; positions: Map<string, Vec3>; lit?: Set<string>;
  onHover(key: string | undefined): void; onSelect(key: string): void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => SHAPES[kind](), [kind]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const base = new THREE.Color(KINDS[kind].color);
    const dim = base.clone().lerp(BG, 0.85);
    nodes.forEach((n, i) => {
      const [x, y, z] = positions.get(n.key) ?? [0, 0, 0];
      matrix.makeTranslation(x, y, z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, !lit || lit.has(n.key) ? base : dim);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [kind, nodes, positions, lit]);

  const keyOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId !== undefined ? nodes[e.instanceId]?.key : undefined);
  return (
    <instancedMesh
      // A new count needs a new mesh: an instanced mesh's capacity is fixed.
      key={nodes.length}
      ref={ref}
      args={[geometry, undefined, nodes.length]}
      onPointerMove={(e) => { e.stopPropagation(); onHover(keyOf(e)); }}
      onPointerOut={() => onHover(undefined)}
      onClick={(e) => {
        // A drag to rotate also ends in a click; only a real click selects.
        if (e.delta > 4) return;
        e.stopPropagation();
        const k = keyOf(e);
        if (k) onSelect(k);
      }}
    >
      <meshStandardMaterial roughness={0.4} metalness={0.15} />
    </instancedMesh>
  );
}

function Edges({ nodes, edges, positions, lit }: { nodes: GraphNode[]; edges: GraphEdge[]; positions: Map<string, Vec3>; lit?: Set<string> }) {
  const geometry = useMemo(() => {
    const kindOf = new Map(nodes.map((n) => [n.key, n.kind]));
    const points: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();
    edges.forEach((e) => {
      const from = positions.get(e.from);
      const to = positions.get(e.to);
      const fromKind = kindOf.get(e.from);
      const toKind = kindOf.get(e.to);
      if (!from || !to || !fromKind || !toKind) return;
      const on = !lit || (lit.has(e.from) && lit.has(e.to));
      points.push(...from, ...to);
      [fromKind, toKind].forEach((k) => {
        color.set(KINDS[k].color);
        if (!on) color.lerp(BG, 0.93);
        colors.push(color.r, color.g, color.b);
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [nodes, edges, positions, lit]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial vertexColors transparent opacity={lit ? 0.9 : 0.45} depthWrite={false} />
    </lineSegments>
  );
}

// A faint ring per layer: the "floors" you pass through when you walk from front to back.
function LayerRings({ nodes, positions }: { nodes: GraphNode[]; positions: Map<string, Vec3> }) {
  const layers = useMemo(() => KIND_ORDER.map((kind) => {
    const own = nodes.filter((n) => n.kind === kind);
    if (!own.length) return undefined;
    const radius = Math.max(20, ...own.map((n) => { const p = positions.get(n.key); return p ? Math.hypot(p[0], p[1]) : 0; })) + 10;
    return { kind, radius, z: KINDS[kind].layer * LAYER_SPACING };
  }).filter((l): l is { kind: NodeKind; radius: number; z: number } => !!l), [nodes, positions]);
  return (
    <>
      {layers.map((l) => (
        <group key={l.kind} position={[0, 0, l.z]}>
          <mesh raycast={() => null}>
            <ringGeometry args={[l.radius - 0.35, l.radius, 128]} />
            <meshBasicMaterial color={KINDS[l.kind].color} transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <Html position={[-l.radius, l.radius * 0.15, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className="layer-label" style={{ color: KINDS[l.kind].color }}>{KINDS[l.kind].plural}</div>
          </Html>
        </group>
      ))}
    </>
  );
}

export const SEVERITY_COLORS: Record<Severity, string> = { problem: "#ff4d4f", warning: "#ffa62b" };

// A pulsing glow around every record with an issue: red for a problem, orange for a warning.
function IssueMarkers({ severity, keys, positions }: { severity: Severity; keys: string[]; positions: Map<string, Vec3> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(5.5, 24, 16), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    keys.forEach((k, i) => { const [x, y, z] = positions.get(k) ?? [0, 0, 0]; mesh.setMatrixAt(i, matrix.makeTranslation(x, y, z)); });
    mesh.instanceMatrix.needsUpdate = true;
  }, [keys, positions]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * (severity === "problem" ? 3 : 1.8);
    if (material.current) material.current.opacity = 0.34 + 0.18 * Math.sin(t);
  });
  if (!keys.length) return null;
  return (
    <instancedMesh key={keys.length} ref={ref} args={[geometry, undefined, keys.length]} raycast={() => null}>
      <meshBasicMaterial ref={material} color={SEVERITY_COLORS[severity]} transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
    </instancedMesh>
  );
}

function SelectionMarker({ position }: { position: Vec3 }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => { if (ref.current) { ref.current.rotation.z += dt * 1.5; ref.current.rotation.x += dt * 0.6; } });
  return (
    <mesh ref={ref} position={position} raycast={() => null}>
      <torusGeometry args={[4.2, 0.12, 8, 64]} />
      <meshBasicMaterial color="#ffffff" />
    </mesh>
  );
}

const MOVE_KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, 0, 1], ArrowUp: [0, 0, 1], KeyS: [0, 0, -1], ArrowDown: [0, 0, -1],
  KeyA: [-1, 0, 0], ArrowLeft: [-1, 0, 0], KeyD: [1, 0, 0], ArrowRight: [1, 0, 0],
  KeyE: [0, 1, 0], Space: [0, 1, 0], KeyQ: [0, -1, 0], KeyC: [0, -1, 0]
};

// Moves the camera: flying to a goal, the keyboard (both modes), and mouse look in walk mode.
// Walk mode turns the view by dragging, so it needs no pointer lock and works inside the
// model-driven app's frame.
function CameraRig({ mode, goal }: { mode: Mode; goal?: CameraGoal }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const pressed = useRef(new Set<string>());
  const look = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const flight = useRef<{ position: THREE.Vector3; target: THREE.Vector3; current: THREE.Vector3 } | undefined>(undefined);
  const previousMode = useRef<Mode | undefined>(undefined);

  // Start flying whenever a new goal comes in.
  useEffect(() => {
    if (!goal) return;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const current = controls ? controls.target.clone() : camera.position.clone().addScaledVector(direction, 60);
    flight.current = { position: new THREE.Vector3(...goal.position), target: new THREE.Vector3(...goal.target), current };
  }, [goal?.serial]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching modes keeps looking at the same thing. Orbit controls mount with the mode, so they
  // may only arrive on the next render: the new target waits for them.
  const needsTarget = useRef(false);
  useEffect(() => {
    if (previousMode.current !== undefined && previousMode.current !== mode && mode === "orbit") needsTarget.current = true;
    previousMode.current = mode;
    if (mode === "walk") look.current.setFromQuaternion(camera.quaternion, "YXZ");
    if (needsTarget.current && mode === "orbit" && controls) {
      needsTarget.current = false;
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      controls.target.copy(camera.position).addScaledVector(direction, 60);
      controls.update();
    }
  }, [mode, controls, camera]);

  useEffect(() => {
    const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (editable(e.target)) return;
      if (MOVE_KEYS[e.code] || e.code === "ShiftLeft" || e.code === "ShiftRight") {
        pressed.current.add(e.code);
        flight.current = undefined;
        if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => pressed.current.delete(e.code);
    const blur = () => pressed.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  useEffect(() => {
    if (mode !== "walk") return;
    const element = gl.domElement;
    let last: { x: number; y: number } | undefined;
    const pointerDown = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; };
    const pointerMove = (e: PointerEvent) => {
      if (!last || !(e.buttons & 1)) { last = undefined; return; }
      look.current.y -= (e.clientX - last.x) * 0.004;
      look.current.x = Math.max(-1.5, Math.min(1.5, look.current.x - (e.clientY - last.y) * 0.004));
      last = { x: e.clientX, y: e.clientY };
      flight.current = undefined;
    };
    const pointerUp = () => { last = undefined; };
    element.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    return () => { element.removeEventListener("pointerdown", pointerDown); window.removeEventListener("pointermove", pointerMove); window.removeEventListener("pointerup", pointerUp); };
  }, [mode, gl]);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.1);
    const f = flight.current;
    if (f) {
      const t = 1 - Math.exp(-step * 3.5);
      camera.position.lerp(f.position, t);
      f.current.lerp(f.target, t);
      if (mode === "orbit" && controls) { controls.target.copy(f.current); controls.update(); }
      else { camera.lookAt(f.current); look.current.setFromQuaternion(camera.quaternion, "YXZ"); }
      if (camera.position.distanceTo(f.position) < 0.3 && f.current.distanceTo(f.target) < 0.3) flight.current = undefined;
      return;
    }

    if (mode === "walk") camera.quaternion.setFromEuler(look.current);

    const move = new THREE.Vector3();
    pressed.current.forEach((code) => { const m = MOVE_KEYS[code]; if (m) move.add(new THREE.Vector3(...m)); });
    if (move.lengthSq() === 0) return;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const fast = pressed.current.has("ShiftLeft") || pressed.current.has("ShiftRight");
    const delta = new THREE.Vector3()
      .addScaledVector(forward, move.z)
      .addScaledVector(right, move.x)
      .addScaledVector(camera.up, move.y)
      .normalize()
      .multiplyScalar((fast ? 140 : 45) * step);
    camera.position.add(delta);
    // In orbit mode the point you orbit around travels with you.
    if (mode === "orbit" && controls) { controls.target.add(delta); controls.update(); }
  });

  return null;
}

export function Scene({ nodes, edges, positions, lit, selected, hovered, mode, goal, issues, onHover, onSelect }: SceneProps): React.ReactElement {
  const byKind = useMemo(() => KIND_ORDER.map((kind) => ({ kind, nodes: nodes.filter((n) => n.kind === kind) })).filter((g) => g.nodes.length), [nodes]);
  const nodeByKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);

  // Names float next to the hovered node, the selected node and what it's directly linked to;
  // the rest of the chain is lit but unlabelled, or the labels pile up.
  const labelled = useMemo(() => {
    const keys = new Set<string>();
    if (selected) {
      keys.add(selected);
      edges.forEach((e) => { if (e.from === selected) keys.add(e.to); if (e.to === selected) keys.add(e.from); });
    }
    if (hovered) keys.add(hovered);
    return [...keys].slice(0, 40).map((k) => nodeByKey.get(k)).filter((n): n is GraphNode => !!n);
  }, [edges, selected, hovered, nodeByKey]);

  const selectedPosition = selected ? positions.get(selected) : undefined;
  const markers = useMemo(() => {
    const visible = new Set(nodes.map((n) => n.key));
    const of = (severity: Severity) => [...(issues ?? new Map<string, Severity>()).entries()].filter(([k, s]) => s === severity && visible.has(k)).map(([k]) => k);
    return { problem: of("problem"), warning: of("warning") };
  }, [issues, nodes]);

  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: START_POSITION, fov: 55, near: 0.5, far: 4000 }} onCreated={({ camera }) => camera.lookAt(0, 0, 0)}>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[BACKGROUND, 220, 900]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[80, 120, 160]} intensity={1.6} />
      <directionalLight position={[-120, -40, -160]} intensity={0.5} color="#88aaff" />
      <Stars radius={700} depth={200} count={2500} factor={5} fade speed={0.4} />

      <LayerRings nodes={nodes} positions={positions} />
      <Edges nodes={nodes} edges={edges} positions={positions} lit={lit} />
      {byKind.map((g) => (
        <KindMesh key={g.kind} kind={g.kind} nodes={g.nodes} positions={positions} lit={lit} onHover={onHover} onSelect={onSelect} />
      ))}
      {selectedPosition && <SelectionMarker position={selectedPosition} />}
      <IssueMarkers severity="problem" keys={markers.problem} positions={positions} />
      <IssueMarkers severity="warning" keys={markers.warning} positions={positions} />

      {labelled.map((n) => (
        <Html key={n.key} position={positions.get(n.key)} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
          <div className={`node-label${n.key === selected ? " selected" : ""}${n.key === hovered ? " hovered" : ""}`} style={{ borderColor: KINDS[n.kind].color }}>
            {n.name}
          </div>
        </Html>
      ))}

      {mode === "orbit" && <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxDistance={1500} />}
      <CameraRig mode={mode} goal={goal} />
    </Canvas>
  );
}
