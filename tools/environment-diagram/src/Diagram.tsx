// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Severity } from "../../environment-3d-explorer/src/health";
import { Connector, Diagram as DiagramModel, fit, KIND_COLOR, Point, pointAt, polylineLength, Shape } from "./layout";

// Draws the diagram as SVG, with pan and zoom (drag, wheel, buttons) and a minimap. Every colour is an
// attribute, not a CSS class, so the same SVG can be saved and opened in Visio or a browser.

export interface View { x: number; y: number; k: number }

export interface DiagramHandle {
  view(): View;
  setView(view: View, animate?: boolean): void;
  fitAll(): void;
  // Scrolls these shapes (all copies of a record) into view if they're off screen; the zoom stays.
  reveal(shapeIds: string[], always?: boolean): void;
  svg(): string;
  png(): Promise<string>;
}

export interface LiveMarks {
  presence: Map<string, string>;     // agent key -> presence colour
  presenceName: Map<string, string>; // agent key -> presence name
  waiting: Map<string, number>;      // queue key -> calls waiting
  handling: Map<string, number>;     // agent key -> conversations now
  open: Map<string, number>;         // workstream key -> conversations open
}

export interface Ride { id: number; points: Point[]; playing: boolean }
export interface Arrival { id: string; points: Point[] }

export const SEVERITY_COLORS: Record<Severity, string> = { problem: "#dc2626", warning: "#d97706" };
const SELECT = "#2563eb";
const LINE = "#8796ab";
const INK = "#1f2a37";
const QUIET = "#64748b";
const FONT_FAMILY = "Segoe UI, Manrope, Arial, sans-serif";
const MIN_K = 0.06, MAX_K = 3;
const RIDE_SPEED = 300; // diagram units per second

// A light tint of a colour, for header bands and tags.
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * (1 - amount));
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

const path = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

interface Props {
  diagram: DiagramModel;
  lit?: Set<string>;
  selected?: string;
  hovered?: string;
  issues?: Map<string, Severity>;
  live?: LiveMarks;
  ride?: Ride;
  arrivals?: Arrival[];
  // The ride's own records, drawn on top of the dimming.
  routeKeys?: Set<string>;
  handle: React.MutableRefObject<DiagramHandle | null>;
  // Screen width covered on the left by the panel: fitting keeps the diagram clear of it.
  leftInset?: number;
  onSelect(key: string): void;
  onHover(key: string | undefined): void;
  onBackground(): void;
}

