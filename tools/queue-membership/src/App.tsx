import * as React from "react";
import { ProvisioningApp, ToolConfig } from "../../shared/src/ProvisioningApp";
import { isDataverseAvailable } from "../../shared/src/xrm";
import { source, writer } from "./dataverse";
import { demoSource, demoWriter } from "./demoData";
import { MembershipCatalog } from "./model";
import { buildMembershipPlan } from "./plan";
import { COLUMNS, EXAMPLE_FILE_NAME, emptyCsv, exampleCsv } from "./template";

export function App(): React.ReactElement {
  const live = isDataverseAvailable();
  const config: ToolConfig<MembershipCatalog> = {
    brand: "QM",
    title: "Queue Membership",
    logName: "Queue Membership",
    logPrefix: "queue-membership",
    itemLabel: "User",
    itemPlural: "users",
    runVerb: "Add to queues",
    writes: "It adds users to advanced queues. It never removes members, changes queues or deletes anything.",
    intro: <>One row per user, with the advanced queues to add them to (separated by <code>|</code>). Users must already be <strong>bookable resources</strong>: set them up with User Setup first.</>,
    exampleNote: "The example adds three users to queues. In the sample environment Anna is already in \"Sales – NL\", so only her other queue is planned. Replace the names with ones from your environment.",
    exampleFileName: EXAMPLE_FILE_NAME,
    exampleCsv,
    emptyCsv,
    columns: COLUMNS,
    source: live ? source : demoSource,
    buildPlan: (csv, catalog) => buildMembershipPlan(csv, catalog, live ? writer : demoWriter),
    tableOf: () => undefined,
    nextSteps: "Agents get work from these queues once they're signed in and available, and routing reaches the queue."
  };
  return <ProvisioningApp config={config} />;
}
