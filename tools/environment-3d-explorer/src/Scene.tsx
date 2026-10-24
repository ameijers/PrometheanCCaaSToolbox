// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, Stars } from "@react-three/drei";
import { hash, LAYER_SPACING, Vec3 } from "./layout";
import { Severity } from "./health";
import { CONVERSATION_COLORS, ConversationStatus } from "./live";
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
  skill: () => new THREE.DodecahedronGeometry(1.05),
  bot: () => new THREE.TorusKnotGeometry(1.1, 0.35, 64, 8),
  variable: () => new THREE.ConeGeometry(0.6, 1.4, 8),
  hours: () => new THREE.TorusGeometry(1.4, 0.35, 10, 32),
  overflow: () => new THREE.ConeGeometry(1.2, 2.2, 6),
  capacity: () => new THREE.CylinderGeometry(0.9, 0.9, 1.6, 14),
  team: () => new THREE.OctahedronGeometry(1.1, 0),
  businessunit: () => new THREE.BoxGeometry(3.2, 0.9, 3.2)
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
  // Per-record size ("size by connections"); 1 when missing.
  scales?: Map<string, number>;
  // "Layer distance": the layers' spacing as a multiple of the layout's (positions are already stretched).
  depth?: number;
  // Lets the page read the camera and take a screenshot.
  handle?: React.MutableRefObject<SceneHandle | null>;
  // "Follow the call": the camera rides along these points. A new id starts a new ride.
  ride?: Ride;
  // Names to label instead of the selected record and its links (the ride labels its route).
  labelKeys?: string[];
  // Live activity: colours that replace a record's own (agents by presence), extra text after a
  // record's label ("3 waiting"), conversations circling their queue or agent, and new ones arriving.
  colors?: Map<string, string>;
  labelSuffix?: Map<string, string>;
  conversations?: { id: string; anchor: string; status: ConversationStatus }[];
  arrivals?: { id: string; from: Vec3; to: Vec3 }[];
}

export interface Ride {
  id: number;
  points: Vec3[];
  playing: boolean;
}

// Ride speed in scene units per second, and how far behind and above the point the camera rides.
const RIDE_SPEED = 30;
const RIDE_BEHIND = 32;
const RIDE_ABOVE = 10;

export interface SceneHandle {
  view(): { position: Vec3; target: Vec3 };
  // The current view as a PNG data URL.
  capture(): string;
}

const ONE = new THREE.Vector3(1, 1, 1);
const place = (matrix: THREE.Matrix4, [x, y, z]: Vec3, scale = 1) =>
  matrix.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), ONE.clone().multiplyScalar(scale));