function ShapeView({ s, dim, selected, hovered, severity, live, onSelect, onHover }: {
  s: Shape; dim: boolean; selected: boolean; hovered: boolean; severity?: Severity; live?: LiveMarks;
  onSelect(key: string): void; onHover(key: string | undefined): void;
}) {
  const color = s.color ?? KIND_COLOR(s.kind);
  const clickable = !!s.nodeKey;
  const outline = selected ? SELECT : severity ? SEVERITY_COLORS[severity] : hovered ? shade(color, 0.25) : undefined;
  const outlineWidth = selected ? 2.5 : severity ? 2 : 1.6;
  const events = clickable ? {
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); if (!(e.currentTarget as any).ownerSVGElement?.dataset.dragged) onSelect(s.nodeKey!); },
    onMouseEnter: () => onHover(s.nodeKey),
    onMouseLeave: () => onHover(undefined),
    style: { cursor: "pointer" }
  } : {};
  const badge = severity && (
    <g>
      <circle cx={s.x + s.w - 2} cy={s.y + 2} r={8} fill={SEVERITY_COLORS[severity]} stroke="#fff" strokeWidth={1.5} />
      <text x={s.x + s.w - 2} y={s.y + 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" fontFamily={FONT_FAMILY}>!</text>
    </g>
  );
  const opacity = dim ? 0.18 : 1;

  if (s.role === "container") {
    const header = s.header ?? 30;
    const group = s.kind === "center" || s.kind === "group";
    const waiting = s.nodeKey ? live?.waiting.get(s.nodeKey) : undefined;
    const open = s.nodeKey ? live?.open.get(s.nodeKey) : undefined;
    const subRight = s.sub ? fit(s.sub, s.w * 0.45, 10.5) : "";
    return (
      <g opacity={opacity} {...events}>
        <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={group ? 10 : 6} fill={group ? tint(color, 0.06) : "#ffffff"}
          stroke={outline ?? (group ? tint(color, 0.7) : "#c5d0dd")} strokeWidth={outline ? outlineWidth : 1.2} strokeDasharray={group ? "6 4" : undefined} />
        {!group && <path d={`M${s.x} ${s.y + header}V${s.y + 6}Q${s.x} ${s.y} ${s.x + 6} ${s.y}H${s.x + s.w - 6}Q${s.x + s.w} ${s.y} ${s.x + s.w} ${s.y + 6}V${s.y + header}Z`} fill={tint(color, 0.22)} />}
        {!group && <rect x={s.x} y={s.y} width={4} height={s.h} fill={color} />}
        <text x={s.x + 12} y={s.y + header / 2 + 4.5} fontSize={group ? 12 : 13} fontWeight={700} fill={group ? shade(color, 0.35) : INK} fontFamily={FONT_FAMILY}>
          {fit(s.label, s.w - 30 - (subRight ? textW(subRight, 10.5) + 10 : 0) - (waiting ? 70 : 0), 13)}
        </text>
        {subRight && <text x={s.x + s.w - 10} y={s.y + header / 2 + 4} textAnchor="end" fontSize={10.5} fill={QUIET} fontFamily={FONT_FAMILY}>{subRight}</text>}
        {!!waiting && (
          <g>
            <rect x={s.x + s.w - textW(subRight, 10.5) - 86} y={s.y + header / 2 - 9} width={68} height={18} rx={9} fill="#fde047" />
            <text x={s.x + s.w - textW(subRight, 10.5) - 52} y={s.y + header / 2 + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#713f12" fontFamily={FONT_FAMILY}>{waiting} waiting</text>
          </g>
        )}
        {!!open && !waiting && (
          <text x={s.x + s.w - 10} y={s.y + header + 14} textAnchor="end" fontSize={10} fill="#0e7490" fontFamily={FONT_FAMILY}>{open} open now</text>
        )}
        {badge}
      </g>
    );
  }

  if (s.role === "pill") {
    return (
      <g opacity={opacity} {...events}>
        <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.h / 2} fill={s.nodeKey ? tint(color, 0.2) : "#eef2f7"} stroke={outline ?? tint(color, 0.55)} strokeWidth={outline ? outlineWidth : 1} />
        <text x={s.x + s.w / 2} y={s.y + s.h / 2 + 3.6} textAnchor="middle" fontSize={10.5} fill={INK} fontFamily={FONT_FAMILY}>{fit(s.label, s.w - 10, 10.5)}</text>
      </g>
    );
  }

  if (s.role === "row") {
    const isRule = s.kind === "rule";
    const quiet = s.kind === "default" || s.kind === "group";
    const presence = s.kind === "agent" && s.nodeKey ? live?.presence.get(s.nodeKey) : undefined;
    const handling = s.kind === "agent" && s.nodeKey ? live?.handling.get(s.nodeKey) : undefined;
    const iconX = s.x + 13, iconY = s.y + (isRule ? 14 : s.h / 2);
    const nameWidth = s.kind === "agent" ? Math.min(132, s.w - 40) : s.w - 40;
    return (
      <g opacity={opacity} {...events}>
        <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={4} fill={quiet ? "#f8fafc" : "#f3f6fa"} stroke={outline ?? (quiet ? "#e2e8f0" : "transparent")} strokeWidth={outline ? outlineWidth : 1} strokeDasharray={quiet ? "4 3" : undefined} />
        {isRule && <path d={`M${iconX} ${iconY - 7}L${iconX + 7} ${iconY}L${iconX} ${iconY + 7}L${iconX - 7} ${iconY}Z`} fill={tint(color, 0.35)} stroke={color} strokeWidth={1.2} />}
        {s.kind === "agent" && <circle cx={iconX} cy={iconY} r={presence ? 5 : 4.5} fill={presence ?? tint(color, 0.35)} stroke={presence ? "#fff" : color} strokeWidth={1.2} />}
        {s.kind === "bot" && <rect x={iconX - 6} y={iconY - 6} width={12} height={12} rx={3} fill={tint(color, 0.35)} stroke={color} strokeWidth={1.2} />}
        {s.kind === "hours" && <g><circle cx={iconX} cy={iconY} r={6} fill="#fff" stroke={color} strokeWidth={1.2} /><path d={`M${iconX} ${iconY - 3.5}V${iconY}L${iconX + 3} ${iconY + 1.5}`} stroke={color} strokeWidth={1.2} fill="none" /></g>}
        {quiet && <text x={iconX} y={iconY + 4} textAnchor="middle" fontSize={12} fill={QUIET} fontFamily={FONT_FAMILY}>↳</text>}
        <text x={s.x + 26} y={isRule ? s.y + 17 : s.y + s.h / 2 + (s.kind === "agent" && s.h > 32 ? -s.h / 2 + 19 : 4)} fontSize={12} fontWeight={isRule ? 600 : 500} fontStyle={quiet ? "italic" : undefined} fill={quiet ? QUIET : INK} fontFamily={FONT_FAMILY}>
          {fit(s.label, nameWidth, 12)}
        </text>
        {s.sub && isRule && <text x={s.x + 26} y={s.y + 32} fontSize={10.5} fill={QUIET} fontFamily={FONT_FAMILY}>{fit(s.sub, s.w - 36, 10.5)}</text>}
        {s.sub && !isRule && s.kind !== "agent" && <text x={s.x + s.w - 8} y={s.y + s.h / 2 + 3.6} textAnchor="end" fontSize={10} fill={QUIET} fontFamily={FONT_FAMILY}>{s.sub}</text>}
        {!!handling && <g><circle cx={s.x + s.w - 10} cy={s.y + 10} r={5} fill="#67e8f9" stroke="#0e7490" strokeWidth={1} /><text x={s.x + s.w - 10} y={s.y + 13.2} textAnchor="middle" fontSize={8} fontWeight={700} fill="#083344" fontFamily={FONT_FAMILY}>{handling}</text></g>}
        {badge}
      </g>
    );
  }

  // Free-standing shapes: phone numbers (a pill), voice channels, overflow actions.
  const isPhone = s.kind === "phone";
  const isOverflow = s.kind === "overflow";
  return (
    <g opacity={opacity} {...events}>
      <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={isPhone ? s.h / 2 : 6} fill="#ffffff" stroke={outline ?? (isOverflow ? tint(color, 0.8) : tint(color, 0.85))} strokeWidth={outline ? outlineWidth : 1.4} strokeDasharray={isOverflow ? "5 3" : undefined} />
      {!isPhone && <rect x={s.x} y={s.y + 4} width={4} height={s.h - 8} rx={2} fill={color} />}
      {isPhone && (
        <path transform={`translate(${s.x + 9} ${s.y + s.h / 2 - 7}) scale(0.58)`} fill={color}
          d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
      )}
      <text x={s.x + (isPhone ? 26 : 14)} y={s.y + (s.sub ? 17 : s.h / 2 + 4)} fontSize={12} fontWeight={600} fill={INK} fontFamily={FONT_FAMILY}>{fit(s.label, s.w - (isPhone ? 34 : 22), 12)}</text>
      {s.sub && <text x={s.x + 14} y={s.y + 31} fontSize={10.5} fill={QUIET} fontFamily={FONT_FAMILY}>{fit(s.sub, s.w - 22, 10.5)}</text>}
      {badge}
    </g>
  );
}

