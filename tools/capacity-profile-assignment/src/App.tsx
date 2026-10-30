// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { ProvisioningApp, ToolConfig } from "../../shared/src/ProvisioningApp";
import { isDataverseAvailable } from "../../shared/src/xrm";
import { source, writer } from "./dataverse";
import { demoSource, demoWriter } from "./demoData";
import { CapacityCatalog } from "./model";
import { buildCsvPlan } from "./plan";
import { makeSelection } from "./Selection";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyCsv, exampleCsv } from "./template";

const live = isDataverseAvailable();
const activeWriter = live ? writer : demoWriter;
const Selection = makeSelection(activeWriter);

export function App(): React.ReactElement {
  const config: ToolConfig<CapacityCatalog> = {
    brand: "CP",
    title: "Capacity Profile Assignment",
    logName: "Capacity Profile Assignment",
    logPrefix: "capacity-profile-assignment",
    itemLabel: "User",
    itemPlural: "users",
    runVerb: "Assign capacity profiles",
    writes: "It links existing capacity profiles to users' bookable resources. It never removes a profile, changes a profile's units, creates profiles or changes anything else.",
    intro: <>One row per user, with the capacity profiles to assign (by name or unique name, separated by <code>|</code>): <code>Default voice inbound|Default voice outbound</code>. Users must already be <strong>bookable resources</strong>: set them up with User Setup first. Prefer clicking? Use <strong>Select users and profiles</strong> above.</>,
    exampleNote: "The example assigns profiles to three users. In the sample environment Dana already has Default voice inbound, so that one is left alone. Replace the names with ones from your environment.",
    exampleFileName: EXAMPLE_FILE_NAME,
    exampleCsv,
    emptyCsv,
    columns: COLUMNS,
    source: live ? source : demoSource,
    buildPlan: (csv, catalog) => buildCsvPlan(csv, catalog, activeWriter),
    tableOf: (key) => (key.startsWith("capacity:") ? "msdyn_bookableresourcecapacityprofile" : undefined),
    nextSteps: "Routing uses a user's capacity profiles to decide how much work of each kind they can take at once. A workstream only assigns work to agents who have the capacity profile it asks for. Check an agent's profiles on their bookable resource record or in the admin center under Users.",
    selection: { tabLabel: "Select users and profiles", component: Selection, openFirst: true }
  };
  return <ProvisioningApp config={config} />;
}
