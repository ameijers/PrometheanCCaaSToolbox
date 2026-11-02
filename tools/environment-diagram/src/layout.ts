// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Graph, GraphEdge, GraphNode, KINDS, NodeKind } from "../../environment-3d-explorer/src/model";

// The environment as a Visio-style diagram: a cross-functional flowchart that reads left to right, the
// way a call travels. Pure: it turns the 3D Explorer's graph into boxes and right-angled connectors,
// and Diagram.tsx only draws them.
//
// Swimlanes, left to right: phone numbers · voice channels · workstreams & routing · queues & agents ·
// overflow. What belongs to a record is drawn inside it, as in a Visio container:
//   - a workstream is a container with its bot, its route-to-queue rules in order, the "otherwise"
//     default queue, and its context variables and capacity profiles as tags;
//   - a queue is a container with its operating hours and its members (agents), each agent with their
//     skills, capacity profiles, teams and business unit as tags. An agent in three queues is drawn in
//     all three, and selecting one lights up every copy;
//   - customer centers (the groups made in 3D Contact Center) are containers around their workstreams.
// Lines are drawn only for what a call travels: number -> channel -> workstream (or its bot),
// rule or default -> queue, queue -> overflow, and an overflow's transfer to another queue.

export type ShapeKind = NodeKind | "center" | "default" | "group";
export type ShapeRole = "container" | "row" | "node" | "pill";

export interface Shape {
  id: string;
  // The graph record it draws; a container's own rows have their own records.
  nodeKey?: string;
  kind: ShapeKind;
  role: ShapeRole;
  x: number; y: number; w: number; h: number;
  label: string;
  sub?: string;
  // A container's title band height, so rows start below it.
  header?: number;
  color?: string;
  // The container a row or tag sits in.
  parent?: string;
}

export type Point = [number, number];

export interface Connector {
  id: string;
  // Graph records at both ends: the line lights up when both do.
  from: string;
  to: string;
  kind: GraphEdge["kind"];
  fromShape: string;
  toShape: string;
  points: Point[];
  label?: string;
  dashed?: boolean;
}

export interface Lane { title: string; x: number; w: number }

export interface Diagram {
  shapes: Shape[];
  connectors: Connector[];
  lanes: Lane[];
  width: number;
  height: number;
  // Every shape that draws a record (an agent in three queues has three).
  byNode: Map<string, string[]>;
  shapeById: Map<string, Shape>;
}

export interface CenterGroup { id: string; name: string; color: string; workstreams: string[]; custom?: boolean }

export interface LayoutOptions {
  // Record kinds not drawn (workstreams and queues are always drawn: they carry the structure).
  hidden?: Set<NodeKind>;
  // Only these records (follow the chain, only issues, only the route).
  visible?: (key: string) => boolean;
  // 1 to 3: how far apart the swimlanes are.
  spacing?: number;
  // Customer centers from 3D Contact Center; workstream record ids.
  centers?: CenterGroup[];
}

// Sizes, in diagram units (1 unit is 1 pixel at 100%).
const PAD = 32;
const LANE_HEAD = 46;
const HEAD = 34;
const ROW = 28;
const RULE_ROW = 40;
const AGENT_ROW = 30;
const PILL_H = 18;
const GAP = 22;
const COL = { phone: 158, channel: 190, workstream: 320, queue: 320, overflow: 190 };

export const FONT = 12;
// An estimate of how wide text is, for sizing and cutting labels (no DOM: the layout is pure).
export function textWidth(text: string, size = FONT): number {
  return text.length * size * 0.56;
}
export function fit(text: string, width: number, size = FONT): string {
  if (textWidth(text, size) <= width) return text;
  const max = Math.max(1, Math.floor(width / (size * 0.56)) - 1);
  return `${text.slice(0, max)}…`;
}

const orderOf = (n: GraphNode) => Number(n.details.find(([label]) => label === "Order")?.[1] ?? Number.MAX_SAFE_INTEGER);
const detail = (n: GraphNode, label: string) => n.details.find(([l]) => l === label)?.[1];
const STREAM_LABEL: Record<string, string> = { voice: "Voice", messaging: "Messaging", records: "Records" };

