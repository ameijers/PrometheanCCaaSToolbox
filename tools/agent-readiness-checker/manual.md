# Agent Readiness Checker — User Manual

Part of the [Promethean CCaaS Toolbox](../../Readme.md). For what the tool does and how it's built, see the [README](README.md). This manual walks through actually using it.

## 1. Opening the tool

1. In your Dynamics 365 Contact Center model-driven app, open the **Agent Readiness Checker** subarea from the Site Map.
2. On load, the tool connects using your own signed-in session — one click, no extra confirmation step — and goes straight to the **summary header**, a filterable/paginated **agent list**, and an empty **Agent information** panel. Behind the scenes it also resolves which real role means Agent/Supervisor/Omnichannel Admin (see "Setting up roles" below); the first time it connects to a given environment this is a best-effort guess, and the notice banner says so — review it via **Configure roles…** if the results don't look right.
3. If it can't reach Dataverse, it falls back to a **demo roster** of 25 sample agents — a banner says "Demo data is shown until a Dataverse connection is available." Everything below works the same way against demo data (the role picker never appears in demo mode), and the demo roster deliberately includes every kind of pass/warning/failure/not-verifiable result so you can see the full range of the tool's output without a live connection.

> **[Screenshot 1 — Overview]**
> Full-page screenshot right after opening, showing the top bar ("Agent Readiness Checker" title, "Read-only mode" badge), the summary strip with its four status counts and "Most common failing check", the left filter sidebar, the agent list table in the middle with a mix of statuses visible, and the empty "No agent selected" state in the right-hand Agent information panel.

## 2. Setting up roles

This tool needs to know which of your environment's security roles put someone in scope as an Agent, Supervisor, or Omnichannel Admin — and it never guesses this from a fixed list of common out-of-box role names, because real environments commonly rename or clone them (one real environment had renamed "Omnichannel Supervisor" to something entirely custom, which no fixed name list could ever have matched).

1. Click **Configure roles…**, under the sidebar's Role filter, at any time to open the setup popup.
2. It fetches every real security role in your environment (alphabetized) and shows three dropdowns — **Agent**, **Supervisor**, **Omnichannel Admin** — one real role picked per group. The first time you open it, each dropdown is pre-set to whatever role's name loosely matched (e.g. any role name containing "supervisor") as a starting suggestion; change any of them to match your environment's actual naming.
3. Click **Save & load agents** to confirm and reload the roster. Your selection is remembered in this browser, so you won't be asked again next time — unless the tool finds no valid remembered roles anymore (e.g. after clearing browser data), in which case it re-suggests from scratch on the next connect.
4. **Cancel**, the **×**, or clicking outside the popup all close it without changing anything.

The roster then includes anyone holding a picked role — **directly, or via a Dataverse Team the role is assigned to** (a common setup: a team like "Sales Supervisors" holds the Supervisor role directly, and everyone added to that team inherits it). If connecting reports "No one matched the selected roles," open **Configure roles…** and adjust — it's usually a sign the selection needs correcting, not that the environment has no agents.

> **[Screenshot 2 — Role picker popup]**
> Screenshot of the "Configure roles" popup open over the rest of the page (backdrop visible), showing the explanatory text at the top and the three Agent/Supervisor/Omnichannel Admin dropdowns each with a real role name selected, plus the Cancel / Save & load agents buttons.

## 3. Reading the summary header

