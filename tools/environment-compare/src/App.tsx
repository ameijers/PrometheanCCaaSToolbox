// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useMemo, useState } from "react";
import { dataverseSource } from "../../environment-snapshot/src/dataverse";
import { Snapshot } from "../../environment-snapshot/src/model";
import { Progress, takeSnapshot } from "../../environment-snapshot/src/snapshot";
import { fromFile } from "../../environment-snapshot/src/snapshotFile";
import { environmentLabel, isDataverseAvailable } from "../../shared/src/xrm";
import { ItemDiff, ItemStatus, MatchBy, compareSnapshots, counts, withoutEnvSpecific } from "./compare";
import { sampleSnapshots } from "./demoData";

// Environment Compare: two snapshots side by side — two snapshot files, or one and a fresh snapshot of
// the environment this page runs in. Only reads.

type SideId = "a" | "b";

const STATUS: Record<ItemStatus, { label: string; short: string }> = {
  different: { label: "Different", short: "Different" },
  onlyA: { label: "Only in A", short: "Only in A" },
  onlyB: { label: "Only in B", short: "Only in B" },
  same: { label: "The same", short: "Same" }
};
const ORDER: ItemStatus[] = ["different", "onlyA", "onlyB", "same"];

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// A value; in a value of several lines (rules), the lines the other side doesn't have are marked.
function Value({ value, other }: { value: string; other: string }): React.ReactElement {
  if (!value) return <span className="empty">empty</span>;
  const lines = value.split("\n");
  if (lines.length < 2) return <>{value}</>;
  const theirs = new Set(other.split("\n"));
  return <>{lines.map((line, i) => <span key={i} className={`line ${theirs.has(line) ? "" : "changed"}`}>{line}</span>)}</>;
}

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const environment = live ? environmentLabel() : "the sample environment";
  const [sides, setSides] = useState<Record<SideId, Snapshot | undefined>>({ a: undefined, b: undefined });
  const [errors, setErrors] = useState<Record<SideId, string>>({ a: "", b: "" });
  const [progress, setProgress] = useState<{ side: SideId; p: Progress } | undefined>(undefined);
  const [matchBy, setMatchBy] = useState<MatchBy>("name");
  const [hideEnv, setHideEnv] = useState(true);
  const [shown, setShown] = useState<Set<ItemStatus>>(new Set(["different", "onlyA", "onlyB"]));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>("all");

  const setSide = (side: SideId, snapshot: Snapshot | undefined, error = "") => {
    setSides((s) => ({ ...s, [side]: snapshot }));
    setErrors((e) => ({ ...e, [side]: error }));
  };

  async function takeHere(side: SideId) {
    setErrors((e) => ({ ...e, [side]: "" }));
    setProgress({ side, p: { done: 0, total: 1, message: "Starting" } });
    try {
      setSide(side, await takeSnapshot(dataverseSource, (p) => setProgress({ side, p })));
    } catch (error) {
      setSide(side, undefined, error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(undefined);
    }
  }

  async function loadFile(side: SideId, file: File | undefined) {
    if (!file) return;
    try {
      setSide(side, fromFile(await file.text()));
    } catch (error) {
      setSide(side, undefined, error instanceof Error ? error.message : String(error));
    }
  }

  async function loadSamples() {
    const { a, b } = await sampleSnapshots();
    setSides({ a, b });
    setErrors({ a: "", b: "" });
  }

  const comparison = useMemo(() => {
    if (!sides.a || !sides.b) return undefined;
    const full = compareSnapshots(sides.a, sides.b, matchBy);
    return hideEnv ? withoutEnvSpecific(full) : full;
  }, [sides, matchBy, hideEnv]);

  const allItems = comparison?.tables.flatMap((t) => t.items) ?? [];
  const totals = counts(allItems);
  const text = search.trim().toLowerCase();
  const visible = (item: ItemDiff) => shown.has(item.status) && (!text || item.name.toLowerCase().includes(text) || item.diffs.some((d) => d.label.toLowerCase().includes(text)));
  const sections = useMemo(() => {
    const result = new Map<string, NonNullable<typeof comparison>["tables"]>();
    comparison?.tables.forEach((t) => result.set(t.section, [...(result.get(t.section) ?? []), t]));
    return [...result.entries()];
  }, [comparison]);
  const tables = (comparison?.tables ?? []).filter((t) => selected === "all" || t.logicalName === selected);

  const toggle = (status: ItemStatus) => setShown((s) => { const next = new Set(s); if (next.has(status)) next.delete(status); else next.add(status); return next; });

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">COMP</div>
      <div><p className="eyebrow">Dynamics 365 Contact Center</p><h1>Environment Compare</h1></div>
      <div className="topbar-actions"><span className="target"><span className="status-dot" />{live ? <>Runs in <strong>{environment}</strong> — reads only</> : "Sample environments — nothing is read from Dataverse"}</span></div>
    </header>

    {!live && <div className="notice"><span className="notice-icon">i</span><span>Not running inside Dataverse. Load two snapshot files, or <button className="link" onClick={() => void loadSamples()}>load the two sample environments</button> (a dev and a test with a few differences).</span></div>}

    <section className="setup">
      {(["a", "b"] as SideId[]).map((side) => {
        const snapshot = sides[side];
        return <div className={`side side-${side}`} key={side}>
          <p className="eyebrow">Side {side.toUpperCase()}</p>
          {snapshot ? <>
            <h2>{snapshot.environment}</h2>
            <p className="muted">Taken {when(snapshot.takenAt)} by {snapshot.takenBy} · {snapshot.tables.filter((t) => t.status === "ok").length} tables{snapshot.mode === "demo" ? " · sample" : ""}</p>
          </> : <><h2 className="muted-title">Nothing loaded</h2><p className="muted">A snapshot file from Environment Snapshot{live ? `, or a snapshot of ${environment} taken now` : ""}.</p></>}
          <div className="side-actions">
            {live && <button className="button secondary" disabled={!!progress} onClick={() => void takeHere(side)}>{progress?.side === side ? "Reading…" : `Snapshot of ${environment}`}</button>}
            <label className="button secondary file">Load snapshot file<input type="file" accept=".json,application/json" onChange={(e) => { void loadFile(side, e.target.files?.[0]); e.target.value = ""; }} /></label>
          </div>
          {progress?.side === side && <div className="progress"><div className="progress-bar"><div style={{ width: `${Math.round((progress.p.done / Math.max(1, progress.p.total)) * 100)}%` }} /></div><small>{progress.p.message}</small></div>}
          {errors[side] && <p className="error">{errors[side]}</p>}
        </div>;
      })}
      <div className="options">
        <p className="eyebrow">Compare</p>
        <p className="option-title">Match records by</p>
        <label className="choice"><input type="radio" name="match" checked={matchBy === "name"} onChange={() => setMatchBy("name")} /><span><strong>Name</strong><small>Records with the same name are the same record. Ids inside values (a rule's queue) are compared by the name they point to. For environments set up separately.</small></span></label>
        <label className="choice"><input type="radio" name="match" checked={matchBy === "id"} onChange={() => setMatchBy("id")} /><span><strong>ID</strong><small>Records with the same id are the same record; values are compared exactly. For environments filled from the same solution or copied.</small></span></label>
        <label className="choice check"><input type="checkbox" checked={hideEnv} onChange={(e) => setHideEnv(e.target.checked)} /><span><strong>Hide what differs per environment</strong><small>Phone numbers, users, queue and team members, security roles and agents' skills and capacity.</small></span></label>
        <p className="muted small">Never compared: ids, created and modified dates and owners.</p>
      </div>
    </section>

    {comparison && <>
      <section className="summary">
        {ORDER.map((status) => <button key={status} className={`tile tile-${status} ${shown.has(status) ? "on" : ""}`} onClick={() => toggle(status)} aria-pressed={shown.has(status)}>
          <strong>{totals[status]}</strong><span>{STATUS[status].label}</span>
          <small>{status === "onlyA" ? comparison.a.environment : status === "onlyB" ? comparison.b.environment : status === "different" ? "records with other settings" : "records"}</small>
        </button>)}
      </section>

      <section className="results">
        <aside className="nav">
          <label className="search"><span>⌕</span><input placeholder="Search record or setting" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <button className={`nav-item ${selected === "all" ? "on" : ""}`} onClick={() => setSelected("all")}><span>All tables</span><em>{allItems.filter((i) => i.status !== "same").length}</em></button>
          {sections.map(([section, list]) => <div key={section} className="nav-section">
            <p className="eyebrow">{section}</p>
            {list.map((t) => {
              const n = t.items.filter((i) => i.status !== "same").length;
              return <button key={t.logicalName} className={`nav-item ${selected === t.logicalName ? "on" : ""} ${n ? "" : "quiet"}`} onClick={() => setSelected(t.logicalName)}><span>{t.label}</span>{n > 0 ? <em>{n}</em> : t.notes.length ? <em className="note">–</em> : null}</button>;
            })}
          </div>)}
        </aside>

        <div className="tables">
          <p className="legend"><span className="badge a">A</span>{comparison.a.environment} <span className="badge b">B</span>{comparison.b.environment} · matched by {comparison.matchBy === "name" ? "name" : "ID"}</p>
          {tables.map((t) => {
            const items = t.items.filter(visible);
            if (selected === "all" && !items.length && !t.notes.length) return null;
            if (selected === "all" && !items.length && t.notes.every((n) => n.startsWith("Not in environment"))) return null;
            return <div className="table-block" key={t.logicalName}>
              <header><h3>{t.label}</h3><span className="muted">{t.logicalName}{t.envSpecific ? " · differs per environment" : ""}</span></header>
              {t.notes.length > 0 && <p className="table-note">{t.notes.join(" ")}</p>}
              {items.length ? items.map((item) => <div className={`item item-${item.status}`} key={item.key}>
                <div className="item-head"><span className={`status status-${item.status}`}>{STATUS[item.status].short}</span><strong>{item.name}</strong>
                  {item.status === "different" && <small>{item.diffs.length} {item.diffs.length === 1 ? "setting differs" : "settings differ"}</small>}</div>
                {item.note && <p className="item-note">{item.note}</p>}
                {item.diffs.length > 0 && <table className="diff">
                  <thead><tr><th>Setting</th><th><span className="badge a">A</span>{comparison.a.environment}</th><th><span className="badge b">B</span>{comparison.b.environment}</th></tr></thead>
                  <tbody>{item.diffs.map((d) => <tr key={d.key}><td>{d.label}{d.envSpecific && <em className="env">per environment</em>}</td><td className="val"><Value value={d.a} other={d.b} /></td><td className="val"><Value value={d.b} other={d.a} /></td></tr>)}</tbody>
                </table>}
              </div>) : <p className="muted">{t.items.length ? "Nothing to show with these filters." : t.notes.length ? "Not compared." : "No records on either side."}</p>}
            </div>;
          })}
          {selected === "all" && !allItems.some(visible) && <p className="muted big">{allItems.length ? "No differences with these filters." : "Nothing to compare."}</p>}
        </div>
      </section>
    </>}
  </main>;
}
