# Agent Readiness Checker — User Manual

Part of the [Promethean CCaaS Toolbox](../../Readme.md). For what the tool does and how it's built, see the [README](README.md). This manual walks through actually using it.

## 1. Opening the tool

1. In your Dynamics 365 Contact Center model-driven app, open the **Agent Readiness Checker** subarea from the Site Map.
2. On load, the tool connects using your own signed-in session and shows a **summary header**, a filterable **agent list**, and an empty **detail** panel.
3. If it can't reach Dataverse, it falls back to a **demo roster** of 21 sample agents — a banner says "Demo data is shown until a Dataverse connection is available." Everything below works the same way against demo data, and the demo roster deliberately includes every kind of pass/warning/failure/not-verifiable result so you can see the full range of the tool's output without a live connection.

> **[Screenshot 1 — Overview]**
> Full-page screenshot right after opening, showing the top bar ("Agent Readiness Checker" title, "Read-only mode" badge), the summary strip with its four status counts and "Most common failing check", the left filter sidebar, the agent list table in the middle with a mix of statuses visible, and the empty "No agent selected" state in the right-hand detail panel.

## 2. Reading the summary header

Across the top, four tiles show how many agents in the current view are **Ready**, **Warning**, **Not ready**, and **Not verifiable**, plus the single **most common failing check** across the roster — useful for spotting a systemic problem (e.g. "40 agents are all missing the same security role") instead of chasing one agent at a time.

> **[Screenshot 2 — Summary header]**
> Close-up of the summary strip: the four status-count tiles and the "Most common failing check" tile, with non-zero counts in more than one status.

## 3. Filtering and sorting the agent list

Use the left-hand panel to narrow the list:
- **Search** by agent name or domain name.
- **Status** — filter to only Ready / Warning / Not ready / Not verifiable.
- **Queue** / **Workstream** — filter to agents connected to a specific queue or reachable by a specific workstream.

Click any column header in the agent table (**Agent**, **Status**, **Failed**, **Top issue**) to sort by it; click again to reverse the direction. The count in the sidebar ("N/M") shows how many agents match the current filters out of the total roster.

> **[Screenshot 3 — Filtered and sorted list]**
> Screenshot of the sidebar with a status filter applied (e.g. "Not ready" selected) and the agent table sorted by a column other than the default, showing the sort arrow in the column header and a filtered agent count in the sidebar.

## 4. Reading the agent detail checklist

Click any row in the agent list to open that agent's full checklist in the right-hand panel:

- The agent's **overall status** pill and domain name at the top.
- One card per check, grouped in a fixed diagnosis order (account → security roles → channel enablement → queue membership → workstream reachability → capacity profile → skills → presence → unified routing state), each showing:
  - A **status badge** (Pass / Warning / Fail / Not verifiable).
  - The **evidence** actually found (e.g. the agent's real queue list, their actual skills and proficiency).
  - Why the check **matters**.
  - For anything other than Pass, a plain-language **suggested fix**.

> **[Screenshot 4 — Detail checklist, Not ready agent]**
> Screenshot of the detail panel for an agent with overall status "Not ready", showing several check cards including at least one Fail (with its suggested fix visible) and one Pass, so the visual contrast between check statuses is clear.

> **[Screenshot 5 — Detail checklist, Not verifiable checks]**
> Screenshot of the detail panel scrolled to show one or more "Not verifiable" check cards (e.g. Channel enablement or Unified routing state, which are commonly unknown — see the README's schema-confidence table), demonstrating how the tool presents a check it couldn't confirm rather than guessing.

## 5. Exporting

Both views export client-side (no server involved):
- **Bulk view:** the "Export CSV" / "Export Markdown" buttons in the summary header export the currently filtered and sorted agent list.
- **Detail view:** the "Export CSV" / "Export Markdown" buttons in the detail panel export the selected agent's full checklist.

> **[Screenshot 6 — Export buttons]**
> Screenshot showing both sets of export buttons — the summary header's bulk-export buttons and the detail panel's per-agent export buttons — with an agent selected so both are visible in the same shot.

## Notes

- This tool is **strictly read-only**: it never creates, updates, or deletes any Dataverse record, agent, queue, or configuration.
- Its schema confidence varies by field — see the [README](README.md#schema-assumptions--please-read-before-trusting-live-results) before treating every result as equally certain. A "Fail" on a high-confidence check (account, security roles, queue membership, workstream reachability) is solid; a "Not verifiable" on a low-confidence one (capacity profile, skills, presence, channels) means exactly that — verify it manually.
- To understand *why* a workstream routes the way it does (rather than whether one specific agent can be reached), use [Visual Routing Tester](../visual-routing-tester/manual.md). To watch what a real call actually captured, use [Context Variable Monitor](../context-variable-monitor/manual.md).
