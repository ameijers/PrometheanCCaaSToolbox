// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { Field, ListBlock, RulesetBlock, SnapshotDocument } from "./document";

// The document: shown on the page as a preview, and printed (saved as PDF) as it is. Print styles in
// css/environmentSnapshot.css give it A4 pages, page numbers and page breaks between sections.

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}

function Fields({ fields }: { fields: Field[] }): React.ReactElement | null {
  if (!fields.length) return null;
  return <dl className="doc-fields">{fields.map(([label, value], i) => <React.Fragment key={`${label}-${i}`}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>;
}

function Chips({ items, empty }: { items: string[]; empty?: string }): React.ReactElement {
  return items.length ? <ul className="doc-chips">{items.map((i) => <li key={i}>{i}</li>)}</ul> : <p className="doc-muted">{empty ?? "None"}</p>;
}

function Rules({ block }: { block: RulesetBlock }): React.ReactElement {
  return <div className="doc-ruleset">
    <h5>{block.title}{block.ruleset && block.ruleset !== block.title.split(": ").pop() ? <span className="doc-muted"> · ruleset "{block.ruleset}"</span> : null}</h5>
    {!block.text
      ? <p className="doc-muted">The rules of this ruleset couldn't be read as a rule list; see the Excel workbook.</p>
      : !block.text.rules.length ? <p className="doc-muted">No rules.</p>
        : <>
          <p className="doc-note">{block.text.hitPolicy === "first" ? "Rules are checked in order; the first one that matches is used." : "Every matching rule is applied, in order."}</p>
          <table className="doc-table doc-rules">
            <thead><tr><th>#</th><th>Rule</th><th>When</th><th>Then</th></tr></thead>
            <tbody>{block.text.rules.map((r, i) => <tr key={i} className={r.enabled ? "" : "doc-disabled"}>
              <td>{i + 1}</td><td>{r.name}{!r.enabled && <span className="doc-tag">off</span>}</td><td>{r.when}</td><td>{r.then}</td>
            </tr>)}</tbody>
          </table>
        </>}
  </div>;
}

function List({ list }: { list: ListBlock }): React.ReactElement {
  return <div className="doc-block">
    <h3>{list.title}</h3>
    <table className="doc-table">
      <thead><tr>{list.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{list.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

export function SnapshotDocumentView({ doc }: { doc: SnapshotDocument }): React.ReactElement {
  const sections = [
    { id: "overview", title: "Overview", note: `${doc.workstreams.length} workstreams, ${doc.queues.length} queues` },
    { id: "workstreams", title: "Workstreams", note: "Settings, channels, context variables, capacity and routing rules" },
    { id: "queues", title: "Queues", note: "Assignment, overflow, members and the workstreams that use them" },
    { id: "agents", title: "Agents", note: "Queues, skills, capacity profiles, security roles and teams" },
    { id: "lists", title: "Numbers, capacity, skills and more", note: doc.lists.map((l) => l.title).join(", ") },
    { id: "appendix", title: "Everything in this snapshot", note: "Every table read, and what was left out" }
  ];
  return <article className="doc">
    <section className="doc-cover">
      <div className="doc-cover-top">
        <p className="doc-kicker">Promethean CCaaS Toolbox · Environment Snapshot</p>
        <h1>{doc.title}</h1>
        <p className="doc-env">{doc.environment}</p>
        {doc.sample && <p className="doc-sample">Sample environment: not a real environment's configuration.</p>}
      </div>
      <div className="doc-totals">{doc.totals.map((t) => <div key={t.label}><strong>{t.value}</strong><span>{t.label}</span></div>)}</div>
      <dl className="doc-cover-meta">
        <dt>Taken</dt><dd>{when(doc.takenAt)}</dd>
        <dt>By</dt><dd>{doc.takenBy}</dd>
        <dt>Also</dt><dd>Every column of every table is in the Excel workbook of this snapshot.</dd>
      </dl>
    </section>

    <section className="doc-page doc-contents">
      <h2>Contents</h2>
      <ol>{sections.map((s) => <li key={s.id}><a href={`#doc-${s.id}`}>{s.title}</a><span>{s.note}</span></li>)}</ol>
      {doc.warnings.length > 0 && <div className="doc-callout"><strong>Not everything could be read.</strong><ul>{doc.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
    </section>

    <section className="doc-section" id="doc-overview">
      <h2><span>1</span>Overview</h2>
      <div className="doc-block">
        <h3>Workstreams</h3>
        <table className="doc-table">
          <thead><tr><th>Workstream</th><th>Channel</th><th>Direction</th><th>Distribution</th><th>Sends work to</th></tr></thead>
          <tbody>{doc.workstreams.map((w) => <tr key={w.id}><td><a href={`#doc-ws-${w.id}`}>{w.name}</a></td><td>{w.kind}</td><td>{w.direction}</td><td>{w.distribution}</td><td>{w.queues.join(", ")}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="doc-block">
        <h3>Queues</h3>
        <table className="doc-table">
          <thead><tr><th>Queue</th><th>Type</th><th>Assignment method</th><th>Operating hours</th><th>Members</th><th>Used by</th></tr></thead>
          <tbody>{doc.queues.map((q) => <tr key={q.id}><td><a href={`#doc-q-${q.id}`}>{q.name}</a></td><td>{q.type}</td><td>{q.assignment}</td><td>{q.hours}</td><td>{q.members.length}</td><td>{q.usedBy.join(", ")}</td></tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="doc-section" id="doc-workstreams">
      <h2><span>2</span>Workstreams</h2>
      {doc.workstreams.map((w) => <div className="doc-card" key={w.id} id={`doc-ws-${w.id}`}>
        <header><h3>{w.name}</h3><span className="doc-badge">{w.kind}</span></header>
        <Fields fields={w.fields} />
        {w.channels.length > 0 && <div className="doc-sub">
          <h4>Voice channels</h4>
          {w.channels.map((c) => <div className="doc-channel" key={c.name}>
            <strong>{c.name}</strong>
            <Fields fields={c.fields} />
            {c.languages.length > 0 && <p className="doc-muted">Languages: {c.languages.join(" · ")}</p>}
          </div>)}
        </div>}
        {w.variables.length > 0 && <div className="doc-sub"><h4>Context variables</h4><Fields fields={w.variables} /></div>}
        {w.capacityProfiles.length > 0 && <div className="doc-sub"><h4>Capacity profiles</h4><Chips items={w.capacityProfiles} /></div>}
        <div className="doc-sub">
          <h4>Routing</h4>
          {w.routingNote ? <p className="doc-muted">{w.routingNote}</p> : w.routing.map((b, i) => <Rules key={i} block={b} />)}
        </div>
      </div>)}
    </section>

    <section className="doc-section" id="doc-queues">
      <h2><span>3</span>Queues</h2>
      {doc.queues.map((q) => <div className="doc-card" key={q.id} id={`doc-q-${q.id}`}>
        <header><h3>{q.name}</h3>{q.type && <span className="doc-badge">{q.type}</span>}</header>
        <Fields fields={q.fields} />
        <div className="doc-sub"><h4>Used by workstreams</h4><Chips items={q.usedBy} empty="No workstream routes to this queue." /></div>
        {q.methods.length > 0 && <div className="doc-sub">
          <h4>Custom assignment methods</h4>
          {q.methods.map((m) => <div key={m.name} className="doc-method">
            <p><strong>{m.name}</strong> {m.active ? <span className="doc-tag doc-tag-on">in use</span> : <span className="doc-tag">not in use</span>}</p>
            {m.rulesets.map((b, i) => <Rules key={i} block={b} />)}
          </div>)}
        </div>}
        {q.overflow.length > 0 && <div className="doc-sub"><h4>Overflow</h4>{q.overflow.map((b, i) => <Rules key={i} block={b} />)}</div>}
        <div className="doc-sub"><h4>Members ({q.members.length})</h4><Chips items={q.members} empty="No members." /></div>
      </div>)}
    </section>

    <section className="doc-section" id="doc-agents">
      <h2><span>4</span>Agents</h2>
      {doc.agents.length ? <table className="doc-table doc-agents">
        <thead><tr><th>Agent</th><th>Queues</th><th>Skills</th><th>Capacity profiles</th><th>Security roles</th><th>Teams</th></tr></thead>
        <tbody>{doc.agents.map((a) => <tr key={a.name}>
          <td><strong>{a.name}</strong>{a.disabled && <span className="doc-disabled-agent">disabled</span>}{a.fields.map(([l, v]) => <small key={l}>{l}: {v}</small>)}</td>
          <td>{a.queues.join(", ")}</td><td>{a.skills.join(", ")}</td><td>{a.capacityProfiles.join(", ")}</td><td>{a.roles.join(", ")}</td><td>{a.teams.join(", ")}</td>
        </tr>)}</tbody>
      </table> : <p className="doc-muted">No agents: no queue has members and no user is set up as a bookable resource.</p>}
    </section>

    <section className="doc-section" id="doc-lists">
      <h2><span>5</span>Numbers, capacity, skills and more</h2>
      {doc.lists.map((l) => <List key={l.title} list={l} />)}
    </section>

    <section className="doc-section" id="doc-appendix">
      <h2><span>6</span>Everything in this snapshot</h2>
      <p>Every table below is in the Excel workbook of this snapshot, with every column. Tables marked "Not in this environment" belong to features that aren't installed.</p>
      <table className="doc-table doc-compact">
        <thead><tr><th>Table</th><th>Dataverse table</th><th>Rows</th><th>Read</th></tr></thead>
        <tbody>{[...new Set(doc.tables.map((t) => t.section))].map((section) => <React.Fragment key={section}>
          <tr className="doc-group"><td colSpan={4}>{section}</td></tr>
          {doc.tables.filter((t) => t.section === section).map((t) => <tr key={t.logicalName} className={t.status === "Read" ? "" : "doc-disabled"}><td>{t.label}</td><td>{t.logicalName}</td><td>{t.status === "Read" ? t.rows : ""}</td><td>{t.status}</td></tr>)}
        </React.Fragment>)}</tbody>
      </table>
      <div className="doc-block">
        <h3>Left out on purpose</h3>
        <ul>
          <li>Secrets: keys, passwords, tokens and connection strings.{doc.leftOut.length ? ` In this environment: ${doc.leftOut.join(", ")}.` : ""}</li>
          <li>Conversations, voicemails, recordings and other day-to-day data: they aren't configuration.</li>
          <li>Users' personal details: only name, sign-in, business unit, title and status of the users the configuration points to.</li>
        </ul>
      </div>
    </section>
  </article>;
}
