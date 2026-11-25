// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { demoSource } from "../../environment-snapshot/src/demoData";
import { Row, Snapshot } from "../../environment-snapshot/src/model";
import { takeSnapshot } from "../../environment-snapshot/src/snapshot";

// Two sample snapshots for the demo and the tests: Environment Snapshot's sample environment ("dev"),
// and a copy of it ("test") with these differences:
// - every queue has another id (as when queues are created by hand in each environment), so matching
//   by name finds them and matching by id doesn't;
// - Sales – EN uses Highest capacity instead of Least active;
// - Support – Voice asks 40 capacity instead of 30;
// - the "Dutch callers" rule checks nl-BE instead of nl-NL;
// - Sales – Outbound isn't there, and a Billing queue is only in test;
// - the phone numbers end in another digit (expected to differ per environment).

const F = "@OData.Community.Display.V1.FormattedValue";
const QUEUE_ID = /00000000-0000-4000-a200-(\d{12})/g;

function table(snapshot: Snapshot, logicalName: string) {
  return snapshot.tables.find((t) => t.logicalName === logicalName)!;
}

export async function sampleSnapshots(): Promise<{ a: Snapshot; b: Snapshot }> {
  const a = await takeSnapshot(demoSource);
  a.environment = "sample dev environment";
  // Queues get other ids in test: everywhere they're referred to, in lookups and in rules.
  const b: Snapshot = JSON.parse(JSON.stringify(a).replace(QUEUE_ID, (_all, n: string) => `00000000-0000-4000-d200-${n}`));
  b.environment = "sample test environment";
  b.takenAt = new Date(Date.parse(a.takenAt) + 3600 * 1000).toISOString();

  const queues = table(b, "queue");
  const salesEn = queues.rows.find((q) => q.name === "Sales – EN")!;
  Object.assign(salesEn, { msdyn_assignmentstrategy: 192350000, [`msdyn_assignmentstrategy${F}`]: "Highest capacity" });
  const outbound = queues.rows.find((q) => q.name === "Sales – Outbound")!;
  queues.rows = queues.rows.filter((q) => q !== outbound);
  queues.rows.push({ ...outbound, queueid: "00000000-0000-4000-d200-000000000099", name: "Billing", msdyn_priority: 20 } as Row);
  table(b, "queuemembership").rows = table(b, "queuemembership").rows.filter((m) => m.queue !== "Sales – Outbound");

  const support = table(b, "msdyn_liveworkstream").rows.find((w) => w.msdyn_name === "Support – Voice")!;
  support.msdyn_capacityrequired = 40;

  const salesRoute = table(b, "msdyn_decisionruleset").rows.find((r) => r.msdyn_name === "Sales route")!;
  salesRoute.msdyn_rulesetdefinition = String(salesRoute.msdyn_rulesetdefinition).replace("nl-NL", "nl-BE");

  const otherNumber = (n: unknown) => String(n).replace(/(\d)$/, "9$1");
  table(b, "msdyn_ocphonenumber").rows.forEach((n) => { n.msdyn_phonenumber = otherNumber(n.msdyn_phonenumber); });
  table(b, "msdyn_ocvoicechannelsetting").rows.forEach((c) => {
    ["_msdyn_phonenumberid_value", "_msdyn_calleridphonenumberid_value"].forEach((k) => { if (c[`${k}${F}`]) c[`${k}${F}`] = otherNumber(c[`${k}${F}`]); });
  });
  return { a, b };
}
