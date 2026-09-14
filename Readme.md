# Promethean CCaaS Toolbox

A toolbox of diagnostic and testing tools for administrators of **Dynamics 365 Contact Center** (unified routing). Each tool is a self-contained, read-only utility that runs inside your Dataverse environment — no external hosting, no extra sign-in, no writes to your live configuration or call data.

## Getting the toolbox into your environment

The toolbox is packaged as a single **unmanaged Dataverse solution** that bundles every tool below. Import the solution zip into your target environment via Power Platform's Solutions area (or the `pac` CLI) to get all tools at once.

> 📦 Solution zip: *to be added here.*

Alternatively, you can build and deploy each tool yourself from this repo — see [Deployment](#deployment) below.

## Tools

| Tool | What it does |
| --- | --- |
| [Visual Routing Tester](tools/visual-routing-tester/README.md) | Visualizes a workstream's full routing configuration (classification, queues, overflow) as an interactive diagram, and lets you simulate a call against it to see exactly which rules fire and where it ends up. |
| [Context Variable Monitor](tools/context-variable-monitor/README.md) | Watches the actual context-variable values a real call captures, live, as it moves through the IVR and unified routing — for debugging against real traffic rather than simulated configuration. |

Each tool has its own README with details on what it does, how it works, and how to build/run/deploy it individually.

## Architecture

Every tool in this toolbox is a plain HTML/CSS/React (TypeScript) app, deployed as a trio of Dataverse **web resources** (`index.html`, `bundle.js`, `style.css`) and surfaced as its own subarea in a model-driven app's Site Map — not a PCF control, not a Custom Page.

**Why web resources, not PCF:** PCF controls are for reusable, data-bound components that plug into a single field/form/grid. Every tool in this toolbox is a standalone full-page utility with no binding to one record or column, which is exactly what a web resource is for — PCF and Custom Pages were tried first and ran into bound-property requirements and sizing/hosting constraints that don't fit this shape. Only a future tool that genuinely needs to embed inside an existing record's form (e.g. a mini routing-preview widget on a workstream form) would justify a PCF control instead.

All tools:
- Are **read-only** against Dataverse — none of them ever create, update, or delete configuration, queue, workstream, or conversation records.
- Read data through `Xrm.WebApi`, reusing the signed-in user's existing session — no separate Microsoft Entra ID app registration or manual OAuth setup required.
- Live in one Dataverse solution and one model-driven app/Site Map, rather than one solution per tool.
- Include a fully working **offline demo mode** with bundled sample data, so you can try them out locally without a Dataverse connection.

## Repository layout

```
tools/
  visual-routing-tester/       # Tool 1 — src, tests, webresource, css, docs
  context-variable-monitor/    # Tool 2 — src, tests, webresource, css, docs
webpack.config.js              # One build entry per tool
deploy.config.json             # Per-environment / per-tool deploy configuration
scripts/deploy.ps1             # Deploy script (see below)
```

All tools share one npm project and one webpack config (one named build entry per tool) rather than separate projects per tool, since they're all the same stack at a scale that doesn't yet justify a monorepo/workspaces setup.

## Development

```powershell
npm install
npm test
npm run build
```

Each tool can also be run locally in an offline demo mode — see that tool's own README for the exact command and port.

## Deployment

Deployment targets and per-tool web resource mappings are defined in [`deploy.config.json`](deploy.config.json) — this is the source of truth for which environment/solution each tool deploys to, not something to keep in your head.

```powershell
pwsh ./scripts/deploy.ps1 -Tool <toolkey>
```

The script builds the project, stages non-webpack files, stamps a fresh cache-busting version automatically, looks up each web resource by name in the target environment (never hardcoding a GUID), updates its content, publishes, and verifies the result by reading the live content back. Requires the Azure CLI (`az`) to be logged in with access to the target environment. Add `-CreateIfMissing` the first time a new tool's web resources don't exist yet in the target environment.

Adding a new tool to the toolbox means: a new `tools/<toolname>/` folder following the existing layout, a new webpack entry, a new `tools.<toolname>` block in `deploy.config.json`, and its own `README.md` + `IMPLEMENTATION_STATUS.md` alongside the others.
