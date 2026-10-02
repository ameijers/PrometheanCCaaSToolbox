// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { ProvisioningApp, ToolConfig } from "../../shared/src/ProvisioningApp";
import { isDataverseAvailable } from "../../shared/src/xrm";
import { source, writer } from "./dataverse";
import { demoSource, demoWriter } from "./demoData";
import { SkillCatalog } from "./model";
import { buildCsvPlan } from "./plan";
import { makeSelection } from "./Selection";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyCsv, exampleCsv } from "./template";

const live = isDataverseAvailable();
const activeWriter = live ? writer : demoWriter;
const Selection = makeSelection(activeWriter);

export function App(): React.ReactElement {
  const config: ToolConfig<SkillCatalog> = {
    brand: "SA",
    title: "Skill Assignment",
    logName: "Skill Assignment",
    logPrefix: "skill-assignment",
    itemLabel: "User",
    itemPlural: "users",
    runVerb: "Assign skills",
    writes: "It assigns existing skills to users and changes the rating of skills they already have. It never removes skills, creates skills or changes anything else.",
    intro: <>One row per user, with the skills to assign (separated by <code>|</code>), each with an optional rating after a colon: <code>English:Good|Billing:4</code>. Users must already be <strong>bookable resources</strong>: set them up with User Setup first. Prefer clicking? Use <strong>Select users and skills</strong> above.</>,
    exampleNote: "The example assigns skills to three users. In the sample environment Anna already has English (Good), so it's planned as a rating change; Dana already has English (Excellent), so that's left alone. Replace the names with ones from your environment.",
    exampleFileName: EXAMPLE_FILE_NAME,
    exampleCsv,
    emptyCsv,
    columns: COLUMNS,
    source: live ? source : demoSource,
    buildPlan: (csv, catalog) => buildCsvPlan(csv, catalog, activeWriter),
    tableOf: (key) => (key.startsWith("skill:") ? "bookableresourcecharacteristic" : undefined),
    nextSteps: "Skill-based routing uses these skills when a workstream's route-to-queue or assignment rules match on them. Check an agent's skills on their bookable resource record.",
    selection: { tabLabel: "Select users and skills", component: Selection }
  };
  return <ProvisioningApp config={config} />;
}
