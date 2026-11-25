# Environment Snapshot — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md). Built 2026-11-25 as a new, separate tool: it reuses other tools' code by importing it (Visual Routing Tester's rule parser, the shared read helpers) and changes none of them. The one change outside the tool is its card on Toolbox Home (product owner's choice), which Home's own test requires for every deployable tool.

**Status:** built and tested against the sample environment, and its snapshot code run against `academyexperiment` with read-only requests (see [Live check](#live-check-2026-11-25)). Deployed to `academyexperiment` (2026-11-25) and in the packaged solution from **1.0.0.28** (Site Map: **Tools → Environment Snapshot**). Its card is on Toolbox Home (Tools group, marked new). Still to do: running it in other environments (dev, sit, uat, prd).

## Step 0 — what's read (academyexperiment, 2026-11-25, read-only)

The table list was checked against `academyexperiment` with read-only GETs (table definitions and row counts). Every table in `src/tables.ts` exists there except `msdyn_agentscript`, which isn't listed. Findings that shaped the tool:

- **Workstreams carry secrets**: `msdyn_apikey` and `msdyn_secureapikey` are plain readable columns. Other tables have them too (queues: `emailpassword`; Facebook pages: `msdyn_fbpageaccesstoken`; custom messaging accounts: `msdyn_msappsecret`; users: `msdyn_botsecretkeys`). Hence the secret filter in `src/columns.ts`, which drops such columns from the rows as soon as they're read.
- `queue` has 310 rows, mostly users' personal queues: only `msdyn_isomnichannelqueue eq true` is read.
- `systemuser` has 226 rows with personal details: only the users the configuration points to are read, with a fixed set of work columns.
- `msdyn_ocsystemmessage` (automated messages) has 876 rows: it's in the workbook, not worded in the document.
- `msdyn_ocrecording` (54 rows) is call data, not configuration, and isn't read.
- Routing step types (`msdyn_type`): 192350000 Enrichment, 192350002 Queue identification, as Visual Routing Tester has them.

Columns aren't listed by hand: every readable column comes from the table's definition (`EntityDefinitions(...)?$expand=Attributes`), with its display name.

## Decisions

| Decision | Why |
| --- | --- |
| A new tool, nothing changed in other tools | Product owner request. Code is reused by importing it. |
| Everything in the snapshot; two formats: a designed PDF and Excel | Product owner choice: the PDF to read, the workbook to work with. |
| PDF through the browser's Save as PDF, from print styles | No PDF library needed; the page is the document. A4, cover, contents, page per section, page numbers. |
| The .xlsx is written by the tool (`src/xlsx.ts`), stored uncompressed | No new dependency for one feature; every spreadsheet program reads stored zips. Checked by opening a generated file in Excel. |
| Secrets dropped from rows on read, not just hidden | Then a snapshot can't leak them later (in a future saved snapshot file for comparing). A setting *about* a secret (when a token expires, a key's version) is kept. |
| Records by name; record ids in rules replaced by names | Readable, and names are what a future comparison between environments matches on. |
| Rules worded from their definition, reusing Visual Routing Tester's parser | One parser for the toolbox; nested And/Or groups are kept ("A and (B or C)"). |
| Users limited to queue members, bookable resources and bots; built-in SYSTEM/INTEGRATION aren't agents | Privacy and relevance. SYSTEM is a member of the platform's voicemail queues. |
| Queue members, team members and agents' security roles are added as tables | They live in intersect tables a plain table read doesn't show by name. |
| A table that's missing or unreadable is noted, never fatal | Environments differ in installed channels and in the reader's permissions. |
| A card on Toolbox Home, and no other change to existing tools | Product owner: don't change existing tools; then chose to add the Home card, which Home's test requires for every tool in deploy.config.json. |

## Live check (2026-11-25)

The snapshot, document and workbook code (`snapshot.ts`, `document.ts`, `excel.ts`) was compiled and run against `academyexperiment` with a small read-only source (GET requests with the operator's own token, the same queries `dataverse.ts` makes). Nothing was written; the output stayed outside the repo.

- 52 tables read, none failed; 29 workstreams, 26 queues, 37 rulesets, every ruleset worded. Took about 30 seconds; the workbook is about 3 MB.
- Real rules read naturally, for example *MenuItemSelected is "Service" → Route to queue "Contoso Flags Service"* and overflow *queue size is at least "1" → When queue size overflows; Overflow action "Voicemail"*. Terms that read raw on the first run (queue size, time waited, presence, custom skill match) were added to the wording.
- Two fixes came from it: a token's expiry time was wrongly treated as a secret, and the SYSTEM user appeared as an agent.

## Not done

- Comparing snapshots is done by [Environment Compare](../environment-compare/README.md), from the snapshot file this tool saves (*Download snapshot file*, added 2026-11-25; format in `src/snapshotFile.ts`).
- Operating hours are named, not shown as times (the calendar rules aren't read).
- Messaging channels' settings are in the workbook; the document names only voice channels per workstream.

## Tests

41: `snapshot` (every table, missing and unreadable tables, secrets never in the snapshot, column choice, scoped queues and users, queue and team members, security roles, progress, one failing table), `document` (totals, workstream settings, channels, variables, capacity, routing rules in words, queues with assignment and overflow rules and members, agents, lists, nested and weighted rules), `excel` (zip and checksum read back, sheet names, escaping, cell limit, the workbook's sheets, no secret in the file), `readOnly`. Also driven in headless Edge against the demo build: take snapshot, preview, print to PDF, download Excel (opened in Excel: 57 sheets), no horizontal scroll.
