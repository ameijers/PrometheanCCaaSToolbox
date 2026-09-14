# Promethean CCaaS Toolbox

A toolbox of diagnostic and testing tools for administrators of **Dynamics 365 Contact Center** (unified routing). Each tool is a self-contained, read-only utility that runs inside your Dataverse environment — no external hosting, no extra sign-in, no writes to your live configuration or call data.

## Getting the toolbox into your environment

The toolbox is packaged as a single **unmanaged Dataverse solution** that bundles every tool's web resources plus the "Promethean CCaaS Toolbox" model-driven app that surfaces them in a Site Map. There are two ways to get it running:

### Option A — Import the packaged solution (fastest, no build tooling required)

> 📦 Solution zip: [`power_platform_solution/ccaasvisualroutingtester_1_1.zip`](power_platform_solution/ccaasvisualroutingtester_1_1.zip)

Via the Power Platform maker portal:
1. Go to [make.powerapps.com](https://make.powerapps.com) and switch to the target environment.
2. **Solutions** → **Import solution** → browse to the zip above → **Next** → confirm the publisher → **Import**.
3. Once import finishes, open the **Promethean CCaaS Toolbox** app to confirm the tools' subareas load.

Via the `pac` CLI:
```powershell
pac auth create --url https://your-org.crm.dynamics.com
pac solution import --path power_platform_solution/ccaasvisualroutingtester_1_1.zip --publish-changes
```

After import, the solution's unique name in that environment is `ccaasvisualroutingtester` (the name baked into the zip's `solution.xml`) — if you plan to push code changes into that environment later with `deploy.ps1` (Option B), that's the value that belongs in `solutionUniqueName` for the matching environment entry in `deploy.config.json`; see [deploy.config.json reference](#deployconfigjson-reference) below.

### Option B — Build and deploy each tool yourself from this repo

See [Deployment](#deployment) below.

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
power_platform_solution/       # Packaged unmanaged solution zip (see Option A above)
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

The script builds the project, stages non-webpack files, stamps a fresh cache-busting version automatically, looks up each web resource by name in the target environment (never hardcoding a GUID), updates its content, publishes, and verifies the result by reading the live content back. Requires the Azure CLI (`az`) to be logged in with access to the target environment. Add `-CreateIfMissing` the first time a new tool's web resources don't exist yet in the target environment (this also adds each newly-created web resource to the solution named by `solutionUniqueName`).

```powershell
# First deploy of a tool into an environment where its web resources don't exist yet:
pwsh ./scripts/deploy.ps1 -Tool routingtester -CreateIfMissing

# Routine redeploy after that, against a non-default environment:
pwsh ./scripts/deploy.ps1 -Tool routingtester -Environment test
```

### deploy.config.json reference

```json
{
  "defaultEnvironment": "dev",
  "environments": {
    "dev": {
      "url": "https://academyexperiment.crm.dynamics.com",
      "solutionUniqueName": "ccaasvisualroutingtester"
    }
  },
  "tools": {
    "routingtester": {
      "displayName": "Visual Routing Tester",
      "stage": [
        { "from": "tools/visual-routing-tester/webresource/routingtester.html", "to": "dist/webresource/routingtester/index.html" }
      ],
      "webResources": [
        { "name": "ccas_/tools/routingtester/index.html", "path": "dist/webresource/routingtester/index.html", "type": 1, "displayName": "Visual Routing Tester - index.html", "cacheBust": true }
      ]
    }
  }
}
```

| Field | Meaning | When you need to change it |
| --- | --- | --- |
| `defaultEnvironment` | Key into `environments` used when `-Environment` isn't passed to `deploy.ps1`. | Rarely — only if the "usual" target org changes. |
| `environments.<key>` | One entry per Dataverse environment you deploy to. | Add a new key (e.g. `test`, `prod`) before deploying to a new org for the first time. |
| `environments.<key>.url` | The environment's base API URL, e.g. `https://your-org.crm.dynamics.com` (no trailing slash). Used both to request an access token and as the base for every Web API call. | Set once per environment, when you add it. |
| `environments.<key>.solutionUniqueName` | Unique name (not display name) of the Dataverse solution the web resources belong to. | Set to the solution you imported in [Option A](#option-a--import-the-packaged-solution-fastest-no-build-tooling-required) (or an existing solution) for that environment — needed whenever `-CreateIfMissing` has to add a newly-created web resource to a solution. |
| `tools.<toolkey>` | One block per tool; the key is what you pass to `-Tool`. | Add a new block when adding a new tool to the toolbox (see below). |
| `tools.<toolkey>.displayName` | Human-readable name, used only in deploy log output. | Cosmetic only. |
| `tools.<toolkey>.stage` | List of `{ "from", "to" }` file copies run before upload, for non-webpack files (html/css) that need to land next to the webpack bundle output. Both paths are repo-relative. | Update if a tool's source html/css file moves, or when adding a new tool. |
| `tools.<toolkey>.webResources` | The actual Dataverse web resources to create/update — one entry per `index.html` / `.css` / `.js`. | Update whenever a tool gains/loses a web resource, or when adding a new tool. |
| `webResources[].name` | The Dataverse web resource's unique name (e.g. `ccas_/tools/routingtester/index.html`). This is how the script looks the resource up live — **never** a GUID. Must use the same publisher prefix / path scheme as the resources already in the target solution. | Must match exactly what exists (or should exist) in the target environment. |
| `webResources[].path` | Repo-relative path to the local built file whose content gets uploaded. | Must match the `to` of the corresponding `stage` entry (for html/css) or the webpack output path (for the bundle `.js`). |
| `webResources[].type` | Dataverse web resource type code: `1` = HTML, `2` = CSS, `3` = JS/script. | Set once per resource, based on its file type. |
| `webResources[].displayName` | Display name used only when creating the resource for the first time (`-CreateIfMissing`). | Cosmetic, but only takes effect on creation. |
| `webResources[].cacheBust` | `true` to have the script stamp a fresh `?v=<timestamp>` query string into the `<script>`/`<link>` references inside this file on every deploy. | Set on the `index.html` entry (which references the css/js), not on the css/js entries themselves. |

Adding a new tool to the toolbox means: a new `tools/<toolname>/` folder following the existing layout, a new webpack entry, a new `tools.<toolname>` block in `deploy.config.json` (following the `ccas_/tools/<toolname>/...` naming convention already used by the other tools), and its own `README.md` + `IMPLEMENTATION_STATUS.md` alongside the others.