function KindMesh({ kind, nodes, positions, scales, colors, lit, onHover, onSelect }: {
  kind: NodeKind; nodes: GraphNode[]; positions: Map<string, Vec3>; scales?: Map<string, number>; colors?: Map<string, string>; lit?: Set<string>;
  onHover(key: string | undefined): void; onSelect(key: string): void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => SHAPES[kind](), [kind]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const own = new THREE.Color(KINDS[kind].color);
    const color = new THREE.Color();
    nodes.forEach((n, i) => {
      place(matrix, positions.get(n.key) ?? [0, 0, 0], scales?.get(n.key) ?? 1);
      mesh.setMatrixAt(i, matrix);
      const override = colors?.get(n.key);
      if (override) color.set(override); else color.copy(own);
      mesh.setColorAt(i, !lit || lit.has(n.key) ? color : color.lerp(BG, 0.85));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [kind, nodes, positions, scales, colors, lit]);

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
function LayerRings({ nodes, positions, depth }: { nodes: GraphNode[]; positions: Map<string, Vec3>; depth: number }) {
  const layers = useMemo(() => KIND_ORDER.map((kind) => {
    const own = nodes.filter((n) => n.kind === kind);
    if (!own.length) return undefined;
    const radius = Math.max(20, ...own.map((n) => { const p = positions.get(n.key); return p ? Math.hypot(p[0], p[1]) : 0; })) + 10;
    return { kind, radius, z: KINDS[kind].layer * LAYER_SPACING * depth };
  }).filter((l): l is { kind: NodeKind; radius: number; z: number } => !!l), [nodes, positions, depth]);
  return (
    <>
      {layers.map((l) => (
        <group key={l.kind} position={[0, 0, l.z]}>
          <mesh raycast={() => null}>
            <ringGeometry args={[l.radius - 0.35, l.radius, 128]} />
            <meshBasicMaterial color={KINDS[l.kind].color} transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {/* Half layers (settings next to a record type) put their name on the other side, so neighbouring names don't overlap. */}
          <Html position={Number.isInteger(KINDS[l.kind].layer) ? [-l.radius, l.radius * 0.15, 0] : [l.radius, -l.radius * 0.15, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className="layer-label" style={{ color: KINDS[l.kind].color }}>{KINDS[l.kind].plural}</div>
          </Html>
        </group>
      ))}
    </>
  );
}

export const SEVERITY_COLORS: Record<Severity, string> = { problem: "#ff4d4f", warning: "#ffa62b" };

// A pulsing glow around every record with an issue: red for a problem, orange for a warning.
function IssueMarkers({ severity, keys, positions, scales }: { severity: Severity; keys: string[]; positions: Map<string, Vec3>; scales?: Map<string, number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(5.5, 24, 16), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    keys.forEach((k, i) => mesh.setMatrixAt(i, place(matrix, positions.get(k) ?? [0, 0, 0], scales?.get(k) ?? 1)));
    mesh.instanceMatrix.needsUpdate = true;
  }, [keys, positions, scales]);
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

// Open conversations: small points circling the queue they wait in, or the agent who has them.
function ConversationParticles({ conversations, positions }: { conversations: { id: string; anchor: string; status: ConversationStatus }[]; positions: Map<string, Vec3> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.55, 10, 8), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Each conversation gets its own orbit: radius, tilt, speed and phase from its id.
  const orbits = useMemo(() => conversations.map((c) => {
    const p = positions.get(c.anchor) ?? [0, 0, 0];
    return { centre: new THREE.Vector3(...p), radius: (c.status === "waiting" ? 4.5 : 3) + hash(c.id, 11) * 1.2, tilt: hash(c.id, 12) * 1.2, speed: 0.8 + hash(c.id, 13) * 0.4, phase: hash(c.id, 14) * Math.PI };
  }), [conversations, positions]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const color = new THREE.Color();
    conversations.forEach((c, i) => mesh.setColorAt(i, color.set(CONVERSATION_COLORS[c.status])));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [conversations]);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.getElapsedTime();
    const matrix = new THREE.Matrix4();
    orbits.forEach((o, i) => {
      const a = t * o.speed + o.phase;
      matrix.makeTranslation(o.centre.x + Math.cos(a) * o.radius, o.centre.y + Math.sin(a) * o.radius * Math.cos(o.tilt), o.centre.z + Math.sin(a) * o.radius * Math.sin(o.tilt));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  if (!conversations.length) return null;
  return (
    <instancedMesh key={conversations.length} ref={ref} args={[geometry, undefined, conversations.length]} raycast={() => null} frustumCulled={false}>
      <meshBasicMaterial fog={false} />
    </instancedMesh>
  );
}

// A new conversation shoots from its workstream to its queue as a comet, then fades.
const ARRIVAL_SECONDS = 2.4;
function Arrival({ from, to }: { from: Vec3; to: Vec3 }) {
  const ref = useRef<THREE.Mesh>(null);
  const start = useRef<number | undefined>(undefined);
  const a = useMemo(() => new THREE.Vector3(...from), [from]);
  const b = useMemo(() => new THREE.Vector3(...to), [to]);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    if (start.current === undefined) start.current = clock.getElapsedTime();
    const t = Math.min(1, (clock.getElapsedTime() - start.current) / ARRIVAL_SECONDS);
    const eased = 1 - Math.pow(1 - t, 3);
    mesh.position.copy(a).lerp(b, eased);
    mesh.visible = t < 1;
    (mesh.material as THREE.MeshBasicMaterial).opacity = t < 0.85 ? 1 : (1 - t) / 0.15;
  });
  return (
    <mesh ref={ref} raycast={() => null}>
      <sphereGeometry args={[1.1, 12, 10]} />
      <meshBasicMaterial color="#fef08a" transparent fog={false} />
    </mesh>
  );
}

function SelectionMarker({ position, scale = 1 }: { position: Vec3; scale?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => { if (ref.current) { ref.current.rotation.z += dt * 1.5; ref.current.rotation.x += dt * 0.6; } });
  return (
    <mesh ref={ref} position={position} scale={scale} raycast={() => null}>
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
// Exported for 3D Contact Center, which moves its camera the same way.
export function CameraRig({ mode, goal, handle, ride, depth }: { mode: Mode; goal?: CameraGoal; handle?: React.MutableRefObject<SceneHandle | null>; ride?: Ride; depth: number }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const scene = useThree((s) => s.scene);

  // When the layers move apart (or together), the camera and the point it orbits move with them, so
  // you keep your place in the scene instead of ending up inside it.
  const previousDepth = useRef(1);
  useEffect(() => {
    const ratio = depth / previousDepth.current;
    previousDepth.current = depth;
    if (ratio === 1) return;
    camera.position.z *= ratio;
    if (controls) { controls.target.z *= ratio; controls.update(); }
  }, [depth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!handle) return;
    handle.current = {
      view: () => {
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        const target = controls ? controls.target.clone() : camera.position.clone().addScaledVector(direction, 60);
        return { position: camera.position.toArray() as Vec3, target: target.toArray() as Vec3 };
      },
      // Rendering right before reading keeps the picture without preserveDrawingBuffer (which costs
      // every frame). Labels are HTML, so they aren't in it.
      capture: () => { gl.render(scene, camera); return gl.domElement.toDataURL("image/png"); }
    };
    return () => { handle.current = null; };
  }, [handle, camera, controls, gl, scene]);
  const pressed = useRef(new Set<string>());
  const look = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const flight = useRef<{ position: THREE.Vector3; target: THREE.Vector3; current: THREE.Vector3 } | undefined>(undefined);
  const previousMode = useRef<Mode | undefined>(undefined);
  const call = useRef<THREE.Mesh>(null);
  // The ride: a point travels the route at a steady speed; the camera follows it on a spring, a little
  // behind and above, looking ahead. The spring rounds the corners, so the route itself can be straight lines.
  const rider = useRef<{ id: number; segment: number; along: number; point: THREE.Vector3; heading: THREE.Vector3; look: THREE.Vector3; speed: number; boarded: boolean } | undefined>(undefined);
  useEffect(() => {
    if (!ride || !ride.points.length) { rider.current = undefined; return; }
    if (rider.current?.id === ride.id) return;
    const start = new THREE.Vector3(...ride.points[0]);
    const next = ride.points[1] ? new THREE.Vector3(...ride.points[1]) : start.clone().add(new THREE.Vector3(0, 0, -1));
    const heading = next.clone().sub(start).normalize();
    rider.current = { id: ride.id, segment: 0, along: 0, point: start, heading, look: camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(60)), speed: 0, boarded: false };
    flight.current = undefined;
  }, [ride?.id, ride?.points]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const r = rider.current;
    if (ride && r) {
      const points = ride.points.map((p) => new THREE.Vector3(...p));
      // Distance left to the end of the known route: the ride slows down towards it (a choice or the end).
      let left = 0;
      if (r.segment < points.length - 1) {
        left = points[r.segment + 1].distanceTo(r.point);
        for (let i = r.segment + 1; i < points.length - 1; i++) left += points[i].distanceTo(points[i + 1]);
      }
      // First the camera flies to its place behind the call; only then does the call set off.
      const behind = r.point.clone().addScaledVector(r.heading, -RIDE_BEHIND).add(new THREE.Vector3(0, RIDE_ABOVE, 0));
      if (!r.boarded && camera.position.distanceTo(behind) < 4) r.boarded = true;
      const wanted = ride.playing && r.boarded ? Math.min(RIDE_SPEED, Math.max(4, left * 0.9)) : 0;
      r.speed += (wanted - r.speed) * (1 - Math.exp(-step * 2.5));
      let travel = r.speed * step;
      while (travel > 0 && r.segment < points.length - 1) {
        const from = points[r.segment];
        const to = points[r.segment + 1];
        const length = from.distanceTo(to);
        const room = length - r.along;
        if (travel < room) { r.along += travel; travel = 0; } else { travel -= room; r.segment++; r.along = 0; }
        const a = points[r.segment];
        const b = points[Math.min(r.segment + 1, points.length - 1)];
        const segLength = a.distanceTo(b);
        r.point.copy(segLength > 0 ? a.clone().lerp(b, r.along / segLength) : a);
      }
      // Head towards the next point (or keep the last heading at the end).
      const target = r.segment < points.length - 1 ? points[r.segment + 1] : undefined;
      if (target && target.distanceTo(r.point) > 0.01) r.heading.lerp(target.clone().sub(r.point).normalize(), 1 - Math.exp(-step * 1.8)).normalize();
      const desired = r.point.clone().addScaledVector(r.heading, -RIDE_BEHIND).add(new THREE.Vector3(0, RIDE_ABOVE, 0));
      camera.position.lerp(desired, 1 - Math.exp(-step * (r.boarded ? 2.2 : 2.8)));
      r.look.lerp(r.point.clone().addScaledVector(r.heading, 20), 1 - Math.exp(-step * 2.5));
      camera.lookAt(r.look);
      look.current.setFromQuaternion(camera.quaternion, "YXZ");
      if (call.current) { call.current.position.copy(r.point); call.current.scale.setScalar(1 + 0.25 * Math.sin(performance.now() / 180)); }
      return;
    }
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

  // The call being followed: a bright point the camera rides behind.
  return ride ? (
    <mesh ref={call} raycast={() => null}>
      <sphereGeometry args={[1.3, 16, 12]} />
      <meshBasicMaterial color="#ffffff" fog={false} />
    </mesh>
  ) : null;
}

export function Scene({ depth = 1, nodes, edges, positions, lit, selected, hovered, mode, goal, issues, scales, handle, ride, labelKeys, colors, labelSuffix, conversations, arrivals, onHover, onSelect }: SceneProps): React.ReactElement {
  const byKind = useMemo(() => KIND_ORDER.map((kind) => ({ kind, nodes: nodes.filter((n) => n.kind === kind) })).filter((g) => g.nodes.length), [nodes]);
  const nodeByKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);

  // Names float next to the hovered node, the selected node and what it's directly linked to;
  // the rest of the chain is lit but unlabelled, or the labels pile up.
  const labelled = useMemo(() => {
    const keys = new Set<string>(labelKeys ?? []);
    if (selected && !labelKeys) {
      keys.add(selected);
      edges.forEach((e) => { if (e.from === selected) keys.add(e.to); if (e.to === selected) keys.add(e.from); });
    }
    if (hovered) keys.add(hovered);
    labelSuffix?.forEach((_, k) => keys.add(k));
    return [...keys].slice(0, 60).map((k) => nodeByKey.get(k)).filter((n): n is GraphNode => !!n);
  }, [edges, selected, hovered, nodeByKey, labelKeys, labelSuffix]);

  const selectedPosition = selected ? positions.get(selected) : undefined;
  const markers = useMemo(() => {
    const visible = new Set(nodes.map((n) => n.key));
    const of = (severity: Severity) => [...(issues ?? new Map<string, Severity>()).entries()].filter(([k, s]) => s === severity && visible.has(k)).map(([k]) => k);
    return { problem: of("problem"), warning: of("warning") };
  }, [issues, nodes]);

  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: START_POSITION, fov: 55, near: 0.5, far: 4000 }} onCreated={({ camera }) => camera.lookAt(0, 0, 0)}>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[BACKGROUND, 220 * depth, 900 * depth]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[80, 120, 160]} intensity={1.6} />
      <directionalLight position={[-120, -40, -160]} intensity={0.5} color="#88aaff" />
      <Stars radius={700} depth={200} count={2500} factor={5} fade speed={0.4} />

      <LayerRings nodes={nodes} positions={positions} depth={depth} />
      <Edges nodes={nodes} edges={edges} positions={positions} lit={lit} />
      {byKind.map((g) => (
        <KindMesh key={g.kind} kind={g.kind} nodes={g.nodes} positions={positions} scales={scales} colors={colors} lit={lit} onHover={onHover} onSelect={onSelect} />
      ))}
      {selectedPosition && <SelectionMarker position={selectedPosition} scale={(selected && scales?.get(selected)) || 1} />}
      {conversations && <ConversationParticles conversations={conversations} positions={positions} />}
      {arrivals?.map((a) => <Arrival key={a.id} from={a.from} to={a.to} />)}
      <IssueMarkers severity="problem" keys={markers.problem} positions={positions} scales={scales} />
      <IssueMarkers severity="warning" keys={markers.warning} positions={positions} scales={scales} />

      {labelled.map((n) => (
        <Html key={n.key} position={positions.get(n.key)} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
          <div className={`node-label${n.key === selected ? " selected" : ""}${n.key === hovered ? " hovered" : ""}`} style={{ borderColor: KINDS[n.kind].color }}>
            {n.name}{labelSuffix?.get(n.key) && <span className="suffix"> · {labelSuffix.get(n.key)}</span>}
          </div>
        </Html>
      ))}

      {mode === "orbit" && !ride && <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxDistance={1500} />}
      <CameraRig mode={ride ? "walk" : mode} goal={goal} handle={handle} ride={ride} depth={depth} />
    </Canvas>
  );
}
