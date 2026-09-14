# CCaaS Visual Routing Tester — Build Prompt

> This repo (`promethean-ccaas-tools`) is the multi-tool **Promethean CCaaS Toolbox**. Visual Routing Tester, specified below, is its first tool — see `IMPLEMENTATION_STATUS.md` for what's actually built. Its second tool, **Context Variable Monitor** (watches real captured context-variable values on live calls), lives alongside it at `tools/context-variable-monitor/` with its own status doc. Further tools follow the same pattern: `tools/<tool-name>/` with its own spec/status doc.

## 1. Purpose

Build a web application for **Dynamics 365 Contact Center** (unified routing) that lets an administrator **visually trace and test how an inbound voice call gets routed**, end to end:

```
Inbound Voice Workstream → (IVR, simulated via Context Variables) → Work Classification Rules
   → Queue (selected via Ruleset rules) → Queue Overflow Rules → Final Outcome
   (Agent / Voicemail / Callback / End Call)
```

The tool is for people who have **already configured** routing in an environment and want to:
- Visually understand the full routing path for a workstream, including every classification rule, every rule inside every ruleset, and every queue's overflow configuration — before running anything.
- Simulate a specific call (by supplying context-variable values) and see **exactly which rule fired, why, and where the call ended up**.
- Validate that the configuration behaves as intended, and quickly spot misconfigurations (e.g. a rule pointing at a queue that no longer exists, or no rule matching at all).

This is a **diagnostic / testing tool for admins**, not an agent-facing or customer-facing app. It must never place a real call, create real conversation records, or modify any routing configuration — it only **reads** configuration and **simulates** rule evaluation locally.

## 2. Primary User

A Dynamics 365 / Power Platform administrator or contact center configurator, working inside (or alongside) the environment where the Contact Center is configured. They understand workstreams, queues, classification rules and overflow settings conceptually, but want a faster way to validate configuration than manually tracing it through multiple admin screens or placing real test calls.

## 3. Core User Flow

