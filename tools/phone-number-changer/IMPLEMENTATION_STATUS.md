# Phone Number Changer — implementation status

## State (2026-10-26)

- Built on branch `phone-number-changer`, after the user asked for a tool to move numbers between workstreams and outbound profiles (blog: replacing a phone number in a voice channel bound to a workstream). Scope agreed with the user: **only changing the number of a voice channel or outbound profile** (outbound workstreams included); the number is expected to be set up and synced into Contact Center already.
- Runs end to end on the sample data. Tests: `plan.test.ts` (usable numbers, the inbound check, caller ID, order of a move and a swap, revert), `apply.test.ts` (swap, skip instead of doubling up, failure in a swap, the sample change and revert), `dataverse.test.ts`, `writeScope.test.ts`.
- **Not yet tested live**: no number in `academyexperiment` was free to test with. Proposed test: move +13468450068 from Contoso Voice Sales to Contoso Flags Retail Voice 1, make a test call, revert — waiting for the user's go-ahead. To confirm then: that the platform takes the change the same as from the admin center (calls arrive at the new channel), and that clearing a lookup with `null` (No number, the free step of a swap) works.
- Not in a solution zip yet; needs a Site Map subarea (`pct_/tools/numberchanger/index.html`).

## Step 0 — schema (2026-10-26, read-only)

Read live from `academyexperiment` with GETs only (metadata, rows, plug-in steps):

- **The number of a voice channel** is the lookup `msdyn_ocvoicechannelsetting.msdyn_phonenumberid` (optional); outbound channels also have `msdyn_calleridphonenumberid`. On every outbound profile and the proactive outbound workstream both lookups pointed at the same number.
- **Outbound profiles are workstreams** (`msdyn_liveworkstream`, `msdyn_direction` 1) with one voice channel; proactive outbound is `msdyn_direction` 4.
- **A number is shared** between inbound and outbound: +13159956114 was on the Contoso Voice inbound channel and the Default Outbound Profile; +13468450068 on Contoso Voice Sales and the proactive outbound workstream. The user confirmed the rule: a number is on at most **one inbound channel** and **one outbound profile** (outbound and proactive outbound count as outbound).
- **Numbers** (`msdyn_ocphonenumber`): `msdyn_phoneinboundenabled`, `msdyn_phoneoutboundenabled`, `statecode`; Teams numbers carry `msdyn_teamsresourceaccount`. One number was deactivated.
- **Plug-ins on voice channel update:** `PostOperationVoiceChannelSettingEventPlugin` (Contact Center PSTN management, synchronous, all columns) and the cache invalidation (`InvalidateOCEntityCachePluginOp`, async). So a Web API update goes through the same platform logic as the admin center; the tool doesn't touch the number records (which have their own plug-ins on the inbound/outbound flags).
- Auditing is off for `msdyn_ocvoicechannelsetting`, so earlier admin-center changes couldn't be compared.

## Decisions

- **Write only the two lookups**, through `Xrm.WebApi.updateRecord` (`@odata.bind` to set, the navigation property set to `null` to clear), from `dataverse.ts` only; the runtime refuses anything else and `writeScope.test.ts` checks it.
- **One inbound channel and one outbound profile per number** (after review; first the tool only limited inbound): blocked in the plan, and checked again before each update (an earlier update in the run may have failed). One inbound channel and one outbound profile sharing a number is normal and gives no warning.
- **The picker** starts on the current number, marked "(current)" (after review: "Keep <number>" was unclear), and labels every other number free, now on (another channel of the same side, named), or why it can't be used.
- **Safe order** (`orderSteps`), per side: the channel giving a number away first; a swap frees one number first. A channel freed for a swap whose final update then fails is reported as having no number.
- **Take a number off its other channel automatically** (after review, a switch, off by default): `withDetaches` adds a "no number" edit, marked auto, for every channel on the same side that has a picked number and isn't being changed itself; the usual planning, order, checks, log and revert apply. A profile's caller ID goes with it only when it was the same number.
- **Caller ID follows the number** on outbound channels by default, because that's how every profile in the environment was set up; it can be switched off per channel.
- Edits per row (no selection + one setting), since every channel gets its own number.
