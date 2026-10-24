// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { RawEnvironment, QUEUE_IDENTIFICATION } from "./graph";

// A made-up contact center in the same row shapes Dataverse returns, so the offline demo runs
// through the same graph builder as the live environment.

const guid = (prefix: string, n: number) => `${prefix.padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VOICE = 192440000, MESSAGING = 192390000, VOICE_QUEUE = 192350002, MESSAGING_QUEUE = 192350000;

const FIRST = ["Ava", "Liam", "Noor", "Daan", "Emma", "Sem", "Mila", "Lucas", "Saar", "Finn", "Julia", "Levi", "Tess", "Bram", "Zoë", "Milan", "Yara", "Jesse", "Lotte", "Ruben"];
const LAST = ["de Vries", "Jansen", "Bakker", "Visser", "Smit", "Meijer", "de Boer", "Mulder", "Bos", "Vos"];

interface DemoWorkstream { name: string; voice: boolean; numbers: number; rules: [string, string, string[]][] }

const WORKSTREAMS: DemoWorkstream[] = [
  { name: "Retail Sales – Voice", voice: true, numbers: 2, rules: [["New orders", "Sales", ["Sales"]], ["Order status", "Status", ["Order Desk"]], ["Large accounts", "Enterprise", ["Enterprise Sales", "Sales"]]] },
  { name: "Customer Service – Voice", voice: true, numbers: 3, rules: [["Billing", "Billing", ["Billing"]], ["Returns", "Returns", ["Returns"]], ["Technical", "Tech", ["Tier 1 Support"]], ["Complaints", "Complaint", ["Escalations"]]] },
  { name: "Technical Support – Voice", voice: true, numbers: 2, rules: [["Tier 1", "1", ["Tier 1 Support"]], ["Tier 2", "2", ["Tier 2 Support"]], ["Outage", "Outage", ["Tier 2 Support", "Escalations"]]] },
  { name: "Dutch Desk – Voice", voice: true, numbers: 1, rules: [["Nederlands", "NL", ["Dutch Desk"]]] },
  { name: "Web Chat", voice: false, numbers: 0, rules: [["Sales chat", "Sales", ["Chat Sales"]], ["Support chat", "Support", ["Chat Support"]]] },
  { name: "WhatsApp", voice: false, numbers: 0, rules: [["Any message", "Any", ["Chat Support"]]] }
];

const QUEUES: [string, boolean, string[]][] = [
  ["Sales", true, ["Sales", "English"]], ["Enterprise Sales", true, ["Sales", "Negotiation"]], ["Order Desk", true, ["Orders"]],
  ["Billing", true, ["Billing", "English"]], ["Returns", true, ["Orders", "Returns"]], ["Tier 1 Support", true, ["Technical"]],
  ["Tier 2 Support", true, ["Technical", "Networking"]], ["Escalations", true, ["Escalations", "Negotiation"]], ["Dutch Desk", true, ["Dutch"]],
  ["Chat Sales", false, ["Sales", "Writing"]], ["Chat Support", false, ["Technical", "Writing"]], ["Overflow", true, []]
];

function rulesetXml(rules: { id: string; name: string; value: string; queueIds: string[] }[]): string {
  const rule = (r: { id: string; name: string; value: string; queueIds: string[] }) => {
    const action = r.queueIds.length === 1
      ? `<setattribute><lhs type="attribute">assign_to.queue</lhs><rhs type="staticvalue">${r.queueIds[0]}</rhs></setattribute>`
      : `<upsertrecords><target>percentagebaseddistribution</target><records>${r.queueIds.map((q, i) =>
        `<record><setattribute><lhs>queuedetails.queueid</lhs><rhs>${q}</rhs></setattribute><setattribute><lhs>queuedetails.percentage</lhs><rhs>${i === 0 ? 70 : Math.round(30 / (r.queueIds.length - 1))}</rhs></setattribute></record>`).join("")}</records></upsertrecords>`;
    return `<rule id="${r.id}" name="${r.name}"><logical operator="AND"><condition operator="equals"><lhs type="attribute">liveworkitemcontext.SelectedMenuItem</lhs><rhs type="staticvalue">${r.value}</rhs></condition></logical><action>${action}</action></rule>`;
  };
  return `<decision hit-policy="first"><rules>${rules.map(rule).join("")}</rules></decision>`;
}

export function demoRaw(): RawEnvironment {
  const raw: RawEnvironment = {
    phoneNumbers: [], channels: [], workstreams: [], routingConfigurations: [], routingSteps: [], rulesets: [],
    queues: [], memberships: [], users: [], resources: [], resourceSkills: [], warnings: [], unread: []
  };
  const queueId = new Map(QUEUES.map(([name], i) => [name, guid("a1", i + 1)]));
  QUEUES.forEach(([name, voice]) => raw.queues.push({ queueid: queueId.get(name), name, msdyn_queuetype: voice ? VOICE_QUEUE : MESSAGING_QUEUE }));

  let numberIndex = 0;
  WORKSTREAMS.forEach((ws, w) => {
    const wsId = guid("b1", w + 1);
    raw.workstreams.push({ msdyn_liveworkstreamid: wsId, msdyn_name: ws.name, msdyn_streamsource: ws.voice ? VOICE : MESSAGING, _msdyn_defaultqueue_value: queueId.get("Overflow") });
    if (ws.voice) {
      const channelId = guid("c1", w + 1);
      raw.channels.push({ msdyn_ocvoicechannelsettingid: channelId, msdyn_name: ws.name.replace(" – Voice", " channel"), _msdyn_liveworkstreamid_value: wsId, _msdyn_phonenumberid_value: ws.numbers ? guid("d1", numberIndex + 1) : null });
      for (let n = 0; n < ws.numbers; n++) {
        numberIndex++;
        raw.phoneNumbers.push({ msdyn_ocphonenumberid: guid("d1", numberIndex), msdyn_phonenumber: `+31 20 555 ${String(1000 + numberIndex * 37).slice(-4)}`, statecode: 0, msdyn_phoneinboundenabled: true, msdyn_phoneoutboundenabled: n === 0 });
        // Extra numbers get a channel each, the way a second number on the same workstream would.
        if (n > 0) raw.channels.push({ msdyn_ocvoicechannelsettingid: guid("c2", numberIndex), msdyn_name: `${ws.name.replace(" – Voice", "")} line ${n + 1}`, _msdyn_liveworkstreamid_value: wsId, _msdyn_phonenumberid_value: guid("d1", numberIndex) });
      }
    }
    const configId = guid("e1", w + 1);
    const rulesetId = guid("f1", w + 1);
    raw.routingConfigurations.push({ msdyn_routingconfigurationid: configId, msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: wsId });
    raw.routingSteps.push({ msdyn_type: QUEUE_IDENTIFICATION, _msdyn_routingconfigurationid_value: configId, _msdyn_rulesetid_value: rulesetId });
    raw.rulesets.push({
      msdyn_decisionrulesetid: rulesetId, msdyn_name: `${ws.name} route to queue`,
      msdyn_rulesetdefinition: rulesetXml(ws.rules.map(([name, value, queues], r) => ({ id: `r${w}-${r}`, name, value, queueIds: queues.map((q) => queueId.get(q)!) })))
    });
  });

  const skillId = new Map<string, string>();
  [...new Set(QUEUES.flatMap(([, , skills]) => skills))].forEach((s, i) => skillId.set(s, guid("a2", i + 1)));
  let agent = 0;
  QUEUES.forEach(([name, , skills], q) => {
    const size = name === "Overflow" ? 3 : 4 + (q % 4);
    for (let i = 0; i < size; i++) {
      // Some agents also sit in the next queue, as real agents often do.
      const userId = guid("a3", ++agent);
      raw.users.push({ systemuserid: userId, fullname: `${FIRST[agent % FIRST.length]} ${LAST[(agent * 7) % LAST.length]}`, domainname: `agent${agent}@contoso.example`, isdisabled: false });
      raw.memberships.push({ queueid: queueId.get(name), systemuserid: userId });
      if (i === 0 && q + 1 < QUEUES.length) raw.memberships.push({ queueid: queueId.get(QUEUES[q + 1][0]), systemuserid: userId });
      const resourceId = guid("a4", agent);
      raw.resources.push({ bookableresourceid: resourceId, _userid_value: userId });
      skills.filter((_, s) => (i + s) % 3 !== 2).forEach((skill, s) =>
        raw.resourceSkills.push({ _resource_value: resourceId, Characteristic: { characteristicid: skillId.get(skill), name: skill }, RatingValue: { name: ["Beginner", "Intermediate", "Expert"][(i + s) % 3] } }));
    }
  });

  addProblems(raw, queueId);
  addMoreConfiguration(raw, queueId);
  return raw;
}

// The configuration around the call path: a bot, overflow, operating hours, context variables,
// capacity profiles, teams and business units.
function addMoreConfiguration(raw: RawEnvironment, queueId: Map<string, string>): void {
  const workstream = (name: string) => raw.workstreams.find((w) => w.msdyn_name === name)!;
  const voice = raw.workstreams.filter((w) => w.msdyn_streamsource === VOICE);

  // The customer service line is answered by an IVR bot first.
  const bot = guid("a5", 1);
  workstream("Customer Service – Voice")._msdyn_bot_user_value = bot;
  raw.botUsers = [{ systemuserid: bot, fullname: "Contoso Service IVR (Microsoft Copilot Studio)" }];

  // Context variables the IVR fills in.
  raw.variables = voice.flatMap((w, i) => [
    { msdyn_ocliveworkstreamcontextvariableid: guid("a6", i * 2 + 1), msdyn_name: "SelectedMenuItem", msdyn_datatype: 192350000, _msdyn_liveworkstreamid_value: w.msdyn_liveworkstreamid },
    { msdyn_ocliveworkstreamcontextvariableid: guid("a6", i * 2 + 2), msdyn_name: "CustomerLanguage", msdyn_datatype: 192350000, _msdyn_liveworkstreamid_value: w.msdyn_liveworkstreamid }
  ]);

  // Opening hours on the sales and billing queues, weekend hours on the Dutch desk.
  const businessHours = guid("a7", 1), weekend = guid("a7", 2);
  raw.operatingHours = [{ msdyn_operatinghourid: businessHours, msdyn_name: "Business hours" }, { msdyn_operatinghourid: weekend, msdyn_name: "Weekend desk" }];
  const queue = (name: string) => raw.queues.find((q) => q.name === name)!;
  ["Sales", "Billing", "Enterprise Sales"].forEach((n) => { queue(n)._msdyn_operatinghourid_value = businessHours; });
  queue("Dutch Desk")._msdyn_operatinghourid_value = weekend;

  // Overflow: voicemail after hours, a callback when the wait is long, and Tier 1 handing over to Tier 2.
  const voicemail = guid("a8", 1), callback = guid("a8", 2), toTier2 = guid("a8", 3);
  raw.overflowActions = [
    { msdyn_overflowactionconfigid: voicemail, msdyn_name: "Voicemail", msdyn_overflowactiontype: 192350004 },
    { msdyn_overflowactionconfigid: callback, msdyn_name: "Callback", msdyn_overflowactiontype: 192350003 },
    { msdyn_overflowactionconfigid: toTier2, msdyn_name: "QueueTransfer_Tier2", msdyn_overflowactiontype: 192350005, msdyn_overflowactiondata: queueId.get("Tier 2 Support") }
  ];
  const overflowXml = (rules: [string, string, string][]) => `<decision hit-policy="first"><rules>${rules.map(([ruleId, flag, action]) =>
    `<rule id="${ruleId}" name="${ruleId}"><action><setattribute><lhs>overflow.${flag}overflow</lhs><rhs>true</rhs></setattribute><setattribute><lhs>overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs><rhs>${action}</rhs></setattribute></action></rule>`).join("")}</rules></decision>`;
  raw.overflowRulesets = [
    { msdyn_decisionrulesetid: guid("a9", 1), msdyn_rulesetdefinition: overflowXml([["o1", "operatinghour", voicemail], ["o2", "estimatedwaittime", callback]]) },
    { msdyn_decisionrulesetid: guid("a9", 2), msdyn_rulesetdefinition: overflowXml([["o3", "operatinghour", voicemail]]) },
    { msdyn_decisionrulesetid: guid("a9", 3), msdyn_rulesetdefinition: overflowXml([["o4", "lapsedwaittime", toTier2]]) }
  ];
  queue("Sales")._msdyn_prequeueoverflowrulesetid_value = guid("a9", 1);
  queue("Billing")._msdyn_prequeueoverflowrulesetid_value = guid("a9", 2);
  queue("Tier 1 Support")._msdyn_inqueueoverflowrulesetid_value = guid("a9", 3);

  // Capacity profiles for voice and messaging, on the workstreams and on every agent.
  const voiceProfile = guid("aa", 1), messagingProfile = guid("aa", 2);
  raw.capacityProfiles = [{ msdyn_capacityprofileid: voiceProfile, msdyn_name: "Default voice inbound" }, { msdyn_capacityprofileid: messagingProfile, msdyn_name: "Default messaging" }];
  raw.workstreamCapacity = raw.workstreams.map((w) => ({ _msdyn_workstream_id_value: w.msdyn_liveworkstreamid, _msdyn_capacityprofile_id_value: w.msdyn_streamsource === VOICE ? voiceProfile : messagingProfile }));
  raw.resourceCapacity = raw.resources.flatMap((r, i) => [
    { _msdyn_bookableresourceid_value: r.bookableresourceid, _msdyn_capacityprofileid_value: voiceProfile },
    ...(i % 3 === 0 ? [{ _msdyn_bookableresourceid_value: r.bookableresourceid, _msdyn_capacityprofileid_value: messagingProfile }] : [])
  ]);

  // Business units and teams.
  const units = [guid("ab", 1), guid("ab", 2), guid("ab", 3)];
  raw.businessUnits = [{ businessunitid: units[0], name: "Contoso" }, { businessunitid: units[1], name: "Contoso Sales" }, { businessunitid: units[2], name: "Contoso Support" }];
  raw.users.forEach((u, i) => { u._businessunitid_value = units[i < 18 ? 1 : i < 50 ? 2 : 0]; });
  raw.teams = [
    { teamid: guid("ac", 1), name: "Contoso", isdefault: true },
    { teamid: guid("ac", 2), name: "Evening shift", isdefault: false },
    { teamid: guid("ac", 3), name: "Escalation team", isdefault: false }
  ];
  raw.teamMemberships = raw.users.flatMap((u, i) => [
    { systemuserid: u.systemuserid, teamid: guid("ac", 1) },
    ...(i % 4 === 0 ? [{ systemuserid: u.systemuserid, teamid: guid("ac", 2) }] : []),
    ...(i % 7 === 3 ? [{ systemuserid: u.systemuserid, teamid: guid("ac", 3) }] : [])
  ]);
}

// A few things that are wrong, so the health overlay has something to show.
function addProblems(raw: RawEnvironment, queueId: Map<string, string>): void {
  // A queue nobody routes to and nobody is in.
  raw.queues.push({ queueid: guid("a1", 90), name: "Social Media", msdyn_queuetype: MESSAGING_QUEUE });
  // A voice workstream still being set up: its channel has no number, one rule routes to an empty
  // queue and one to a queue that was deleted.
  const partnerDesk = guid("a1", 91);
  raw.queues.push({ queueid: partnerDesk, name: "Partner Desk", msdyn_queuetype: VOICE_QUEUE });
  const wsId = guid("b1", 90), configId = guid("e1", 90), rulesetId = guid("f1", 90);
  raw.workstreams.push({ msdyn_liveworkstreamid: wsId, msdyn_name: "Partner Line – Voice", msdyn_streamsource: VOICE, _msdyn_defaultqueue_value: queueId.get("Overflow") });
  raw.channels.push({ msdyn_ocvoicechannelsettingid: guid("c1", 90), msdyn_name: "Partner Line channel", _msdyn_liveworkstreamid_value: wsId, _msdyn_phonenumberid_value: null });
  raw.routingConfigurations.push({ msdyn_routingconfigurationid: configId, msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: wsId });
  raw.routingSteps.push({ msdyn_type: QUEUE_IDENTIFICATION, _msdyn_routingconfigurationid_value: configId, _msdyn_rulesetid_value: rulesetId });
  raw.rulesets.push({
    msdyn_decisionrulesetid: rulesetId, msdyn_name: "Partner Line route to queue",
    msdyn_rulesetdefinition: rulesetXml([
      { id: "p1", name: "Partners", value: "Partner", queueIds: [partnerDesk] },
      { id: "p2", name: "Resellers", value: "Reseller", queueIds: [guid("a1", 99)] }
    ])
  });
  // A workstream with no routing at all, and a number nothing uses.
  raw.workstreams.push({ msdyn_liveworkstreamid: guid("b1", 91), msdyn_name: "Legacy Email", msdyn_streamsource: 192350000, _msdyn_defaultqueue_value: null });
  raw.phoneNumbers.push({ msdyn_ocphonenumberid: guid("d1", 90), msdyn_phonenumber: "+31 20 555 9999", statecode: 0, msdyn_phoneinboundenabled: true, msdyn_phoneoutboundenabled: false });
  // A disabled agent still in a queue, and an agent without a bookable resource.
  raw.users[3].isdisabled = true;
  raw.resources.splice(7, 1);
}