1. **Connect** to a Dynamics 365 Contact Center environment.
2. **Select** an existing **inbound voice workstream** from that environment.
3. The app **loads and visualizes** the complete routing path for that workstream: the classification rules (and the order they're evaluated in), every queue they can route to, the rules inside each queue's assignment ruleset, and each queue's overflow configuration and outcomes.
4. The app detects the **context variables** defined on the workstream (these stand in for whatever the real IVR would collect) and renders an input form for them, using the correct input type per variable (text, number, boolean, option set/choice, date, etc.).
5. The user fills in context-variable values to represent a hypothetical caller/call, then clicks **Run / Simulate**.
6. The app evaluates the rules **locally, in the browser**, against the supplied values, and animates/highlights the path through the diagram in real time (or step-by-step): which classification rule matched, which queue was selected, which overflow rule (if any) fired, and the final outcome.
7. The user can adjust values and re-run to test other scenarios, and optionally save a scenario (name + variable values + resulting outcome) for later reuse and regression testing.

## 4. Functional Requirements

### 4.1 Environment Connection
- Must connect to a Dynamics 365 Contact Center / Dataverse environment **without requiring a separate Microsoft Entra ID app registration** or any manual OAuth setup by the user.
- Achieve this by running the app **inside the target Dataverse environment**, packaged as part of a **Dataverse solution**, so it can reuse the current user's existing authenticated session/context rather than perform its own sign-in. Concretely, build it as one of:
  - A **Power Apps Component Framework (PCF) control** hosted on a **Model-driven app custom page** (or a dashboard/form), using `Xrm.WebApi` for all Dataverse access, or
  - A **Custom Page** (Power Fx canvas) hosting the app, or
  - An HTML **web resource** bundled in the solution, using the Dataverse Web API (`Xrm.Utility.getGlobalContext().getClientUrl() + "/api/data/v9.2/..."`) with the ambient session cookie/token.
  - Pick whichever of these gives the richest UI (PCF is preferred for a fully custom, diagram-heavy UI) — flag this as a decision to confirm before implementation (see §8).
- The app must be **packaged for import as a solution** (managed and/or unmanaged) so it can be deployed into any target environment the normal Power Platform way (Solutions area / `pac` CLI), not run as a standalone externally-hosted site.
- All Dataverse access is **read-only**. The app must never create, update, or delete any routing configuration record, queue, workstream, or conversation record in Dataverse. It also never initiates or simulates an actual telephony call — the "call" is purely a local, in-memory rule evaluation.
- Handle and surface errors clearly: insufficient privileges to read the required tables, no workstreams found, disabled workstream, environment not a Contact Center–enabled environment, etc.

### 4.2 Workstream Selection
- On load, query Dataverse for all **inbound voice** workstreams in the environment and present them in a searchable list/dropdown (show name, and status — active/inactive).
- Do not hardcode table/column schema names without verification — the app should discover the actual routing configuration schema via the Dataverse Web API metadata (`EntityDefinitions`) at build/runtime, since exact table names can vary by product version. Confirm current schema for workstreams, work classification rules, rulesets, queues, and overflow configuration before implementing data access (see §8).

### 4.3 Routing Visualization
- Render the full routing path as a **clear, readable diagram** (flowchart/graph, e.g. a node-based canvas), not a flat list. Requirements:
  - Show the workstream as the starting node.
  - Show **every work classification rule** for that workstream, in evaluation order, with a human-readable summary of its condition(s) (e.g. `Language equals "NL" AND Priority >= 3`).
  - Show each rule's target **queue** as a node it points to, plus a clearly marked **fallback/default** path for "no rule matched," if one exists.
  - For each queue reachable this way, show its **assignment ruleset**: every rule inside it, in order, with a readable condition summary and its target (agent pool / skill-based assignment / etc.).
  - For each queue, show its **overflow configuration**: the trigger (e.g. wait time exceeded, no agents available, queue at capacity) and the resulting rule(s)/branches, ending in one of the defined terminal outcomes: **Agent, Voicemail, Callback, or End Call**.
  - The diagram must stay legible for realistic configurations with many rules/queues: support pan & zoom, collapsing/expanding branches, and search/highlight of a specific rule or queue by name.
  - Provide a way to inspect the full detail of any node (all conditions, raw values) on click/hover, not just the summarized label.

### 4.4 Context Variables (IVR Simulation)
- Instead of simulating an actual IVR, read the **context variables defined on the selected workstream** and render an input field per variable.
- Match input control to the variable's data type (text, whole number, decimal, boolean/toggle, option set → dropdown of valid choices, date/time → date picker, etc.). Pull the type (and choice values, where applicable) from the workstream/context variable definitions rather than assuming.
- Indicate which variables are actually referenced by at least one rule in the routing path (these are the ones that matter for this test) versus ones that are defined but unused, to help the user focus.
- Provide sensible validation (required format per type) before allowing simulation to run.

### 4.5 Simulation / "Run" Execution
- On **Run**, evaluate the classification rules, in their configured order, against the entered context-variable values, entirely client-side (no Dataverse writes, no real call).
- Visually animate or step through the result on the diagram: highlight the evaluated rule(s) in order, mark which one matched (and why — show the specific condition(s) that passed/failed), highlight the resulting queue, then evaluate that queue's ruleset/overflow rules the same way, down to the final outcome.
- Support both an **animated "play"** mode and a **step-by-step / instant result** mode for users who just want the end state.
- Clearly display the final outcome: routed to a queue (and, since real-time agent presence/capacity can't be known from static config, state the **assignment method** the queue would use — e.g. round robin / capacity-based / skills-based — rather than claiming a specific agent), Voicemail, Callback offered, or End Call — plus the full evaluated path as a readable trace/log the user can copy or export.
- Surface configuration problems found during evaluation as warnings, not silent failures — e.g. a rule referencing a queue or condition field that no longer exists, or a workstream with no matching rule and no fallback defined.

### 4.6 Test Scenarios (recommended addition)
- Let the user **save** a set of context-variable values as a named scenario, and reload/re-run saved scenarios later — useful for regression-testing routing changes over time.
- Let the user **export** a run's trace (path + outcome) for sharing/documentation, e.g. as text/JSON or a screenshot of the highlighted diagram.

## 5. Non-Functional Requirements
- **Read-only & non-invasive**: no writes to Dataverse, no real calls placed, no impact on live routing or reporting.
- **Performance**: workstreams with dozens of rules/queues must still render and simulate responsively.
- **Clarity over completeness**: when routing logic is genuinely complex (nested conditions, multiple overflow branches), prioritize a diagram that's easy to follow, with drill-down for detail, over cramming everything into view at once.
- **Runs inside the Power Platform admin experience**: responsive within the iframe/panel sizes typical of a model-driven app custom page; no dependency on external hosting.
- Respect the signed-in user's Dataverse security role permissions; if they lack read access to a needed table, show a clear message instead of a generic failure.

## 6. Out of Scope (v1)
- Any channel other than **inbound voice** (chat, SMS, social, etc.).
- Actually simulating IVR audio/DTMF/bot logic — only its output (context variables) is simulated.
- Real-time agent presence/skill matching to a specific named agent.
- Any write/edit capability for workstreams, rules, rulesets, or queues (this is a viewer/tester, not a configuration editor).
- Multi-environment comparison (v1 targets one connected environment at a time).

## 7. Open Questions / Assumptions to Confirm Before Building

These affect implementation and should be settled (or explicitly assumed) before/while Claude builds this:

1. **Hosting shape**: PCF control on a custom page, Custom Page (canvas/Power Fx) only, or HTML web resource? (PCF is recommended for the richest diagramming UI.)
2. **Exact Dataverse schema**: confirm current table/column (logical) names for workstreams, context variable definitions, work classification rules, rulesets/routing rules and their conditions, queues, and queue overflow configuration for the target Dynamics 365 Contact Center version — do not assume names; verify via environment metadata.
3. **Diagramming approach**: which library/technique to use for the interactive node graph (e.g. a JS diagramming/flow library) given it must run inside a Dataverse web resource/PCF sandbox (bundle size, allowed dependencies, no external CDN calls if the environment restricts them).
4. **Overflow outcome detail**: confirm the exact set of terminal outcomes to support (Agent / Voicemail / Callback / End Call as stated) and how each is represented in the queue's overflow configuration.
5. **Scenario persistence**: should saved test scenarios be stored locally (browser storage) only, or persisted in Dataverse (e.g. a custom table) so they're shared across users/sessions?
6. **Target Dynamics version/SKU**: confirm this targets Dynamics 365 Contact Center (the unified, standalone product) as opposed to the older Omnichannel for Customer Service add-on — schema and terminology may differ slightly between them.
