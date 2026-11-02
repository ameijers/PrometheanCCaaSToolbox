// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useState } from "react";
import { Graph } from "../../environment-3d-explorer/src/model";
import { Center, CENTER_COLORS, createCenter, deleteCenter, Grouping, moveWorkstream, recolor, reconcile, rename, setHidden } from "../../contact-center-3d/src/centers";

// The Centers tab, the same as 3D Contact Center's (same markup, same wording, same saved grouping):
// create, rename, recolour and delete customer centers, move workstreams in and out (drag, or Move
// to…), and hide workstreams with the eye. A center made here is a building there, and the other way round.

// Show / hide, as an eye (struck through when hidden).
function Eye({ off }: { off: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

export function CentersTab({ grouping, graph, where, showUnrouted, onShowUnrouted, onChange, onSelect, onGoToCenter }: {
  grouping: Grouping; graph: Graph; where: string; showUnrouted: boolean; onShowUnrouted(on: boolean): void;
  onChange(next: Grouping): void; onSelect(key: string): void; onGoToCenter(centerId: string): void;
}): React.ReactElement {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | undefined>(undefined);
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const change = onChange;
  const hidden = new Set(grouping.hidden ?? []);
  const workstreamName = (id: string) => graph.nodes.find((n) => n.key === `workstream:${id}`)?.name ?? id;
  const ownCenters = grouping.centers.filter((c) => c.custom);
  const loose = grouping.centers.filter((c) => !c.custom);

  // A workstream row: drag it onto a center, or pick one from Move to.
  const workstreamRow = (id: string, inCenter: Center) => (
    <li key={id} className={`${hidden.has(id) ? "hidden" : ""} draggable`} draggable onDragStart={(e) => { setDragging(id); e.dataTransfer.setData("text/plain", id); }} onDragEnd={() => setDragging(undefined)}>
      <span className="grip" aria-hidden="true">⠿</span>
      <button className="eye" onClick={() => change(setHidden(grouping, id, !hidden.has(id)))} title={hidden.has(id) ? "Show" : "Hide"} aria-label={`${hidden.has(id) ? "Show" : "Hide"} ${workstreamName(id)}`}><Eye off={hidden.has(id)} /></button>
      <button className="name link-like" onClick={() => onSelect(`workstream:${id}`)}>{workstreamName(id)}</button>
      <select value="" onChange={(e) => change(moveWorkstream(grouping, id, e.target.value, graph))} aria-label={`Move ${workstreamName(id)}`}>
        <option value="">Move to…</option>
        {ownCenters.filter((c) => c.id !== inCenter.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        {inCenter.custom && <option value="own">Out of this center</option>}
      </select>
    </li>
  );
  const dropOn = (centerId: string) => ({
    onDragOver: (e: React.DragEvent) => { if (dragging) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain") || dragging; if (id) change(moveWorkstream(grouping, id, centerId, graph)); setDragging(undefined); }
  });

  return (
    <>
      <div className="combine">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { change(createCenter(grouping, newName)); setNewName(""); } }} placeholder="Name of a new customer center" aria-label="Name of a new customer center" />
        <button disabled={!newName.trim()} onClick={() => { change(createCenter(grouping, newName)); setNewName(""); }}>Create</button>
      </div>

      {ownCenters.length > 0 && <h3>Customer centers</h3>}
      <ul className="center-list">
        {ownCenters.map((c) => (
          <li key={c.id} className={`${c.workstreams.length && c.workstreams.every((id) => hidden.has(id)) ? "all-hidden" : ""}${dragging ? " drop-target" : ""}`} {...dropOn(c.id)}>
            <div className="center-row">
              <label className="swatch" style={{ background: c.color }} title="Colour">
                <select value={c.color} onChange={(e) => change(recolor(grouping, c.id, e.target.value))} aria-label={`Colour of ${c.name}`}>
                  {CENTER_COLORS.map((col) => <option key={col} value={col}>{col}</option>)}
                </select>
              </label>
              {renaming?.id === c.id ? (
                <input className="rename" autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { change(rename(grouping, c.id, renaming.name)); setRenaming(undefined); } if (e.key === "Escape") setRenaming(undefined); }}
                  onBlur={() => { change(rename(grouping, c.id, renaming.name)); setRenaming(undefined); }} />
              ) : (
                <button className="name link-like" onClick={() => c.workstreams.length && onGoToCenter(c.id)} onDoubleClick={() => setRenaming({ id: c.id, name: c.name })} title="Click to go there, double-click to rename">{c.name}</button>
              )}
              <button className="small" onClick={() => setRenaming({ id: c.id, name: c.name })} title="Rename">✎</button>
              <button className="small" onClick={() => change(deleteCenter(grouping, c.id, graph))} title="Delete this center (its workstreams stay)">×</button>
            </div>
            <ul className="ws-list">
              {c.workstreams.map((id) => workstreamRow(id, c))}
              {!c.workstreams.length && <li className="muted small empty">Drag workstreams here, or use Move to…</li>}
            </ul>
          </li>
        ))}
      </ul>

      <label className="toggle unrouted"><input type="checkbox" checked={showUnrouted} onChange={(e) => onShowUnrouted(e.target.checked)} /> Show queues nothing routes to</label>

      <h3>Workstreams not in a customer center</h3>
      <p className="muted small">Each stands on its own. Hide what you don't need with the eye; workstreams linked to nothing start hidden. {where}.</p>
      <ul className="ws-list loose">
        {loose.flatMap((c) => c.workstreams.map((id) => workstreamRow(id, c)))}
      </ul>
      {hidden.size > 0 && <button className="link" onClick={() => change({ ...grouping, hidden: [] })}>Show all {hidden.size} hidden workstream{hidden.size === 1 ? "" : "s"}</button>}
      <button className="link" onClick={() => change(reconcile(undefined, graph))}>Start again: no customer centers</button>
    </>
  );
}

// In a workstream's details: which customer center it's in.
export function CenterPicker({ grouping, graph, workstreamId, onChange }: { grouping: Grouping; graph: Graph; workstreamId: string; onChange(next: Grouping): void }) {
  const custom = grouping.centers.filter((c) => c.custom);
  const current = grouping.centers.find((c) => c.workstreams.includes(workstreamId));
  return (
    <select className="center-select" value={current?.custom ? current.id : "own"} onChange={(e) => onChange(moveWorkstream(grouping, workstreamId, e.target.value, graph))} aria-label="Customer center">
      <option value="own">No customer center</option>
      {custom.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
