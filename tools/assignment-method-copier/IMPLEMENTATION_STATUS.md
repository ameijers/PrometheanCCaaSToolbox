# Assignment Method Copier — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md) for the tool overview.

**Status: deployed to `academyexperiment` and tested live there on 2026-10-13: copy only, copy and use, switch back, and editing a copy in the admin center.** Routing a conversation through a copied method has not been tested live. See [Live findings](#live-findings-2026-10-13). **Updating a method already on a queue** (added 2026-11-19) has been tested against the sample environment only; see [Update a method already on the queue](#update-a-method-already-on-the-queue-2026-11-19).

## Step 0 — schema discovery (2026-10-13)

Read live from `academyexperiment` with **read-only GETs**: table and column metadata, option sets, relationships, plug-in steps, custom APIs, and two custom assignment methods. Nothing was written.

The two methods:

- **Contoso Flags Retail Custom Assignment** on the voice queue *Contoso Flags Retail*, made in the admin center for this purpose: a prioritization ruleset with one rule (an account condition and a context variable condition) and an assignment ruleset with two rules (skills, presence, capacity, schedule, language, region; ordered by nearest skill and by skill match count). It was **not** selected as the queue's method, so the queue still read *Longest Idle*.
- **Direct Agent Assignment**, the platform's own method on a system voicemail queue.

### How a custom assignment method is stored

- The queue has **`msdyn_assignmentstrategy = 192350002`** (Custom Assignment Configuration) when it uses a custom method.
- **`msdyn_assignmentconfiguration`** is the method: `msdyn_name` (Application Required), `msdyn_description`, `msdyn_queueid` (lookup to the queue) and `msdyn_isactiveconfiguration`. A method belongs to one queue. `queue` has no lookup to a method, and there are no shared or template methods (`msdyn_templateruleset` is empty and unrelated).
- **`msdyn_assignmentconfigurationstep`** rows belong to a method: `msdyn_name`, `msdyn_assignmentconfigurationid`, `msdyn_type` (`192350000` Prioritization, `192350001` AssignmentRuleSelection, `192350002` Assignment), `msdyn_steporder`, `msdyn_rulesetid` and `msdyn_isdefaultruleset`. The admin-center method has two steps: Prioritization (order 1) and Assignment (order 2), both with `msdyn_isdefaultruleset` true and named after their ruleset.
- **`msdyn_decisionruleset`** holds the rules: `msdyn_name`, `msdyn_rulesetdefinition` (XML), `msdyn_rulesettype` (`192350000` Declarative), `msdyn_authoringmode` (`192350000` Decision list), `msdyn_inputcontractid`, `msdyn_outputcontractid`, and `msdyn_isinputcollection`, `msdyn_persistoutputdata`, `msdyn_refreshinputdata` (all No). `msdyn_disabledrules`, `msdyn_fetchxml`, `msdyn_description` and the model columns were empty.
- **`msdyn_uniquename`** is System Required on all three tables and nothing fills it in. The admin center writes `msdyn_uniquename_<guid>` on a method and `msdyn_<32 hex digits>` on a step and a ruleset; the tool does the same.
- **Lookup names for writing** equal the column names: `msdyn_queueid`, `msdyn_assignmentconfigurationid`, `msdyn_rulesetid`, `msdyn_inputcontractid`, `msdyn_outputcontractid`. Entity sets: `queues`, `msdyn_assignmentconfigurations`, `msdyn_decisionrulesets`, `msdyn_decisioncontracts`.

### Contracts

- Every ruleset's **input contract** is the **queue's own** `msdyn_assignmentinputcontractid` (the `new_<guid>` contract the platform creates with each advanced queue).
- The **prioritization** ruleset's **output contract** is that same queue contract.
- The **assignment** ruleset's output contract is the managed, shared **Assignment output contract**. (The voicemail method uses a "Voicemail copy" of it.)
- Saving the rules did **not** change the queue's contract: its created and modified times are still equal, and its definition matches that of a queue without a custom method.

So a copy replaces the source queue's contract with the target queue's wherever it appears, and keeps any other contract.

### Rule definitions

- Rules refer to attributes by path (`agent.bookableresourcecharacteristic`, `msdyn_ocliveworkitem.msdyn_liveworkstreamid_msdyn_ocliveworkitem.msdyn_capacityrequired`). Skill, presence, capacity, schedule, language and region conditions contain **no ids**.
- A static value can be an id of an environment-wide record (an account id in the sample). It copies as it is.
- A **context variable** is referred to as `liveworkitemcontext.<workstream id>.<name>`. The id is the workstream's, not the queue's, so the rule copies as it is but only ever matches work from that workstream.
- Neither definition contains the queue's id or its contract's id. The tool still refuses a method whose rules do.
- Each rule has an id. `msdyn_rulesetdependencymapping` refers to rules by that id.

### What the platform does and doesn't do

- The only plug-ins on `msdyn_assignmentconfiguration` and `msdyn_assignmentconfigurationstep` are asynchronous Omnichannel reference-data sync steps. **Nothing creates steps or rulesets when a method is created**, so the tool writes every record itself.
- `msdyn_decisionruleset` Create and Update run `PostOperationUpdateDecisionRuleSet` (synchronous) and `PostOperationCreateOrUpdateDecisionContractPlugin` (asynchronous).
- One `msdyn_rulesetdependencymapping` row exists for the sample, for the context variable. It was created by **SYSTEM** at the moment the ruleset was saved, so the platform writes these, not the admin center. The tool doesn't write them.
- There is no custom API for creating or copying an assignment method.

## Decisions

| Decision | Why |
| --- | --- |
| A separate provisioning tool, not a Queue Builder column | Works on existing queues, can be re-run when the source method changes, and keeps Queue Builder's write scope small. |
| Per queue: the method first (switched off), then each ruleset with its step, and the switch last | A queue never runs on a half-copied method. A failed copy leaves a visible, switched-off method that can be deleted in the admin center, not rulesets nothing points to. |
| Every copied rule gets a new id | It is what the admin center does for a new rule, and it keeps the platform's dependency mappings of two queues apart. `msdyn_disabledrules` is rewritten to match. |
| **Use it on the queue** or **Copy only** | Switching is the point of the tool, but an admin may want to review a copy in the admin center first. |
| A queue that already uses a custom method keeps it, switched off | Nothing is destroyed, and going back is one switch. |
| A copy whose name is taken on the queue is numbered: "Name (2)" | Re-running must not fail or overwrite, and two methods with one name can't be told apart in the admin center. |
| Source and target must be the same queue type | Rules are written against work-item attributes that differ per type. Queues of another type aren't listed. |
| Only rule-based (declarative) rulesets | Model-based and component rulesets depend on other records that weren't studied. |
| **Undo changes** (was **Switch queues back**) restores the method and the active switches, and rewritten rules; the copies stay | The tool never deletes. The previous state is known exactly, so the undo is precise. |
| The platform's `<CDS System>` queues are never listed | They are the platform's own (voicemail and the like). |
| Every copy is read back: steps, rules, and for a switch the queue's method and its single active method | "Saved" isn't the same as "in effect"; plug-ins run on every one of these tables. |
| Writes go straight to the Web API (`fetch`, POST and PATCH only), limited by `CREATE_COLUMNS` / `UPDATE_COLUMNS`; reads use `Xrm.WebApi` | `Xrm.WebApi.createRecord` refused these tables in the browser (see Live findings). The write scope is still fixed, checked at runtime and by `tests/writeScope.test.ts`. A PATCH carries `If-Match: *`, so an update can never create a record. |

## Live findings (2026-10-13)

Tested in `academyexperiment` from the deployed tool, with *Contoso Flags Retail Custom Assignment* as the source.

- **`Xrm.WebApi.createRecord` doesn't work for these tables.** Creating an `msdyn_assignmentconfiguration` from the page failed with "A required parameter is not valid or is missing", with no platform error code. The same record sent straight to the Web API was accepted (checked once with a test method, deleted again). The tool's writes were moved to the Web API.
- **Copy only** to *Contoso Flags Service*: the method, both rulesets and both steps were created, pointing at that queue's own contract and the shared assignment output contract. The platform created the `msdyn_rulesetdependencymapping` row for the context variable rule by itself. The queue was not touched.
- **A copy is editable in the admin center.** A change to the copied prioritization rule saved normally.
- **"Invalid condition" is the admin center's, not the copy's.** Changing *User Languages* to *Does not contain* is refused on a copy and on the original alike.
- **Use it on the queue** on *Contoso Flags Technical*: after the copy, the method reads active and the queue reads *Custom Assignment Configuration*. So setting `msdyn_isactiveconfiguration` on the method and `msdyn_assignmentstrategy` on the queue is enough to switch.
- **Switch queues back** on *Contoso Flags Technical*: the queue reads *Longest Idle* (Least active) again and the copy is still on the queue, switched off. So going back to a built-in method takes only `msdyn_assignmentstrategy` on the queue and the method's active switch.

### Still to test

1. **Routing.** A test conversation on a queue switched to a copy is assigned by the copied rules.
2. **A queue that already uses another custom method**: that the tool switching the old one off is what the platform expects, and that **Switch queues back** restores it. How the admin center itself switches between two methods was not observed.
3. **Other environments**: other Contact Center versions, messaging and record queues, larger numbers of queues.

## Complete

- Copy planning (contracts, new rule ids, naming, blocked queues and sources), apply with per-queue isolation, read-back verification, undo, and a run log CSV per copy and per undo.
- Recognising a method already on the queue (same rules, same name), updating its rulesets with kept rule ids, adding missing rulesets, and undoing that.
- UI: source queue and method with its rulesets and rules, filters (search, current method), select-all-shown with selection kept across filters, per-row preview (new copy, update with its rule changes, already up to date, blocked), the two after-copy options, the matching choice (name, rules or none), and confirmations.
- Demo mode: 14 queues, two source methods, a queue of another type, a queue without a contract, a queue whose rulesets are rejected, a queue with an older version of "Skills first" (Sales – BE) and one with the same rules under another name (Sales – FR).
- Tests: 69 — `plan` (incl. rule matching, the matching options and removing rules first), `apply` (write order, copy only, switch off not remove, part-way failure, blocked queues never written, read-back mismatches, updates, emptying first, undo, run log), `dataverse` (mocked `Xrm.WebApi` reads and Web API writes, table and column limits, error reporting), `writeScope`. Also driven end to end in headless Chrome against the demo build: choose a source, select all, preview, copy with one part-way failure, switch back, and no horizontal scroll at 390px; and on 2026-11-19 in headless Edge: a new copy, an update and a switch-on in one run, the confirmation, the result and the undo, with no horizontal scroll at 540px (the narrowest headless Edge window).

## Update a method already on the queue (2026-11-19)

Product owner request: when the method is already on a target queue, recognised by its rules or its name, the admin decides per run how it's recognised, and the method's rulesets are **updated to be like the source's**, not copied again or skipped.

### Read-only check (academyexperiment, 2026-11-19)

Read with GETs only: every `msdyn_assignmentconfiguration`, its steps and rulesets, with created and modified times.

- **The admin center updates a ruleset in place.** The rulesets of the copy on *Contoso Flags Service* (created 2026-10-13 08:55 by this tool) were edited in the admin center at 09:00–09:01 (Live findings above): same ruleset ids, `modifiedon` later than `createdon`. The source method's rulesets, too, were created first and modified when their rules were saved. So rewriting `msdyn_rulesetdefinition` on the existing row is what the admin center does; the same plug-ins run (`PostOperationUpdateDecisionRuleSet`, synchronous; the contract plug-in, asynchronous).
- The environment has "Contoso Flags Retail Custom Assignment" on three queues (Retail, Service, Technical), all switched off: a good first live test of the update by name.

### Decisions

| Decision | Why |
| --- | --- |
| One choice per run: recognise by **name** (default), by **rules**, or **not at all** | Product owner choice. First built as two checkboxes (same rules checked first), changed the same day: with both on, a method with the same rules under another name won over the same-named one, while the same-named one was expected to be updated. One choice means one check can't overrule the other. **Remove all assignment rules upfront** stays a separate checkbox because it combines with each choice. |
| Not at all = a new copy, as before | The behaviour the tool had before updates were added. |
| Same rules = the same kinds of ruleset, each with rules that do the same in the same order | Rule ids differ per queue by design, and a rule's name doesn't change what it does. |
| A matched method's rulesets are rewritten to the source's rules; missing rulesets are added; extra rulesets stay | "Updated and similar to the source". The tool still never deletes a record. |
| A rule keeps its id when one on the target does the same, else when one has the same name | The platform links rules by id (`msdyn_rulesetdependencymapping`, Step 0); keeping ids keeps those links for rules that stay. |
| Only `msdyn_rulesetdefinition` and `msdyn_disabledrules` are written on an existing ruleset | The contracts, name and settings stay as the admin center made them. A ruleset whose contracts don't fit the target queue blocks the update instead. |
| Blocked when two methods have the source's name, or a method has two rulesets of one kind | The tool can't tell which one is meant. |
| **Undo changes** writes back the old rules | The previous definition is in the plan, so the undo is exact. |

### Remove all assignment rules upfront (2026-11-19)

Product owner request: a checkbox to remove all assignment rules on the destination before the copy.

| Decision | Why |
| --- | --- |
| "Remove" empties each ruleset (its `<rule>` elements out of `msdyn_rulesetdefinition`, `msdyn_disabledrules` cleared); no record is deleted | The tool never deletes, and the undo can write the old rules back exactly. The result for routing is the same: only the source's rules are left. |
| Every ruleset of every custom method on the queue, except those of a matched method that get the source's rules anyway | Those end up exactly like the source's; rewriting them in place keeps their rule ids. |
| Off by default, emptied first, recorded with the run | It's the most far-reaching option; doing it first matches "upfront", and the run log and undo cover it. |
| A warning, not a block, when the method in use is emptied and the queue isn't switched | It may be intended (switching in the admin center later), but the queue then assigns work without those rules. |
| Emptied rulesets are read back | As every other write. |

Not verified live: that the platform accepts a rule-based ruleset with no rules (`<decision …><rules></rules></decision>`). The admin center creates rulesets before their rules are added (Step 0: created, then modified when rules were saved), which suggests it does.

### Still to test live

1. Update by name on *Contoso Flags Service* after changing the source's rules: the rulesets keep their ids, the admin center shows the new rules, and the dependency mapping of the context variable rule is kept.
2. Undo of that update.
3. A ruleset added to an existing method: that the platform orders prioritization before assignment when two steps share a step order.
4. **Remove all assignment rules upfront** on a test queue: the emptied rulesets save, the admin center shows them without rules, and **Undo changes** brings the rules back.
## Site Map subarea

Included in the packaged solution from **1.0.0.9** onward (current: `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_25.zip`): **Creation → Queue Assignment Method Copier**. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/assignmentmethodcopier/index.html`. See the [toolbox README](../../Readme.md#site-map-subareas).

## Not done

- A ruleset the method on the queue has and the source lacks is left as it is (never removed).
- Step order isn't changed: a ruleset added to an existing method gets the source's step order, even if another step on that method already has it.
