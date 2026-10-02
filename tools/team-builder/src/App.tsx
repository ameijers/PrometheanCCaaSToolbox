import * as React from "react";
import { ProvisioningApp, ToolConfig } from "../../shared/src/ProvisioningApp";
import { isDataverseAvailable } from "../../shared/src/xrm";
import { source, writer } from "./dataverse";
import { demoSource, demoWriter } from "./demoData";
import { TeamCatalog } from "./model";
import { buildTeamPlan } from "./plan";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyCsv, exampleCsv } from "./template";

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const config: ToolConfig<TeamCatalog> = {
    brand: "TB",
    title: "Team Builder",
    logName: "Team Builder",
    logPrefix: "teams",
    itemLabel: "Team",
    itemPlural: "teams",
    runVerb: "Create teams",
    writes: "It creates Dataverse teams (Owner or Entra ID security group) and assigns security roles to them. It never changes team members, removes roles or deletes teams.",
    intro: <>One row per team. Choose <strong>Owner</strong> (members are added in Dataverse, e.g. with User Setup) or <strong>Entra ID security group</strong> (members come from the group; fill in its Object ID). Security roles are taken from the team's business unit.</>,
    exampleNote: "The example creates two owner teams and two Entra ID security group teams with security roles. In the sample environment \"Sales Supervisors\" already exists, so it only gets its missing role. Replace the names with ones from your environment.",
    exampleFileName: EXAMPLE_FILE_NAME,
    exampleCsv,
    emptyCsv,
    columns: COLUMNS,
    source: live ? source : demoSource,
    buildPlan: (csv, catalog) => buildTeamPlan(csv, catalog, live ? writer : demoWriter),
    tableOf: (key) => (key === "team" ? "team" : undefined),
    nextSteps: "Next: add users to the owner teams with User Setup. Members of an Entra ID security group team come from the group itself: add users to the group in the Microsoft Entra admin center."
  };
  return <ProvisioningApp config={config} />;
}