Across the top, a caption states exactly how many agents these numbers describe, and four tiles show how many of them are **Ready**, **Warning**, **Not ready**, and **Not verifiable**, plus the single **most common failing check** among them — useful for spotting a systemic problem (e.g. "40 agents are all missing the same security role") instead of chasing one agent at a time. These counts always match the agent table below them exactly: they reflect your search box and Queue/Workstream/Role filters, just not the Status filter itself (so all four counts stay visible and comparable no matter which one you've selected). Click any count to filter the table to just that status; click it again to clear the filter.

> **[Screenshot 3 — Summary header]**
> Close-up of the summary strip: the four status-count tiles and the "Most common failing check" tile, with non-zero counts in more than one status.

## 4. Filtering, sorting, and paging the agent list

Use the left-hand panel to narrow the list:
- **Search** by agent name or domain name.
- **Status** — filter to only Ready / Warning / Not ready / Not verifiable.
- **Queue** / **Workstream** — filter to agents connected to a specific queue or reachable by a specific workstream.
- **Role** — three checkboxes, Agent / Supervisor / Omnichannel Admin, all checked by default (matching the roles you picked in step 2 — see the [README](README.md#how-it-works)). Uncheck one to narrow the list further, e.g. to just Agents. Unchecking all three is treated as "no filter" (shows everyone loaded) rather than showing nobody.

Click any column header in the agent table (**Agent**, **Status**, **Failed**, **Top issue**) to sort by it; click again to reverse the direction. The table shows 5 agents per page — use **◀ Prev** / **Next ▶** below the table to page through the rest; the count next to the buttons ("Page X of Y (N agents)") reflects your current filters, and paging resets to page 1 whenever a filter or sort changes.

> **[Screenshot 4 — Filtered, sorted, and paged list]**
> Screenshot of the sidebar with a status filter applied (e.g. "Not ready" selected) and the Role checkboxes visible, the agent table sorted by a column other than the default (sort arrow visible in the column header), and the pagination row below the table showing "Page 1 of N".

## 5. Reading the agent information panel and readiness checklist

Click any row in the agent list to open two things:

**On the right, a compact "Agent information" panel** — the agent's overall status pill, domain name, and one line per check category showing just the raw evidence found (e.g. their real queue list, their actual skills and proficiency) — a quick-reference summary, not the full explanation.

> **[Screenshot 5 — Agent information panel]**
> Screenshot of the right-hand "Agent information" panel for a selected agent, showing the status pill and several evidence rows (e.g. Security roles, Queue membership, Capacity).

**Below the agent table, a full-width "Outcome" section** with one card per check, grouped in a fixed diagnosis order (account → security roles → channel enablement → queue membership → workstream reachability → capacity → skills → presence → unified routing state). Each card shows:
- A **status badge** (Pass / Warning / Fail / Not verifiable).
- The **evidence**, rendered as a bulleted list where it's naturally a list (e.g. security roles, queues, skills) or a short sentence otherwise.
- For anything other than Pass, a plain-language **suggested fix**.
- A collapsed **"Why this matters"** toggle — click it to expand the fuller explanation; collapsed by default to keep the checklist scannable.

> **[Screenshot 6 — Outcome checklist, Not ready agent]**
> Screenshot of the outcome panel below the table for an agent with overall status "Not ready", showing several check cards in the multi-column layout, including at least one Fail (with its bulleted evidence list and suggested fix visible) and one Pass.

> **[Screenshot 7 — Outcome checklist, Not verifiable checks]**
> Screenshot of the outcome panel scrolled to show one or more "Not verifiable" check cards (e.g. Skills, when a queue's reaching workstream has a skill-identification step this tool couldn't fully parse — see the README's schema-confidence table), demonstrating how the tool presents a check it couldn't confirm rather than guessing. Include one card with "Why this matters" expanded, to show what that looks like.

## 6. Exporting

Both views export client-side (no server involved):
- **Bulk view:** the "Export CSV" / "Export Markdown" buttons in the summary header export the currently filtered and sorted agent list (all matching pages, not just the one on screen).
- **Outcome view:** the "Export CSV" / "Export Markdown" buttons above the checklist export the selected agent's full checklist.

> **[Screenshot 8 — Export buttons]**
> Screenshot showing both sets of export buttons — the summary header's bulk-export buttons and the outcome panel's per-agent export buttons — with an agent selected so both are visible in the same shot.

## Notes

- This tool is **strictly read-only**: it never creates, updates, or deletes any Dataverse record, agent, queue, or configuration.
- Its schema confidence varies by field — see the [README](README.md#schema-assumptions--please-read-before-trusting-live-results) before treating every result as equally certain. A "Fail" on any check is solid — every check's data source is now confirmed against a live environment. The one remaining soft spot is *what a specific queue's skill requirement actually is*, when one is configured at all: the tool confidently detects whether a queue uses skill-based routing in the first place, but the exact skills required, when it does, are still a best-effort parse and can show "Not verifiable" for that reason.
- To understand *why* a workstream routes the way it does (rather than whether one specific agent can be reached), use [Visual Routing Tester](../visual-routing-tester/manual.md). To watch what a real call actually captured, use [Context Variable Monitor](../context-variable-monitor/manual.md).
