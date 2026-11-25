// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useMemo, useState } from "react";
import { environmentLabel, isDataverseAvailable } from "../../shared/src/xrm";
import { dataverseSource } from "./dataverse";
import { demoSource } from "./demoData";
import { SnapshotDocumentView } from "./DocumentView";
import { buildDocument } from "./document";
import { fileName, workbook } from "./excel";
import { Snapshot } from "./model";
import { Progress, takeSnapshot } from "./snapshot";
import { toFile } from "./snapshotFile";
import { SECTIONS } from "./tables";

// Environment Snapshot: reads the contact center configuration once and offers it as a designed PDF
// (the browser's Save as PDF) and an Excel workbook. Only reads.

function download(bytes: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const source = live ? dataverseSource : demoSource;
  const environment = live ? environmentLabel() : "the sample environment";

  const [progress, setProgress] = useState<Progress | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined);
  const [error, setError] = useState("");
  const doc = useMemo(() => snapshot ? buildDocument(snapshot) : undefined, [snapshot]);

  async function take() {
    setError("");
    setSnapshot(undefined);
    setProgress({ done: 0, total: 1, message: "Starting" });
    try {
      setSnapshot(await takeSnapshot(source, setProgress));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(undefined);
    }
  }

  function saveExcel() {
    if (!snapshot || !doc) return;
    download(workbook(snapshot, doc), fileName(snapshot, "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  function saveFile() {
    if (!snapshot) return;
    download(new TextEncoder().encode(toFile(snapshot)), fileName(snapshot, "json"), "application/json");
  }

  function savePdf() {
    if (!snapshot) return;
    // The file name the browser offers when saving as PDF comes from the page title.
    const title = document.title;
    document.title = fileName(snapshot, "pdf").replace(/\.pdf$/, "");
    window.print();
    document.title = title;
  }

  const busy = !!progress;
  const read = snapshot?.tables.filter((t) => t.status === "ok").length ?? 0;

  return <main className="app-shell">
    <header className="topbar no-print">
      <div className="brand-mark">SNAP</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Environment Snapshot</h1></div>
      <div className="topbar-actions">
        <span className={`target ${source.mode}`}><span className="status-dot" />{live ? <>Reads <strong>{environment}</strong> — changes nothing</> : "Sample environment — nothing is read from Dataverse"}</span>
      </div>
    </header>

    {!live && <div className="notice no-print"><span className="notice-icon">i</span><span>Not running inside Dataverse, so this is a sample environment: a small, fictional contact center.</span></div>}

    <section className="intro no-print">
      <div className="intro-text">
        <h2>{snapshot ? "Snapshot taken" : "Take a snapshot of the configuration"}</h2>
        <p>{snapshot
          ? <>Read {read} of {snapshot.tables.length} tables of <strong>{snapshot.environment}</strong> on {new Date(snapshot.takenAt).toLocaleString()}. Save it as a PDF to read and share, or as an Excel workbook to filter, sort and work with.</>
          : <>Reads every part of the contact center configuration of <strong>{environment}</strong>: channels and numbers, workstreams and routing rules, queues and assignment, agents with their skills, capacity and roles, and the agent experience. Nothing is changed.</>}</p>
        {!snapshot && <ul className="intro-sections">{SECTIONS.map((s) => <li key={s.id}><strong>{s.title}</strong><span>{s.description}</span></li>)}</ul>}
      </div>
      <div className="intro-actions">
        {snapshot && doc && <>
          <button className="button primary" onClick={savePdf}>Save as PDF</button>
          <small>Opens the print window: choose <strong>Save as PDF</strong> as the printer.</small>
          <button className="button primary" onClick={saveExcel}>Download Excel</button>
          <small>Every column of every table, one sheet per table.</small>
          <button className="button secondary" onClick={saveFile}>Download snapshot file</button>
          <small>To compare with another environment in Environment Compare.</small>
        </>}
        <button className={`button ${snapshot ? "secondary" : "primary"}`} onClick={() => void take()} disabled={busy}>{busy ? "Reading…" : snapshot ? "Take a new snapshot" : "Take snapshot"}</button>
      </div>
    </section>

    {progress && <section className="progress-strip no-print"><div className="progress-bar"><div style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div><span>{progress.done}/{progress.total} — {progress.message}</span></section>}
    {error && <div className="notice error no-print"><span className="notice-icon">!</span><span>Couldn't take the snapshot: {error}</span></div>}

    {snapshot && snapshot.warnings.length > 0 && <div className="notice warn no-print"><span className="notice-icon">!</span><span>Some tables couldn't be read; the snapshot has everything else. {snapshot.warnings.join(" · ")}</span></div>}

    {doc && <section className="paper"><SnapshotDocumentView doc={doc} /></section>}
  </main>;
}
