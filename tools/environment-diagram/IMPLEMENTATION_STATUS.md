# Environment Diagram — Implementation Status

Built 2026-11-01/02, after the user asked for "a 2D Visio-style representation of the environment, with the same functionality as the two visualization tools", leaving the grouping and layout decisions to me.

## Decisions

- **Same data, same facts:** the explorer's `dataverse.ts`, `graph.ts`, `health.ts`, `live.ts`, `ride.ts`, `tour.tsx` and the 3D Contact Center's `centers.ts` and `store.ts` are imported, not copied, so the three tools always agree.
- **Layout:** a cross-functional flowchart, left to right in call order, with workstreams and queues as containers (rules, default, bot inside a workstream; hours and agents inside a queue) and the smaller records as tags. Lines only for what a call travels. Queues are placed near the rules that route to them; lines get their own track through the gap.
- **An agent in several queues is drawn in each** (like 3D Contact Center's desk per room); selecting one lights up every copy.
- **SVG with attributes only** (no CSS classes), so the download is a faithful drawing that Visio and browsers open.
- After review (2026-11-02):
  - a click in the diagram **never moves the view** (centering on every click felt odd); lists only scroll a record into view when it's off screen;
  - the start view **fits the width**, top-aligned, right of the panel (fitting everything was too small to read); **Fit** shows all;
  - the zoom bar reads **− % +**;
  - the **Centers tab is an exact copy of 3D Contact Center's** (first tab, eye to hide, Move to…, drag, "Show queues nothing routes to", start again), on the same saved grouping. Hidden workstreams leave the diagram with their bot, rules and the channels and numbers that only lead there; queues nothing routes to are hidden until asked for (picking one from the Health list shows them).

## Tests

- `tests/layout.test.ts`: containers, rows inside their container, no overlaps in a lane, rule order, right-angled lines, agents in several queues, hidden kinds, spacing, visible-only, customer centers, the follow-the-call route, helpers.
- `tests/readOnly.test.ts`: no writes in `src/`; reads through the explorer's data layer; saved views.

## Testing

Run end to end in a browser on the sample data, and checked live by the user in `academyexperiment` (2026-11-02). Deployed there; in solution **1.0.0.19** (**Visualization → Environment Diagram**).
