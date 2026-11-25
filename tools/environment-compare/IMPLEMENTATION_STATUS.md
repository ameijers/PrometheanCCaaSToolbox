# Environment Compare — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md). Built 2026-11-25 as a new tool, the next step after [Environment Snapshot](../environment-snapshot/README.md), whose snapshot model, reader, rule wording and sample environment it reuses by importing them.

**Status:** built and tested against two sample environments; deployed to `academyexperiment` (2026-11-25) and in the packaged solution from **1.0.0.28** (Site Map: **Tools → Environment Compare**). Its card is on Toolbox Home (Tools group, marked new), which Home's test requires for every deployable tool.

## Decisions

| Decision | Why |
| --- | --- |
| A separate tool, comparing snapshot files | Product owner choice. A web resource can't read another environment (each needs its own sign-in); files also work for environments you can't reach, and for one environment over time. |
| A snapshot file (.json), not the Excel workbook | The workbook has labels only (no record ids or lookup ids, which matching by ID needs), can cut off long rule definitions, and is easily changed. Environment Snapshot got a *Download snapshot file* button for it (`src/snapshotFile.ts` there, with a format name and version). |
| One side may be a fresh snapshot of the environment the page runs in | Comparing "here" with a file from elsewhere is the common case. |
| Match by name or by ID, chosen per comparison | Product owner request. Environments set up separately have different ids; environments filled from a solution or a copy share them. |
| By name, ids inside values become names | Otherwise every rule and lookup would differ between environments set up separately. An id the snapshot doesn't know becomes "(id)". |
| Rules compared as worded rules (by name) | Rule ids differ per environment by design; the wording is what the rule does. |
| Never compared: ids, created/modified dates and by, owner | They always differ. |
| Phone numbers, users, memberships, roles, agents' skills and capacity, bots: marked, hidden by default | "Configuration only", product owner choice; still there with one switch. |
| Link records matched by what they link; duplicates refined by their links, then paired in order with a note | Many configuration records have no unique name of their own (routing steps are all called "Route to queue"). |
| A table missing or unreadable on one side is noted, not compared | Otherwise every record would show as "only in" the other side. |
| On-screen only | Product owner choice for now; a PDF or Excel report of the differences can follow. |

## Not done

- A PDF or Excel report of the differences.
- A live comparison between two real environments (dev, sit, uat, prd): the sample pair covers the cases, and the snapshot code has been run on academyexperiment, but two real environments haven't been compared yet.
- Bringing differences over (for example as CSV files for the creation tools).

## Tests

16: `compare` (a snapshot is the same as itself, by name and by ID; queues with other ids found by name, changed, missing and extra queues; a workstream setting; rules compared as worded rules; link records; phone numbers marked and hidden; tables missing or unreadable on a side; by ID: other ids are other records, lookups differ; the snapshot file round trip and refusing other files), `readOnly`. Also driven in headless Edge against the demo build: loading the sample pair, by name, a changed rule highlighted, by ID, no horizontal scroll.
