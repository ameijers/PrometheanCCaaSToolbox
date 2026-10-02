import * as React from "react";
import { ProvisioningApp, ToolConfig } from "../../shared/src/ProvisioningApp";
import { isDataverseAvailable } from "../../shared/src/xrm";
import { source, writer } from "./dataverse";
import { demoSource, demoWriter } from "./demoData";
import { UserCatalog } from "./model";
import { buildUserPlan } from "./plan";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyCsv, exampleCsv } from "./template";

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const config: ToolConfig<UserCatalog> = {
    brand: "US",
    title: "User Setup",
    logName: "User Setup",
    logPrefix: "users",
    itemLabel: "User",
    itemPlural: "users",
    runVerb: "Set up users",
    writes: "It assigns security roles, adds users to owner teams, makes users bookable resources and links capacity profiles. It never creates users, removes roles or memberships, or deletes anything.",
    intro: <>One row per user who's already in the environment (synced from Microsoft Entra ID). Give them access <strong>directly with security roles</strong>, <strong>through owner teams</strong>, or both. Every user also becomes a <strong>bookable resource</strong> with <strong>capacity profiles</strong>, so routing can assign them work.</>,
    exampleNote: "The example sets up four users: one with roles directly, two through the \"Sales Agents\" owner team, one with a choice of capacity profiles and time zone. In the sample environment Dana is already an agent, so only what's missing is planned. Replace the names with ones from your environment.",
    exampleFileName: EXAMPLE_FILE_NAME,
    exampleCsv,
    emptyCsv,
    columns: COLUMNS,
    source: live ? source : demoSource,
    buildPlan: (csv, catalog) => buildUserPlan(csv, catalog, live ? writer : demoWriter),
    tableOf: (key) => (key === "resource" ? "bookableresource" : undefined),
    nextSteps: "Next: add the users to queues with Queue Membership. Users added to an owner team get its security roles right away."
  };
  return <ProvisioningApp config={config} />;
}