export function computeDiagram(graph: Graph, options: LayoutOptions = {}): Diagram {
  const hidden = options.hidden ?? new Set<NodeKind>();
  const spacing = Math.min(3, Math.max(1, options.spacing ?? 1));
  const nodeByKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const shown = (key: string | undefined): key is string => {
    const n = key ? nodeByKey.get(key) : undefined;
    if (!n) return false;
    if (hidden.has(n.kind) && n.kind !== "workstream" && n.kind !== "queue") return false;
    return options.visible ? options.visible(n.key) : true;
  };
  const out = new Map<string, GraphEdge[]>();
  const into = new Map<string, GraphEdge[]>();
  graph.edges.forEach((e) => {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    into.set(e.to, [...(into.get(e.to) ?? []), e]);
  });
  const outOf = (key: string, kind?: GraphEdge["kind"]) => (out.get(key) ?? []).filter((e) => !kind || e.kind === kind);
  const intoOf = (key: string, kind?: GraphEdge["kind"]) => (into.get(key) ?? []).filter((e) => !kind || e.kind === kind);

  const shapes: Shape[] = [];
  const connectors: Connector[] = [];
  const add = (s: Shape) => { shapes.push(s); return s; };

  // Columns. A hidden lane takes no room.
  const showPhones = !hidden.has("phone");
  const showChannels = !hidden.has("channel");
  const showOverflow = !hidden.has("overflow");
  const gapEntry = 34 * spacing, gapIn = 64 * spacing, gapMid = 150 * spacing, gapOut = 70 * spacing;
  let x = PAD;
  const xPhone = x; if (showPhones) x += COL.phone + gapEntry;
  const xChannel = x; if (showChannels) x += COL.channel + gapIn;
  const xWs = x; x += COL.workstream + gapMid;
  const xQueue = x; x += COL.queue + gapOut;
  const xOverflow = x; if (showOverflow) x += COL.overflow;
  const lanes: Lane[] = [
    ...(showPhones ? [{ title: "Phone numbers", x: xPhone, w: COL.phone }] : []),
    ...(showChannels ? [{ title: "Voice channels", x: xChannel, w: COL.channel }] : []),
    { title: "Workstreams & routing", x: xWs, w: COL.workstream },
    { title: "Queues & agents", x: xQueue, w: COL.queue },
    ...(showOverflow ? [{ title: "Overflow", x: xOverflow, w: COL.overflow }] : [])
  ];

  // Tags (pills) in a row, wrapping inside a width. Returns the height used.
  const pills = (owner: Shape, keys: string[], left: number, top: number, width: number, maxLines = 3): number => {
    let px = left, py = top, lines = 1;
    for (let i = 0; i < keys.length; i++) {
      const n = nodeByKey.get(keys[i])!;
      const w = Math.min(width, textWidth(n.name, 10.5) + 16);
      if (px + w > left + width && px > left) {
        if (lines === maxLines) {
          add({ id: `more|${owner.id}`, kind: "group", role: "pill", x: px, y: py, w: 34, h: PILL_H, label: `+${keys.length - i}`, parent: owner.id });
          break;
        }
        px = left; py += PILL_H + 4; lines++;
      }
      add({ id: `pill|${owner.id}|${n.key}`, nodeKey: n.key, kind: n.kind, role: "pill", x: px, y: py, w, h: PILL_H, label: n.name, parent: owner.id });
      px += w + 4;
    }
    return keys.length ? py + PILL_H - top : 0;
  };

  // --- Workstreams, with their way in on the left. ---
  type Block = { ws: GraphNode; entries: { channel?: string; phone?: string }[] };
  const workstreams = graph.nodes.filter((n) => n.kind === "workstream" && shown(n.key)).sort((a, b) => a.name.localeCompare(b.name));
  const blocks = new Map<string, Block>(workstreams.map((ws) => {
    const bot = intoOf(ws.key, "handoff").map((e) => e.from)[0];
    const channelKeys = [...intoOf(ws.key, "channel"), ...(bot ? intoOf(bot, "bot") : [])].map((e) => e.from).filter((k) => nodeByKey.has(k));
    const entries = channelKeys
      .map((c) => ({ channel: showChannels && shown(c) ? c : undefined, phone: intoOf(c, "number").map((e) => e.from).find((p) => showPhones && shown(p)) }))
      .filter((e) => e.channel || e.phone)
      .sort((a, b) => (nodeByKey.get(a.channel ?? a.phone!)!.name).localeCompare(nodeByKey.get(b.channel ?? b.phone!)!.name));
    return [ws.key, { ws, entries }];
  }));

  // Customer centers: their workstreams together, in a container. Only centers the viewer made (or that
  // hold more than one workstream) get a container; the rest stand on their own.
  const groups: { center?: CenterGroup; items: Block[] }[] = [];
  const placed = new Set<string>();
  (options.centers ?? []).forEach((c) => {
    const items = c.workstreams.map((id) => blocks.get(`workstream:${id}`)).filter((b): b is Block => !!b && !placed.has(b.ws.key));
    if (!items.length || !(c.custom || c.workstreams.length > 1)) return;
    items.forEach((b) => placed.add(b.ws.key));
    groups.push({ center: c, items: items.sort((a, b) => a.ws.name.localeCompare(b.ws.name)) });
  });
  const loose = [...blocks.values()].filter((b) => !placed.has(b.ws.key));
  groups.push(...loose.map((b) => ({ items: [b] })));

  const rowSources: { key: string; from: string; shape: string; y: number; kind: GraphEdge["kind"]; to: string; label?: string; dashed?: boolean }[] = [];
  const entryLinks: { from: string; to: string; kind: GraphEdge["kind"]; fromShape: string; y: number; target: Shape; targetY: number }[] = [];
  let y = PAD + LANE_HEAD;
  const entryLeft = showPhones ? xPhone : showChannels ? xChannel : xWs;

  const drawWorkstream = (block: Block, top: number): number => {
    const { ws } = block;
    const container = add({
      id: `ws|${ws.key}`, nodeKey: ws.key, kind: "workstream", role: "container", x: xWs, y: top, w: COL.workstream, h: 0, header: HEAD,
      label: ws.name, sub: STREAM_LABEL[ws.facts?.stream ?? ""] ?? detail(ws, "Channel")
    });
    let cy = top + HEAD + 6;
    const bot = intoOf(ws.key, "handoff").map((e) => e.from).find((k) => shown(k));
    let botShape: Shape | undefined;
    if (bot) {
      botShape = add({ id: `row|${bot}`, nodeKey: bot, kind: "bot", role: "row", x: xWs + 8, y: cy, w: COL.workstream - 16, h: ROW, label: nodeByKey.get(bot)!.name, sub: "answers first", parent: container.id });
      cy += ROW + 4;
    }
    const rules = outOf(ws.key, "routes").map((e) => nodeByKey.get(e.to)!).filter((r) => r?.kind === "rule").sort((a, b) => orderOf(a) - orderOf(b));
    if (!hidden.has("rule")) {
      rules.filter((r) => shown(r.key)).forEach((r) => {
        const row = add({
          id: `row|${r.key}`, nodeKey: r.key, kind: "rule", role: "row", x: xWs + 8, y: cy, w: COL.workstream - 16, h: RULE_ROW,
          label: `${orderOf(r) === Number.MAX_SAFE_INTEGER ? "" : `${orderOf(r)}. `}${r.name}`, sub: `If ${detail(r, "Condition") ?? "always"}`, parent: container.id
        });
        outOf(r.key, "routes").filter((e) => shown(e.to)).forEach((e) => rowSources.push({ key: `${r.key}>${e.to}`, from: r.key, shape: row.id, y: cy + RULE_ROW / 2, kind: "routes", to: e.to, label: e.label }));
        cy += RULE_ROW + 4;
      });
    } else {
      // Rules not drawn: the workstream itself points at every queue its rules reach.
      const targets = [...new Set(rules.flatMap((r) => outOf(r.key, "routes").map((e) => e.to)))].filter((q) => shown(q));
      targets.forEach((q) => rowSources.push({ key: `${ws.key}>${q}`, from: ws.key, shape: container.id, y: top + HEAD / 2, kind: "routes", to: q }));
    }
    const defaultQueue = outOf(ws.key, "default").map((e) => e.to).find((q) => shown(q));
    if (defaultQueue) {
      const row = add({ id: `default|${ws.key}`, nodeKey: ws.key, kind: "default", role: "row", x: xWs + 8, y: cy, w: COL.workstream - 16, h: ROW, label: rules.length ? "Otherwise: default queue" : "Default queue", parent: container.id });
      rowSources.push({ key: `${ws.key}>default>${defaultQueue}`, from: ws.key, shape: row.id, y: cy + ROW / 2, kind: "default", to: defaultQueue, dashed: true });
      cy += ROW + 4;
    }
    if (!bot && !rules.length && !defaultQueue) {
      add({ id: `empty|${ws.key}`, kind: "group", role: "row", x: xWs + 8, y: cy, w: COL.workstream - 16, h: ROW, label: "Routes nowhere", parent: container.id });
      cy += ROW + 4;
    }
    const variables = outOf(ws.key, "variable").map((e) => e.to).filter((k) => shown(k));
    const capacity = outOf(ws.key, "capacity").map((e) => e.to).filter((k) => shown(k));
    if (variables.length || capacity.length) cy += 2;
    if (variables.length) cy += pills(container, variables, xWs + 10, cy, COL.workstream - 20) + 4;
    if (capacity.length) cy += pills(container, capacity, xWs + 10, cy, COL.workstream - 20) + 4;
    container.h = cy - top + 4;

    // The way in: channel (and its number) per row, next to the top of the workstream.
    const target = botShape ?? container;
    const targetY = botShape ? botShape.y + ROW / 2 : top + HEAD / 2;
    let ey = top;
    block.entries.forEach((entry) => {
      const rowY = ey;
      let channelShape: Shape | undefined;
      if (entry.channel) {
        const c = nodeByKey.get(entry.channel)!;
        channelShape = add({ id: `ch|${c.key}`, nodeKey: c.key, kind: "channel", role: "node", x: xChannel, y: rowY, w: COL.channel, h: 34, label: c.name });
        entryLinks.push({ from: c.key, to: bot ?? ws.key, kind: bot ? "bot" : "channel", fromShape: channelShape.id, y: rowY + 17, target, targetY });
      }
      if (entry.phone) {
        const p = nodeByKey.get(entry.phone)!;
        const phoneShape = add({ id: `ph|${entry.channel ?? ws.key}|${p.key}`, nodeKey: p.key, kind: "phone", role: "node", x: xPhone, y: rowY + 4, w: COL.phone, h: 26, label: p.name });
        if (channelShape) connectors.push({ id: `c|${p.key}>${channelShape.id}`, from: p.key, to: channelShape.nodeKey!, kind: "number", fromShape: phoneShape.id, toShape: channelShape.id, points: [[phoneShape.x + phoneShape.w, rowY + 17], [channelShape.x, rowY + 17]] });
        else entryLinks.push({ from: p.key, to: bot ?? ws.key, kind: "number", fromShape: phoneShape.id, y: rowY + 17, target, targetY });
      }
      ey += 34 + 8;
    });
    return Math.max(container.h, ey - top - 8);
  };

  groups.forEach((g) => {
    if (g.center) {
      const top = y;
      const frame = add({ id: `center|${g.center.id}`, kind: "center", role: "container", x: entryLeft - 14, y: top, w: xWs + COL.workstream + 14 - (entryLeft - 14), h: 0, header: 28, label: g.center.name, sub: "Customer center", color: g.center.color });
      y += 28 + 12;
      g.items.forEach((b) => { y += drawWorkstream(b, y) + GAP; });
      frame.h = y - GAP + 12 - top;
      y = top + frame.h + GAP;
    } else {
      y += drawWorkstream(g.items[0], y) + GAP;
    }
  });

  // Numbers and channels that lead to no workstream on the diagram.
  const drawnNodes = new Set(shapes.map((s) => s.nodeKey));
  const lostChannels = showChannels ? graph.nodes.filter((n) => n.kind === "channel" && shown(n.key) && !drawnNodes.has(n.key)) : [];
  const lostPhones = showPhones ? graph.nodes.filter((n) => n.kind === "phone" && shown(n.key) && !drawnNodes.has(n.key)) : [];
  if (lostChannels.length || lostPhones.length) {
    const top = y;
    const right = showChannels ? xChannel + COL.channel : xPhone + COL.phone;
    const frame = add({ id: "group|unconnected", kind: "group", role: "container", x: entryLeft - 14, y: top, w: right + 14 - (entryLeft - 14), h: 0, header: 28, label: "Not connected to a workstream" });
    let ey = top + 28 + 10;
    const rows = Math.max(lostChannels.length, lostPhones.length);
    for (let i = 0; i < rows; i++) {
      const c = lostChannels[i], p = lostPhones[i];
      if (c) add({ id: `ch|${c.key}`, nodeKey: c.key, kind: "channel", role: "node", x: xChannel, y: ey, w: COL.channel, h: 34, label: c.name, parent: frame.id });
      if (p) add({ id: `ph|lost|${p.key}`, nodeKey: p.key, kind: "phone", role: "node", x: xPhone, y: ey + 4, w: COL.phone, h: 26, label: p.name, parent: frame.id });
      ey += 34 + 8;
    }
    frame.h = ey - top + 4;
    y = top + frame.h + GAP;
  }
  const leftBottom = y;

  // Way-in connectors: right-angled, each in its own track through the gap.
  const entryGapLeft = showChannels ? xChannel + COL.channel : showPhones ? xPhone + COL.phone : xWs;
  entryLinks.sort((a, b) => a.targetY - b.targetY || a.y - b.y).forEach((l, i, all) => {
    const mid = entryGapLeft + (xWs - entryGapLeft) * (0.25 + 0.5 * (all.length > 1 ? i / (all.length - 1) : 0.5));
    const fromX = shapes.find((s) => s.id === l.fromShape)!;
    connectors.push({ id: `c|${l.fromShape}>${l.target.id}`, from: l.from, to: l.to, kind: l.kind, fromShape: l.fromShape, toShape: l.target.id, points: orthogonal([fromX.x + fromX.w, l.y], [l.target.x, l.targetY], mid) });
  });

  // --- Queues, each placed near the rules that route to it. ---
  const queues = graph.nodes.filter((n) => n.kind === "queue" && shown(n.key));
  const wanted = new Map<string, number>();
  queues.forEach((q) => {
    const ys = rowSources.filter((r) => r.to === q.key).map((r) => r.y);
    if (ys.length) wanted.set(q.key, ys.reduce((a, b) => a + b, 0) / ys.length);
  });
  // Queues reached through an overflow transfer go near the queue that transfers.
  const ordered = [...queues].sort((a, b) => (wanted.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (wanted.get(b.key) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
  let qy = PAD + LANE_HEAD;
  const queueShapes = new Map<string, Shape>();
  const overflowShapes = new Map<string, Shape>();
  ordered.forEach((q) => {
    const top = Math.max(qy, (wanted.get(q.key) ?? qy) - HEAD / 2);
    const members = outOf(q.key, "member").map((e) => nodeByKey.get(e.to)!).filter((a) => a && shown(a.key)).sort((a, b) => a.name.localeCompare(b.name));
    const memberCount = outOf(q.key, "member").length;
    const container = add({
      id: `q|${q.key}`, nodeKey: q.key, kind: "queue", role: "container", x: xQueue, y: top, w: COL.queue, h: 0, header: HEAD,
      label: q.name, sub: `${detail(q, "Type") ?? ""} · ${memberCount} member${memberCount === 1 ? "" : "s"}`
    });
    queueShapes.set(q.key, container);
    let cy = top + HEAD + 6;
    intoOf(q.key, "hours").map((e) => e.from).filter((k) => shown(k)).forEach((h) => {
      add({ id: `row|${q.key}|${h}`, nodeKey: h, kind: "hours", role: "row", x: xQueue + 8, y: cy, w: COL.queue - 16, h: 24, label: nodeByKey.get(h)!.name, sub: "operating hours", parent: container.id });
      cy += 24 + 4;
    });
    if (!hidden.has("agent")) {
      members.forEach((a) => {
        const row = add({ id: `ag|${q.key}|${a.key}`, nodeKey: a.key, kind: "agent", role: "row", x: xQueue + 8, y: cy, w: COL.queue - 16, h: AGENT_ROW, label: a.name, parent: container.id });
        const tags = (["skill", "capacity", "team", "businessunit"] as const).flatMap((kind) => outOf(a.key, kind).map((e) => e.to)).filter((k) => shown(k));
        const nameW = Math.min(140, textWidth(a.name, 12) + 28);
        if (tags.length) {
          const used = pills(row, tags, row.x + nameW, cy + 6, row.w - nameW - 6, 2);
          row.h = Math.max(AGENT_ROW, used + 12);
        }
        cy += row.h + 3;
      });
    }
    if (!members.length && !hidden.has("agent")) {
      add({ id: `empty|${q.key}`, kind: "group", role: "row", x: xQueue + 8, y: cy, w: COL.queue - 16, h: 24, label: memberCount ? "Members not shown" : "No members", parent: container.id });
      cy += 24 + 4;
    }
    container.h = Math.max(cy - top + 4, HEAD + 10);

    // Overflow, to the right of the queue, below its title (the title row stays free for transfers coming back).
    let oy = top + HEAD + 6;
    if (showOverflow) {
      outOf(q.key, "overflow").filter((e) => shown(e.to)).forEach((e) => {
        const o = nodeByKey.get(e.to)!;
        const shape = add({ id: `of|${o.key}`, nodeKey: o.key, kind: "overflow", role: "node", x: xOverflow, y: oy, w: COL.overflow, h: 40, label: o.name, sub: e.label });
        overflowShapes.set(o.key, shape);
        connectors.push({ id: `c|${q.key}>${o.key}`, from: q.key, to: o.key, kind: "overflow", fromShape: container.id, toShape: shape.id, points: [[xQueue + COL.queue, oy + 20], [xOverflow, oy + 20]], label: e.label });
        oy += 40 + 8;
      });
    }
    qy = Math.max(top + container.h, oy - 8) + GAP;
  });

  // Rule / default -> queue: each line in its own track; lines into one queue spread along its left edge.
  const incoming = new Map<string, number>();
  const sources = rowSources.filter((r) => queueShapes.has(r.to)).sort((a, b) => queueShapes.get(a.to)!.y - queueShapes.get(b.to)!.y || a.y - b.y);
  sources.forEach((r, i) => {
    const q = queueShapes.get(r.to)!;
    const n = incoming.get(r.to) ?? 0;
    incoming.set(r.to, n + 1);
    const ty = q.y + 10 + Math.min(n * 6, HEAD - 14);
    const mid = xWs + COL.workstream + gapMid * (0.15 + 0.7 * (sources.length > 1 ? i / (sources.length - 1) : 0.5));
    connectors.push({ id: `c|${r.key}`, from: r.from, to: r.to, kind: r.kind, fromShape: r.shape, toShape: q.id, points: orthogonal([xWs + COL.workstream, r.y], [xQueue, ty], mid), label: r.label, dashed: r.dashed });
  });

  // Overflow -> another queue (queue transfer): out to the right, along a track, back into that queue's title row.
  let track = 0;
  overflowShapes.forEach((shape, key) => {
    outOf(key, "transfer").filter((e) => queueShapes.has(e.to)).forEach((e) => {
      const q = queueShapes.get(e.to)!;
      const right = xOverflow + COL.overflow + 18 + track * 8;
      track++;
      const ty = q.y + HEAD / 2;
      connectors.push({
        id: `c|${key}>${e.to}`, from: key, to: e.to, kind: "transfer", fromShape: shape.id, toShape: q.id,
        points: [[shape.x + shape.w, shape.y + 20], [right, shape.y + 20], [right, ty], [xQueue + COL.queue, ty]]
      });
    });
  });

  const bottom = Math.max(leftBottom, qy);
  const width = (showOverflow ? xOverflow + COL.overflow + 18 + track * 8 : xQueue + COL.queue) + PAD;
  const byNode = new Map<string, string[]>();
  shapes.forEach((s) => { if (s.nodeKey && s.kind !== "default") byNode.set(s.nodeKey, [...(byNode.get(s.nodeKey) ?? []), s.id]); });
  return { shapes, connectors, lanes, width, height: bottom + PAD, byNode, shapeById: new Map(shapes.map((s) => [s.id, s])) };
}

// A right-angled line from a to b: across to the track at mid, then up or down, then across.
export function orthogonal(a: Point, b: Point, mid: number): Point[] {
  if (Math.abs(a[1] - b[1]) < 0.5) return [a, b];
  return [a, [mid, a[1]], [mid, b[1]], b];
}

export function center(s: Shape): Point {
  return [s.x + s.w / 2, s.y + Math.min(s.h, s.header ?? s.h) / 2];
}

// The points a call travels along a route of records (for "follow the call"): the connector between
// two stops where there is one; otherwise straight from one shape to the next (a bot handing over
// inside its workstream, a queue to one of its agents).
export function routePoints(diagram: Diagram, path: string[]): Point[] {
  const points: Point[] = [];
  let current: Shape | undefined;
  const push = (p: Point) => { const last = points[points.length - 1]; if (!last || last[0] !== p[0] || last[1] !== p[1]) points.push(p); };
  const shapesOf = (key: string) => (diagram.byNode.get(key) ?? []).map((id) => diagram.shapeById.get(id)!).filter(Boolean);
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    const next = path[i + 1];
    if (!current) {
      // Start on the copy that leads to the next stop.
      const line = next ? diagram.connectors.find((c) => c.from === key && c.to === next) : undefined;
      current = (line && diagram.shapeById.get(line.fromShape)) ?? shapesOf(key)[0];
      if (!current) continue;
      push(center(current));
    }
    if (!next) break;
    const line = diagram.connectors.find((c) => c.from === key && c.to === next && (c.fromShape === current!.id || diagram.shapeById.get(c.fromShape)?.parent === current!.id || current!.parent === c.fromShape))
      ?? diagram.connectors.find((c) => c.from === key && c.to === next);
    if (line) {
      if (line.fromShape !== current.id) push(center(diagram.shapeById.get(line.fromShape)!));
      line.points.forEach(push);
      current = diagram.shapeById.get(line.toShape);
      // A line into a container that holds the next record's own row: carry on to that row.
      const own = shapesOf(next).find((s) => s.id === line.toShape || s.parent === line.toShape);
      if (own && own.id !== current?.id) { push(center(own)); current = own; }
    } else {
      // Inside a container: the next record's row in this container, else its first copy.
      const candidates = shapesOf(next);
      const inside = candidates.find((s) => s.parent === current!.id || s.parent === current!.parent || s.id === current!.parent);
      const target = inside ?? candidates[0];
      if (!target) continue;
      push(center(target));
      current = target;
    }
  }
  return points;
}

// Total length of a polyline, and the point at a distance along it.
export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}
export function pointAt(points: Point[], distance: number): Point {
  if (!points.length) return [0, 0];
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (left <= len) return len ? [ax + ((bx - ax) * left) / len, ay + ((by - ay) * left) / len] : [ax, ay];
    left -= len;
  }
  return points[points.length - 1];
}

export const KIND_COLOR = (kind: ShapeKind): string => (kind in KINDS ? KINDS[kind as NodeKind].color : kind === "center" ? "#64748b" : "#94a3b8");