const textW = (text: string, size: number) => text.length * size * 0.56;

function ConnectorView({ c, state, color }: { c: Connector; state: "normal" | "lit" | "dim"; color: string }) {
  const lit = state === "lit";
  const stroke = lit ? shade(color, 0.15) : LINE;
  const last = c.points[c.points.length - 1];
  const before = c.points[c.points.length - 2] ?? last;
  // The label sits on the last stretch, just before the arrow.
  const lx = before[0] === last[0] ? last[0] + 6 : Math.max(before[0], last[0] - 46);
  const ly = before[0] === last[0] ? (before[1] + last[1]) / 2 : last[1] - 5;
  return (
    <g opacity={state === "dim" ? 0.1 : 1}>
      <path d={path(c.points)} fill="none" stroke={stroke} strokeWidth={lit ? 2.4 : 1.3} strokeDasharray={c.dashed ? "6 4" : undefined}
        markerEnd={`url(#arrow-${lit ? "lit" : "normal"})`} strokeLinejoin="round" />
      {c.label && (
        <g>
          <rect x={lx - 3} y={ly - 9} width={textW(c.label, 10) + 6} height={12} rx={2} fill="#ffffff" opacity={0.9} />
          <text x={lx} y={ly} fontSize={10} fill={lit ? INK : QUIET} fontFamily={FONT_FAMILY}>{c.label}</text>
        </g>
      )}
    </g>
  );
}

