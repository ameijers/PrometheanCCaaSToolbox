// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { useState } from "react";
import { resolveXrm } from "../../shared/src/xrm";
import { GROUPS, TOOLS, ToolCard, matches, webResourceName } from "./tools";

// The toolbox's landing page: every tool as a card, grouped as in the Site Map. A click opens the tool
// in the app's main area (Xrm.Navigation.navigateTo), next to the left menu. Outside the app, or with a
// middle click, the card is a plain link to the tool's page. Reads and writes nothing.

const REPO = "https://github.com/ameijers/PrometheanCCaaSToolbox";

function initials(name: string): string {
  return name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function open(tool: ToolCard, event: React.MouseEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return; // let the browser open a new tab
  const navigation = resolveXrm()?.Navigation;
  if (!navigation?.navigateTo) return; // not inside the app: follow the link
  event.preventDefault();
  void navigation.navigateTo({ pageType: "webresource", webresourceName: webResourceName(tool.key) }, { target: 1 });
}

function Card({ tool }: { tool: ToolCard }) {
  return <a className="tool-card" href={`../${tool.key}/index.html`} onClick={(e) => open(tool, e)}>
    <span className="tool-mark" aria-hidden="true">{initials(tool.name)}</span>
    <span className="tool-body">
      <span className="tool-name">{tool.name}{tool.isNew && <span className="tag new">New</span>}</span>
      <span className="tool-text">{tool.description}</span>
      <span className={`tag ${tool.writes ? "writes" : "reads"}`}>{tool.writes ? "Writes configuration" : "Read-only"}</span>
    </span>
    <span className="tool-arrow" aria-hidden="true">→</span>
  </a>;
}

export function App(): React.ReactElement {
  const [query, setQuery] = useState("");
  const shown = TOOLS.filter((t) => matches(t, query));
  return <div className="home">
    <header className="hero">
      <div className="hero-inner">
        <p className="eyebrow">Dynamics 365 Contact Center</p>
        <h1>Promethean CCaaS Toolbox</h1>
        <p className="lead">{TOOLS.length} tools to understand, build and change your contact center faster than one record at a time in the admin center. Pick a tool to open it.</p>
        <input className="search" type="search" placeholder="Search the tools, e.g. queue, voicemail, skills" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the tools" />
      </div>
    </header>

    <main className="groups">
      {GROUPS.map((group) => {
        const tools = shown.filter((t) => t.group === group.id);
        if (!tools.length) return null;
        return <section key={group.id} className="group">
          <div className="group-head"><h2>{group.name}</h2><p>{group.summary}</p></div>
          <div className="cards">{tools.map((t) => <Card key={t.key} tool={t} />)}</div>
        </section>;
      })}
      {!shown.length && <p className="empty">No tool matches “{query}”.</p>}
    </main>

    <footer className="foot">
      <p><strong>Tools that write configuration</strong> always show what they will do and ask before writing anything. Try them in a test environment first.</p>
      <p>Found a bug or have an idea? <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">Open an issue on GitHub</a> · <a href={REPO} target="_blank" rel="noreferrer">Documentation</a></p>
    </footer>
  </div>;
}
