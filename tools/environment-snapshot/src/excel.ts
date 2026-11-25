// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { cellText } from "./columns";
import { SnapshotDocument } from "./document";
import { Snapshot } from "./model";
import { SECTIONS } from "./tables";
import { Sheet, sheetNames, xlsx } from "./xlsx";

// The Excel workbook of a snapshot: an About sheet, the overviews the document has (routing rules,
// queues, agents), one sheet per table with every column, and a Columns sheet that names each
// column's Dataverse column.

function stamp(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export function workbookSheets(snapshot: Snapshot, doc: SnapshotDocument): Sheet[] {
  const tables = snapshot.tables;
  // The table sheets' names, worked out once so the About sheet can point at them.
  const reserved = ["About", "Routing rules", "Queues", "Agents"];
  const tableSheet = sheetNames([...reserved, ...tables.map((t) => t.label), "Columns"]).slice(reserved.length, reserved.length + tables.length);
  const sectionTitle = new Map(SECTIONS.map((s) => [s.id, s.title]));
  const status = (t: (typeof tables)[number]) => t.status === "ok" ? `${t.rows.length}` : doc.tables.find((d) => d.logicalName === t.logicalName)?.status ?? t.status;

  const about: Sheet = {
    name: "About",
    headerRows: 0,
    widths: [34, 30, 46, 16, 60],
    rows: [
      ["Contact center configuration snapshot"],
      ["Environment", snapshot.environment],
      ["Taken", stamp(snapshot.takenAt) + " UTC"],
      ["Taken by", snapshot.takenBy],
      ["Made with", "Promethean CCaaS Toolbox – Environment Snapshot"],
      ...(snapshot.mode === "demo" ? [["Note", "Sample environment: this isn't a real environment's configuration."]] : []),
      [],
      ["Section", "Table", "Sheet", "Rows", "Notes"],
      ...tables.map((t, i) => [sectionTitle.get(t.section) ?? t.section, t.label === t.logicalName ? t.logicalName : `${t.label} (${t.logicalName})`, tableSheet[i], status(t), [t.scope, t.message, t.leftOut.length ? `Left out (secrets): ${t.leftOut.join(", ")}` : ""].filter(Boolean).join(" · ")]),
      [],
      ["Left out of every snapshot", "Keys, passwords, tokens and other secrets; conversations, voicemails, recordings and other day-to-day data; users' personal details."]
    ]
  };

  const routing: Sheet = {
    name: "Routing rules",
    headerRows: 1,
    rows: [
      ["Workstream / queue", "Kind", "Ruleset", "Order", "Rule", "Enabled", "When", "Then"],
      ...doc.workstreams.flatMap((w) => w.routing.flatMap((block) => (block.text?.rules ?? []).map((r, i) => [w.name, block.title, block.ruleset ?? "", String(i + 1), r.name, r.enabled ? "Yes" : "No", r.when, r.then]))),
      ...doc.queues.flatMap((q) => [...q.overflow, ...q.methods.flatMap((m) => m.rulesets.map((b) => ({ ...b, title: `${m.name}${m.active ? "" : " (not in use)"} – ${b.title}` })))]
        .flatMap((block) => (block.text?.rules ?? []).map((r, i) => [q.name, block.title, block.ruleset ?? "", String(i + 1), r.name, r.enabled ? "Yes" : "No", r.when, r.then])))
    ]
  };

  const queues: Sheet = {
    name: "Queues",
    headerRows: 1,
    rows: [
      ["Queue", "Type", "Assignment method", "Operating hours", "Used by workstreams", "Members", "Custom assignment methods"],
      ...doc.queues.map((q) => [q.name, q.type, q.assignment, q.hours, q.usedBy.join(", "), q.members.join(", "), q.methods.map((m) => `${m.name}${m.active ? " (in use)" : ""}`).join(", ")])
    ]
  };

  const agents: Sheet = {
    name: "Agents",
    headerRows: 1,
    rows: [
      ["Agent", "Details", "Queues", "Skills", "Capacity profiles", "Security roles", "Teams"],
      ...doc.agents.map((a) => [a.name, a.fields.map(([l, v]) => `${l}: ${v}`).join("; "), a.queues.join(", "), a.skills.join(", "), a.capacityProfiles.join(", "), a.roles.join(", "), a.teams.join(", ")])
    ]
  };

  const tableSheets: Sheet[] = tables.map((t, i) => ({
    name: tableSheet[i],
    headerRows: 1,
    rows: t.columns.length
      ? [t.columns.map((c) => c.label), ...t.rows.map((r) => t.columns.map((c) => cellText(r, c)))]
      : [[t.status === "ok" ? "No columns" : doc.tables.find((d) => d.logicalName === t.logicalName)?.status ?? t.status], ...(t.message ? [[t.message]] : [])]
  }));

  const columns: Sheet = {
    name: "Columns",
    headerRows: 1,
    rows: [["Sheet", "Column", "Dataverse table", "Dataverse column", "Type"], ...tables.flatMap((t, i) => t.columns.map((c) => [tableSheet[i], c.label, t.logicalName, c.logicalName, c.type]))]
  };

  return [about, routing, queues, agents, ...tableSheets, columns];
}

export function workbook(snapshot: Snapshot, doc: SnapshotDocument): Uint8Array {
  return xlsx(workbookSheets(snapshot, doc), { title: `Contact center configuration – ${snapshot.environment}`, creator: snapshot.takenBy, created: snapshot.takenAt.replace(/\.\d+Z$/, "Z") });
}

export function fileName(snapshot: Snapshot, extension: string): string {
  const host = snapshot.environment.replace(/\..*$/, "").replace(/[^a-z0-9-]+/gi, "-") || "environment";
  return `contact-center-snapshot-${host}-${snapshot.takenAt.slice(0, 16).replace(/[-:T]/g, "")}.${extension}`;
}