export function DiagramView(props: Props): React.ReactElement {
  const { diagram, lit, selected, hovered, issues, live, ride, arrivals, routeKeys, handle, onSelect, onHover, onBackground } = props;
  const inset = props.leftInset ?? 0;
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const animation = useRef<number | undefined>(undefined);
  const fitted = useRef(false);

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth > 0 && el.clientHeight > 0) setSize({ w: el.clientWidth, h: el.clientHeight }); };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const stop = () => { if (animation.current !== undefined) cancelAnimationFrame(animation.current); animation.current = undefined; };
  const setView = useCallback((target: View, animate = true) => {
    stop();
    if (!animate) { setViewState(target); return; }
    const from = viewRef.current;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 450);
      const e = 1 - Math.pow(1 - t, 3);
      setViewState({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e });
      animation.current = t < 1 ? requestAnimationFrame(step) : undefined;
    };
    animation.current = requestAnimationFrame(step);
  }, []);

  // The part of the screen the diagram can use: right of the panel (on a wide screen).
  const left = size.w > 900 ? inset : 0;
  const fitBox = useCallback((x: number, y: number, w: number, h: number, maxK = 1.2, animate = true) => {
    const margin = 30;
    const room = size.w - left - margin * 2;
    const k = Math.max(MIN_K, Math.min(maxK, room / Math.max(1, w), (size.h - margin * 2) / Math.max(1, h)));
    setView({ k, x: left + margin + room / 2 - (x + w / 2) * k, y: size.h / 2 - (y + h / 2) * k }, animate);
  }, [size, setView, left]);

  const fitAll = useCallback(() => fitBox(0, 0, diagram.width, diagram.height, 1, true), [fitBox, diagram]);

  // At the start, the full width fits and the top shows: readable straight away. Fit shows it all.
  const fitWidth = useCallback((animate: boolean) => {
    const margin = 20;
    const room = size.w - left - margin * 2;
    const k = Math.max(MIN_K, Math.min(1.4, room / Math.max(1, diagram.width)));
    setView({ k, x: left + margin + (room - diagram.width * k) / 2, y: 6 }, animate);
  }, [size, left, diagram, setView]);
  useEffect(() => {
    if (fitted.current || size.w < 50) return;
    fitted.current = true;
    fitWidth(false);
  }, [size, fitWidth]);

  const exportSvg = useCallback(() => {
    const inner = contentRef.current?.innerHTML ?? "";
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(diagram.width)}" height="${Math.ceil(diagram.height)}" viewBox="0 0 ${Math.ceil(diagram.width)} ${Math.ceil(diagram.height)}">${defs()}<rect width="100%" height="100%" fill="#ffffff"/>${inner}</svg>`;
  }, [diagram]);

  useImperativeHandle(handle, () => ({
    view: () => viewRef.current,
    setView,
    fitAll,
    reveal: (ids: string[], always = false) => {
      // The first copy decides: if it's on screen already, nothing moves.
      const shape = ids.map((id) => diagram.shapeById.get(id)).find((s): s is Shape => !!s);
      if (!shape) return;
      const v = viewRef.current;
      const sx0 = shape.x * v.k + v.x, sy0 = shape.y * v.k + v.y;
      const sx1 = (shape.x + shape.w) * v.k + v.x, sy1 = (shape.y + Math.min(shape.h, 120)) * v.k + v.y;
      if (!always && sx0 >= left + 10 && sx1 <= size.w - 10 && sy0 >= 10 && sy1 <= size.h - 10) return;
      const room = size.w - left;
      setView({ k: v.k, x: left + room / 2 - (shape.x + shape.w / 2) * v.k, y: size.h / 3 - shape.y * v.k });
    },
    svg: exportSvg,
    png: () => new Promise<string>((resolve, reject) => {
      const scale = Math.min(2, 16000 / diagram.width, 16000 / diagram.height);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(diagram.width * scale);
        canvas.height = Math.ceil(diagram.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("No canvas")); return; }
        ctx.scale(scale, scale);
        ctx.drawImage(image, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => reject(new Error("The diagram couldn't be drawn as a picture."));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(exportSvg())}`;
    })
  }), [diagram, setView, fitAll, fitBox, exportSvg, size, left]);

  // Pan by dragging the background (or anything: a drag never counts as a click), zoom with the wheel.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | undefined>(undefined);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    stop();
    drag.current = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
    delete svgRef.current!.dataset.dragged;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) { d.moved = true; svgRef.current!.dataset.dragged = "1"; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); }
    setViewState({ ...viewRef.current, x: d.vx + dx, y: d.vy + dy });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = undefined;
    // Let the click that follows a drag see it was a drag, then forget.
    if (d?.moved) setTimeout(() => { if (svgRef.current) delete svgRef.current.dataset.dragged; }, 0);
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      stop();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const v = viewRef.current;
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * Math.exp(-e.deltaY * 0.0015)));
      setViewState({ k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  // Follow the call: a dot runs along the route; the view keeps it in sight.
  const [rideDistance, setRideDistance] = useState(0);
  const rideLength = useMemo(() => (ride ? polylineLength(ride.points) : 0), [ride?.points]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRideDistance(0); }, [ride?.id]);
  useEffect(() => {
    if (!ride?.playing || !ride.points.length) return;
    let last = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setRideDistance((d) => {
        const next = Math.min(rideLength, d + dt * RIDE_SPEED);
        const [px, py] = pointAt(ride.points, next);
        const v = viewRef.current;
        const k = Math.max(v.k, 0.85);
        // Keep the dot within the middle of the screen.
        const sx = px * k + v.x, sy = py * k + v.y;
        const mx = size.w * 0.3, my = size.h * 0.3;
        if (k !== v.k || sx < mx || sx > size.w - mx || sy < my || sy > size.h - my) {
          setViewState({ k, x: v.x + (size.w / 2 - (px * k + v.x)) * 0.06, y: v.y + (size.h / 2 - (py * k + v.y)) * 0.06 });
        }
        return next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ride?.id, ride?.playing, rideLength, size]); // eslint-disable-line react-hooks/exhaustive-deps

  // New calls: a dot along the line from the workstream to the queue, then gone.
  const [arrivalTime, setArrivalTime] = useState(0);
  useEffect(() => {
    if (!arrivals?.length) return;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => { const t = Math.min(1, (now - started) / 1600); setArrivalTime(t); if (t < 1) frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [arrivals]);

  const shapeLit = (s: Shape) => !lit || (s.nodeKey ? lit.has(s.nodeKey) : !!s.parent && !!diagram.shapeById.get(s.parent)?.nodeKey && lit.has(diagram.shapeById.get(s.parent)!.nodeKey!));
  const containers = diagram.shapes.filter((s) => s.role === "container");
  const others = diagram.shapes.filter((s) => s.role !== "container");
  const connectorState = (c: Connector): "normal" | "lit" | "dim" => (!lit ? "normal" : lit.has(c.from) && lit.has(c.to) ? "lit" : "dim");
  const ridePoint = ride && ride.points.length ? pointAt(ride.points, rideDistance) : undefined;
  const travelled = useMemo(() => {
    if (!ride || !ride.points.length) return [];
    const pts: Point[] = [ride.points[0]];
    let left = rideDistance;
    for (let i = 1; i < ride.points.length && left > 0; i++) {
      const len = Math.hypot(ride.points[i][0] - ride.points[i - 1][0], ride.points[i][1] - ride.points[i - 1][1]);
      if (left >= len) { pts.push(ride.points[i]); left -= len; } else { pts.push(pointAt([ride.points[i - 1], ride.points[i]], left)); left = 0; }
    }
    return pts;
  }, [ride, rideDistance]);
  void routeKeys;

  const { x, y, k } = view;
  const mini = { w: 190, h: Math.max(60, Math.min(220, (190 * diagram.height) / Math.max(1, diagram.width))) };
  const miniK = Math.min(mini.w / Math.max(1, diagram.width), mini.h / Math.max(1, diagram.height));

  return (
    <div className="diagram-wrap">
      <svg ref={svgRef} className="diagram" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onClick={() => { if (!svgRef.current?.dataset.dragged) onBackground(); }}>
        <defs dangerouslySetInnerHTML={{ __html: gridDef(k, x, y) }} />
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${x} ${y}) scale(${k})`}>
          <g ref={contentRef}>
            {diagram.lanes.map((lane, i) => (
              <g key={lane.title}>
                <rect x={lane.x - 14} y={30} width={lane.w + 28} height={diagram.height - 42} rx={8} fill={i % 2 ? "#f1f5f9" : "#f8fafc"} opacity={0.75} />
                <rect x={lane.x - 14} y={30} width={lane.w + 28} height={30} rx={8} fill="#334155" />
                <text x={lane.x + lane.w / 2} y={50} textAnchor="middle" fontSize={12} fontWeight={700} letterSpacing={0.6} fill="#f8fafc" fontFamily={FONT_FAMILY}>{lane.title.toUpperCase()}</text>
              </g>
            ))}
            {containers.map((s) => (
              <ShapeView key={s.id} s={s} dim={!shapeLit(s)} selected={!!selected && s.nodeKey === selected} hovered={!!hovered && s.nodeKey === hovered}
                severity={s.nodeKey ? issues?.get(s.nodeKey) : undefined} live={live} onSelect={onSelect} onHover={onHover} />
            ))}
            {diagram.connectors.map((c) => <ConnectorView key={c.id} c={c} state={connectorState(c)} color={KIND_COLOR(diagram.shapeById.get(c.toShape)?.kind ?? "queue")} />)}
            {others.map((s) => (
              <ShapeView key={s.id} s={s} dim={!shapeLit(s)} selected={!!selected && s.nodeKey === selected} hovered={!!hovered && s.nodeKey === hovered}
                severity={s.nodeKey && s.kind !== "default" ? issues?.get(s.nodeKey) : undefined} live={live} onSelect={onSelect} onHover={onHover} />
            ))}
            {ride && ride.points.length > 1 && (
              <g pointerEvents="none">
                <path d={path(ride.points)} fill="none" stroke={SELECT} strokeOpacity={0.18} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" />
                <path d={path(travelled)} fill="none" stroke={SELECT} strokeWidth={3.2} strokeLinejoin="round" strokeLinecap="round" />
                {ridePoint && <circle cx={ridePoint[0]} cy={ridePoint[1]} r={7} fill={SELECT} stroke="#fff" strokeWidth={2.5} />}
              </g>
            )}
            {arrivals?.map((a) => {
              const p = pointAt(a.points, polylineLength(a.points) * arrivalTime);
              return arrivalTime < 1 ? <circle key={a.id} cx={p[0]} cy={p[1]} r={6} fill="#facc15" stroke="#854d0e" strokeWidth={1.5} pointerEvents="none" /> : null;
            })}
          </g>
        </g>
      </svg>

      <svg className="minimap" width={mini.w} height={mini.h} onClick={(e) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const dx = (e.clientX - rect.left) / miniK, dy = (e.clientY - rect.top) / miniK;
        setView({ k, x: size.w / 2 - dx * k, y: size.h / 2 - dy * k });
      }}>
        <rect width={mini.w} height={mini.h} fill="#ffffff" />
        {containers.map((s) => <rect key={s.id} x={s.x * miniK} y={s.y * miniK} width={Math.max(1, s.w * miniK)} height={Math.max(1, s.h * miniK)}
          fill={s.kind === "center" || s.kind === "group" ? "none" : tint(KIND_COLOR(s.kind), 0.45)} stroke={s.nodeKey && (s.nodeKey === selected || (issues?.has(s.nodeKey) ?? false)) ? (s.nodeKey === selected ? SELECT : SEVERITY_COLORS[issues!.get(s.nodeKey)!]) : "none"} strokeWidth={1} />)}
        <rect x={(-x / k) * miniK} y={(-y / k) * miniK} width={(size.w / k) * miniK} height={(size.h / k) * miniK} fill="rgba(37, 99, 235, .08)" stroke={SELECT} strokeWidth={1.2} />
      </svg>

      <div className="zoom">
        <button onClick={() => setView({ k: Math.max(MIN_K, k / 1.25), x: size.w / 2 - ((size.w / 2 - x) * Math.max(MIN_K, k / 1.25)) / k, y: size.h / 2 - ((size.h / 2 - y) * Math.max(MIN_K, k / 1.25)) / k })} aria-label="Zoom out">−</button>
        <span>{Math.round(k * 100)}%</span>
        <button onClick={() => setView({ k: Math.min(MAX_K, k * 1.25), x: size.w / 2 - ((size.w / 2 - x) * Math.min(MAX_K, k * 1.25)) / k, y: size.h / 2 - ((size.h / 2 - y) * Math.min(MAX_K, k * 1.25)) / k })} aria-label="Zoom in">+</button>
        <button onClick={fitAll} title="Fit the whole diagram (0)">Fit</button>
        <button onClick={() => setView({ k: 1, x: size.w / 2 - ((size.w / 2 - x) * 1) / k, y: size.h / 2 - ((size.h / 2 - y) * 1) / k })} title="Actual size">100%</button>
      </div>
    </div>
  );
}

// The arrowheads (also in the saved SVG).
function defs(): string {
  return `<defs>
<marker id="arrow-normal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${LINE}"/></marker>
<marker id="arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#334155"/></marker>
</defs>`;
}

// The arrowheads, plus a dot grid that moves and scales with the page, as in Visio.
function gridDef(k: number, x: number, y: number): string {
  const step = 20 * k;
  const visible = step >= 6;
  return `${defs().replace(/^<defs>|<\/defs>$/g, "")}
<pattern id="grid" width="${step}" height="${step}" patternUnits="userSpaceOnUse" x="${x % step}" y="${y % step}">
${visible ? `<circle cx="1" cy="1" r="${Math.min(1.2, 0.6 + k * 0.4)}" fill="#cbd5e1"/>` : ""}
</pattern>`;
}
