# Route-to-Queue Builder — Implementation Status

Part of the [Promethean CCaaS Toolbox](../../Readme.md); see [README.md](README.md) for the tool overview.

**Status: deployed to `academyexperiment` and tested live there on 2026-10-14**, and in the packaged solution from 1.0.0.10. See [Live findings](#live-findings-2026-10-14).

## Step 0 — schema discovery (2026-10-14)

Read live from `academyexperiment` with **read-only GETs**: table and column metadata, option sets, relationships, plug-in steps, every routing configuration and context variable, and a route-to-queue ruleset made in the admin center for this purpose. Nothing was written.

The sample: on the voice workstream *Contoso Flags Retail* (no routing before), a text context variable **MenuItemSelected** and a route-to-queue ruleset **Route Selected Menu Items** with two rules: *MenuItemSelected* equals `Service` → *Contoso Flags Service*, equals `Sales` → *Contoso Sales*.

### Context variables

- **`msdyn_ocliveworkstreamcontextvariable`**, one row per variable per workstream: `msdyn_name` and `msdyn_displayname` (both the name), `msdyn_datatype` (`192350000` Text, `192350001` Number, `192350002` Boolean, `192350100` Entity Reference), `msdyn_isdisplayable` true, `msdyn_islist` false, `msdyn_ismodifiable` true, `msdyn_issystemdefined` false, `msdyn_liveworkstreamid`. Required: name, data type, workstream.
- **The workstream's routing contract** (`msdyn_liveworkstream.msdyn_routingcontractid`, a `new_<guid>` decision contract) lists every text variable under `<complex key="liveworkitemcontext">` as `<variable name="…" data-type="string" />`.
- **The platform adds a new variable to that contract in the background.** The variable was created at 05:35:03 and the contract modified at 05:35:23. The plug-in is `CRUDDecisionContracts` on Create, **asynchronous**. Synchronous pre-validation plug-ins also run on Create (`PreValidationContextVariableCreatePlugin`, `PreValidateCreateUpdateContextVariable`).

### Route to queue

- **`msdyn_routingconfiguration`**: the workstream's routing, `msdyn_name`, `msdyn_uniquename` (`new_<32 hex>`), `msdyn_isactiveconfiguration`, `msdyn_liveworkstreamid`. The admin center named it after the ruleset. Every workstream with routing has exactly one active configuration.
- **`msdyn_routingconfigurationstep`**: `msdyn_name`, `msdyn_uniquename` (`new_<32 hex>`), `msdyn_type` (`192350000` Enrichment, `192350001` Skill identification, **`192350002` Queue identification** = route to queue, `192350003` Agent group identification), `msdyn_steporder`, `msdyn_routingconfigurationid`, `msdyn_rulesetid`. **A workstream has one route-to-queue ruleset**: every configuration has at most one Queue identification step, and the admin center offers only one.
- **`msdyn_decisionruleset`**: `msdyn_name`, `msdyn_uniquename` (`new_<32 hex>`), Declarative, Decision list, input flags all No. **Input contract = the workstream's routing contract; output contract = the managed "Demand queue identification output contract"** (looked up by name).
- **Order in the admin center**: configuration (05:35:28), ruleset (05:35:29), step (05:35:30); the rules were saved into the ruleset afterwards (05:37).
- **Plug-ins on the configuration and step tables** are only cache refreshes on Update and Delete. Nothing creates steps or rulesets for us.

### The rules

The ruleset definition the admin center wrote, per rule (the tool writes exactly this; see `tests/rules.test.ts`):

```xml
<decision hit-policy="all" version="1">
  <rules>
    <rule id="<new guid>" name="Route to service">
      <logical operator="AND">
        <logical operator="AND">
          <condition operator="==">
            <lhs type="attribute">liveworkitemcontext.MenuItemSelected</lhs>
            <rhs type="staticvalue">Service</rhs>
          </condition>
        </logical>
      </logical>
      <action>
        <setattribute>
          <lhs type="attribute">assign_to.queue</lhs>
          <rhs type="staticvalue"><queue id></rhs>
        </setattribute>
      </action>
    </rule>
  </rules>
</decision>
```

- In route-to-queue rules a context variable is referred to by **name** (`liveworkitemcontext.<name>`). In assignment rules it was `liveworkitemcontext.<workstream id>.<name>` (see [Assignment Method Copier](../assignment-method-copier/IMPLEMENTATION_STATUS.md)).
- Every route-to-queue ruleset in the environment uses `hit-policy="all"`. The existing *Route to Queue* ruleset on *Contoso Voice* has no definition at all (no rules).
- **`msdyn_rulesetdependencymapping`** rows (rule → queue, rule → context variable) were created by **SYSTEM** about a minute after the rules were saved. The tool doesn't write them.

## Decisions

| Decision | Why |
| --- | --- |
| A creation tool: settings on the page plus a CSV with `workstream_name`, `rule_name`, `menu_value`, `queue_name` | Product owner (2026-10-14). The context variable and the default ruleset name are the same for the whole file. |
| The context variable's name is entered on the page | Product owner: as customizable as possible; *SelectedMenuItem* is only an example. |
| Missing context variable → created as text | Product owner. A variable with that name of another type, or in another case, is an error. |
| Rules are added **after** a workstream's existing route-to-queue rules, in CSV order | Product owner. Existing rules are never changed. |
| One ruleset per workstream; **default ruleset name** on the page | Product owner: a workstream has only one route-to-queue ruleset. The name is used only where none exists yet; an existing one keeps its name. |
| Each rule is "variable **equals** value → queue" | Product owner. Compared as text, exactly. |
| After creating a variable, wait (up to 2 minutes, reading every 3 s) until the platform has it in the routing contract | The contract is updated in the background; rules written before that would refer to a variable the contract doesn't have. If it doesn't happen in time, no rules are written and the run says to upload again. |
| The ruleset is read again just before rules are added | Rules saved in the admin center between upload and create aren't lost. |
| New configuration: active, named after the ruleset; new step after the configuration's other steps | As the admin center did. |
| Blocked: unknown or ambiguous workstream or queue, no routing contract, inactive routing, a queue of the wrong type (voice ↔ non-voice), a duplicate rule name in the ruleset | Each would fail at write time or give rules that never match. |
| Warning: a value another rule (existing or in the file) already routes | Allowed, but both rules match the same conversations. |
| Writes go straight to the Web API (POST and PATCH only), limited by `CREATE_COLUMNS` / `UPDATE_COLUMNS` | `Xrm.WebApi.createRecord` refused the routing tables in the browser (found with Assignment Method Copier). A PATCH carries `If-Match: *`, so it never creates. |
| Context variable names: letters, digits and underscores, starting with a letter | **Assumption**: matches every variable in the environment; the platform's exact rule wasn't found. The pre-validation plug-in has the last word. |

## Live findings (2026-10-14)

Run from the deployed tool with the context variable **MenuOption**, which neither workstream had:

- **Contoso Flags Sales** had routing with an empty route-to-queue ruleset (*ruleset1*, made in the admin center). The tool created the variable, waited for the platform to add it to the routing contract, and added **4 rules** to *ruleset1*.
- **Contoso Flags Service** had no routing. The tool created the variable, then the routing configuration, the ruleset *Route to queue* with **1 rule**, and the route-to-queue step.
- Both variables were accepted as created (text, pre-validation passed), and the waits succeeded.
- The platform created its dependency records (rule → queue, rule → context variable) for the rules, as it did for the admin center's rules. For the single rule in the **newly created** ruleset only the rule → queue record appeared, not rule → context variable. Routing wasn't seen to be affected; worth watching.
- The product owner confirmed the result works in the admin center.

### Still to test

1. **Routing a call**: a test call with the variable set is routed to the rule's queue.
2. **Adding to a ruleset that already has rules** with other conditions (the live runs added to an empty ruleset and created a new one; the sample environment covers the rest).
3. **Other environments**: other Contact Center versions, messaging and record workstreams, large files.

## Complete

- CSV and settings validation, resolution per workstream (variable, ruleset mode, queues, rule names, repeated values), execution with the contract wait, read-back, and a run log CSV.
- UI: settings and upload, review per workstream with the settings still editable, confirmation, results per workstream.
- Demo mode: 7 workstreams covering every path, including the background contract update and a rejected ruleset.
- Tests: 53 — `rules` (the admin center's XML exactly, appending, escaping, reading), `plan`, `execute` (write order per mode, contract wait and timeout, fresh read before append, part-way failure, read-back, blocked workstreams never written), `dataverse` (mocked `Xrm.WebApi` reads and Web API writes, scope refusals), `writeScope`. Also driven end to end in headless Chrome against the demo build: missing variable blocks, settings fixed on review, 6 rules over 4 workstreams with one part-way failure, and no horizontal scroll at 390px.

## Site Map subarea

Included in the packaged solution from **1.0.0.10** onward (current: `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_18.zip`): **Creation → Route-to-Queue Builder**. The deploy script doesn't change the Site Map, so only for an environment on an older solution version add it by hand: Type Web Resource, `pct_/tools/routetoqueuebuilder/index.html`. See the [toolbox README](../../Readme.md#site-map-subareas).

## Not done

- No undo: rules are removed in the admin center.
