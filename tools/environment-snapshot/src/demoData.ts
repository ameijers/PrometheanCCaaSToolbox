// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { AttributeMeta, Row, SnapshotSource, SourceError, TableMeta } from "./model";
import { TABLE_LABELS } from "./tables";

// A sample environment for the demo and the tests: a small, fictional contact center with voice, chat,
// an outbound profile and a records workstream, queues with built-in and custom assignment, overflow,
// agents with skills, capacity and roles. Rows look like Dataverse's: lookups as `_<name>_value` and
// readable labels as FormattedValue annotations. Its table definitions are worked out from the rows.
// It also has a secret (a workstream API key, which must never reach a snapshot), a table that isn't
// installed and one the user may not read.

const F = "@OData.Community.Display.V1.FormattedValue";
const guid = (group: string, n: number) => `00000000-0000-4000-${group}-${String(n).padStart(12, "0")}`;

const lookup = (column: string, id: string | undefined, name: string): Row => id ? { [`_${column}_value`]: id, [`_${column}_value${F}`]: name } : {};
const choice = (column: string, value: number | boolean | string, label: string): Row => ({ [column]: value, [`${column}${F}`]: label });
const active = (on = true): Row => ({ ...choice("statecode", on ? 0 : 1, on ? "Active" : "Inactive") });

const W = (n: number) => guid("a100", n), Q = (n: number) => guid("a200", n), U = (n: number) => guid("a300", n), RS = (n: number) => guid("a400", n);
const NUM = (n: number) => guid("a500", n), CH = (n: number) => guid("a600", n), CP = (n: number) => guid("a700", n), SK = (n: number) => guid("a800", n);
const BR = (n: number) => guid("a900", n), T = (n: number) => guid("aa00", n), BU = (n: number) => guid("ab00", n), RV = (n: number) => guid("ac00", n);
const OH = guid("ad00", 1), RM = guid("ae00", 1), RC = (n: number) => guid("af00", n), OA = (n: number) => guid("b000", n), AC = (n: number) => guid("b100", n), ROLE = (n: number) => guid("b200", n);

const QUEUES: [number, string, string, number, string][] = [
  [1, "Sales – NL", "Voice", 192350002, "Custom assignment"],
  [2, "Sales – EN", "Voice", 192350003, "Least active"],
  [3, "Sales – Outbound", "Voice", 192350003, "Least active"],
  [4, "Support – Voice", "Voice", 192350000, "Highest capacity"],
  [5, "Support – Chat", "Messaging", 192350001, "Advanced round robin"],
  [6, "Voicemail – Group", "Records", 192350000, "Highest capacity"]
];
const queueName = (n: number) => QUEUES.find((q) => q[0] === n)![1];

const USERS: [number, string, string, number][] = [
  [1, "Ava Jansen", "ava.jansen@contoso.example", 1], [2, "Liam de Vries", "liam.devries@contoso.example", 1], [3, "Noah Smith", "noah.smith@contoso.example", 2],
  [4, "Emma Brown", "emma.brown@contoso.example", 2], [5, "Mila Peters", "mila.peters@contoso.example", 2]
];
const userName = (n: number) => n === 9 ? "Contoso IVR bot" : USERS.find((u) => u[0] === n)![1];

const rule = (id: string, name: string, body: string) => `<rule id="${id}" name="${name}">${body}</rule>`;
const decision = (hit: "first" | "all", ...rules: string[]) => `<decision hit-policy="${hit}" version="1"><rules>${rules.join("")}</rules></decision>`;
const condition = (operator: string, lhs: string, rhs: string, type = "staticvalue") => `<condition operator="${operator}"><lhs type="attribute">${lhs}</lhs><rhs type="${type}">${rhs}</rhs></condition>`;
const setAttribute = (lhs: string, rhs: string) => `<setattribute><lhs>${lhs}</lhs><rhs>${rhs}</rhs></setattribute>`;
const ctx = (name: string) => `liveworkitemcontext.${W(1)}.${name}`;

const RULESETS: [number, string, string][] = [
  [1, "Classify VIP callers", decision("first",
    rule(guid("c000", 1), "VIP callers get top priority", `<logical operator="AND">${condition("==", ctx("IsVip"), "true")}</logical><action>${setAttribute("msdyn_ocliveworkitem.msdyn_priority", "1")}</action>`))],
  [2, "Sales route", decision("first",
    rule(guid("c000", 2), "Dutch callers", `<logical operator="AND">${condition("==", ctx("CustomerLanguage"), "nl-NL")}</logical><action>${setAttribute("assign_to.queue", Q(1))}</action>`),
    rule(guid("c000", 3), "Everyone else", `<logical operator="AND" /><action>${setAttribute("assign_to.queue", Q(2))}</action>`))],
  [3, "Support route", decision("first",
    rule(guid("c000", 4), "All calls to support", `<logical operator="AND" /><action>${setAttribute("assign_to.queue", Q(4))}</action>`))],
  [4, "Chat route", decision("first",
    rule(guid("c000", 5), "All chats", `<logical operator="AND" /><action>${setAttribute("assign_to.queue", Q(5))}</action>`))],
  [5, "Support – Voice overflow", decision("first",
    rule(guid("c000", 6), "Long wait: offer a callback", `<logical operator="AND">${condition(">", "msdyn_ocliveworkitem.msdyn_queueestimatedwaittime", "10")}</logical><action>${setAttribute("overflow.waittimeoverflow", "true")}${setAttribute("overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid", OA(1))}</action>`))],
  [6, "Skills first – prioritization", decision("first",
    rule(guid("c000", 7), "Identified customers first", `<logical operator="AND">${condition("==", ctx("IsVip"), "true")}</logical><action><orderby type="attribute" descending="false">msdyn_ocliveworkitem.createdon</orderby></action>`))],
  [7, "Skills first – assignment", decision("first",
    rule(guid("c000", 8), "Exact skill match", `<logical operator="AND">${condition("exact_match", "agent.bookableresourcecharacteristic", "msdyn_ocliveworkitemcharacteristic", "attribute")}</logical><action><orderby type="attribute" descending="false">agent.lastSessionAssignedOn</orderby></action>`),
    rule(guid("c000", 9), "Closest skill match", `<logical operator="AND">${condition("contains", "agent.languages", "msdyn_ocliveworkitem.msdyn_languageid_msdyn_ocliveworkitem.msdyn_languageid", "attribute")}</logical><action><orderby type="skill_match_count" descending="true"><parameters><parameter type="attribute">agent.bookableresourcecharacteristic</parameter></parameters></orderby></action>`))]
];
const rulesetName = (n: number) => RULESETS.find((r) => r[0] === n)![1];

const WORKSTREAMS: Row[] = [
  {
    msdyn_liveworkstreamid: W(1), msdyn_name: "Sales – Voice", ...active(), ...choice("msdyn_streamsource", 192440000, "Voice call"), ...choice("msdyn_direction", 0, "Inbound"),
    ...choice("msdyn_mode", 717210001, "Simplified"), ...choice("msdyn_workdistributionmode", 192350000, "Push"), ...choice("msdyn_capacityformat", 192360000, "Profile"),
    msdyn_capacityrequired: 30, ...choice("msdyn_allowedpresences", "192360000,192360001", "Available; Busy"), msdyn_autocloseafterinactivity: 5,
    ...choice("msdyn_notification", 100000001, "Screen pop with timeout"), ...lookup("msdyn_defaultqueue", Q(2), "Sales – EN"), ...lookup("msdyn_bot_user", U(9), "Contoso IVR bot"),
    msdyn_apikey: "SAMPLE-SECRET-KEY-DO-NOT-EXPORT", ...choice("createdon", "2026-09-30T10:00:00Z", "9/30/2026 12:00 PM")
  },
  {
    msdyn_liveworkstreamid: W(2), msdyn_name: "Support – Voice", ...active(), ...choice("msdyn_streamsource", 192440000, "Voice call"), ...choice("msdyn_direction", 0, "Inbound"),
    ...choice("msdyn_mode", 717210001, "Simplified"), ...choice("msdyn_workdistributionmode", 192350000, "Push"), ...choice("msdyn_capacityformat", 192360000, "Profile"),
    msdyn_capacityrequired: 30, ...choice("msdyn_allowedpresences", "192360000", "Available"), msdyn_autocloseafterinactivity: 5, ...choice("msdyn_notification", 100000001, "Screen pop with timeout"),
    ...lookup("msdyn_defaultqueue", Q(4), "Support – Voice")
  },
  {
    msdyn_liveworkstreamid: W(3), msdyn_name: "Support – Chat", ...active(), ...choice("msdyn_streamsource", 192360000, "Live chat"), ...choice("msdyn_direction", 0, "Inbound"),
    ...choice("msdyn_workdistributionmode", 192350000, "Push"), ...choice("msdyn_capacityformat", 192350000, "Unit based"), msdyn_capacityrequired: 50, msdyn_autocloseafterinactivity: 15,
    ...lookup("msdyn_defaultqueue", Q(5), "Support – Chat")
  },
  {
    msdyn_liveworkstreamid: W(4), msdyn_name: "Sales – Outbound Profile", ...active(), ...choice("msdyn_streamsource", 192440000, "Voice call"), ...choice("msdyn_direction", 1, "Outbound"),
    ...choice("msdyn_workdistributionmode", 192350000, "Push"), ...lookup("msdyn_outboundqueueid", Q(3), "Sales – Outbound")
  },
  {
    msdyn_liveworkstreamid: W(5), msdyn_name: "Case routing", ...active(), ...choice("msdyn_streamsource", 192350000, "Entity records"), ...choice("msdyn_direction", 0, "Inbound"),
    ...choice("msdyn_workdistributionmode", 192350001, "Pick"), msdyn_capacityrequired: 10
  }
];

const ROUTING_CONFIGS: [number, number][] = [[1, 1], [2, 2], [3, 3]];
const ROUTING_STEPS: [number, number, number, string, number, number][] = [
  // step, config, type, name, order, ruleset
  [1, 1, 192350000, "Classify", 1, 1],
  [2, 1, 192350002, "Route to queue", 2, 2],
  [3, 2, 192350002, "Route to queue", 1, 3],
  [4, 3, 192350002, "Route to queue", 1, 4]
];
const STEP_TYPES: Record<number, string> = { 192350000: "Enrichment", 192350002: "Queue identification", 192350001: "Assignment rule selection" };

const TABLE_ROWS: Record<string, Row[]> = {
  msdyn_ocphonenumber: [0, 1, 2, 3, 4].map((n) => ({
    msdyn_ocphonenumberid: NUM(n), msdyn_phonenumber: `+1555010${n}`, ...active(n !== 4),
    ...choice("msdyn_phoneinboundenabled", n !== 3, n !== 3 ? "Yes" : "No"), ...choice("msdyn_phoneoutboundenabled", n === 3, n === 3 ? "Yes" : "No"), ...choice("msdyn_carriertype", 1, "Azure Communication Services")
  })),
  msdyn_ocvoicechannelsetting: [
    { msdyn_ocvoicechannelsettingid: CH(1), msdyn_name: "Sales – Main line", ...active(), ...lookup("msdyn_liveworkstreamid", W(1), "Sales – Voice"), ...lookup("msdyn_phonenumberid", NUM(0), "+15550100"), ...lookup("msdyn_operatinghoursid", OH, "Office hours"), ...choice("msdyn_transcriptionenabled", true, "Yes"), ...choice("msdyn_recordingenabled", true, "Yes") },
    { msdyn_ocvoicechannelsettingid: CH(2), msdyn_name: "Sales – Dutch line", ...active(), ...lookup("msdyn_liveworkstreamid", W(1), "Sales – Voice"), ...lookup("msdyn_phonenumberid", NUM(1), "+15550101"), ...choice("msdyn_transcriptionenabled", true, "Yes"), ...choice("msdyn_recordingenabled", false, "No") },
    { msdyn_ocvoicechannelsettingid: CH(3), msdyn_name: "Support line", ...active(), ...lookup("msdyn_liveworkstreamid", W(2), "Support – Voice"), ...lookup("msdyn_phonenumberid", NUM(2), "+15550102"), ...choice("msdyn_transcriptionenabled", false, "No"), ...choice("msdyn_recordingenabled", false, "No") },
    { msdyn_ocvoicechannelsettingid: CH(4), msdyn_name: "Sales – Outbound caller ID", ...active(), ...lookup("msdyn_liveworkstreamid", W(4), "Sales – Outbound Profile"), ...lookup("msdyn_calleridphonenumberid", NUM(3), "+15550103") }
  ],
  msdyn_ocvoicechannellanguagesetting: [
    [1, 1, "English (United States)", "en-US-AvaMultilingualNeural"], [2, 2, "Dutch (Netherlands)", "nl-NL-ColetteNeural"], [3, 3, "English (United States)", "en-US-AndrewNeural"]
  ].map(([n, ch, language, voice]) => ({
    msdyn_ocvoicechannellanguagesettingid: guid("b300", n as number), msdyn_name: `${language}`, ...lookup("msdyn_ocvoicechannelsettingid", CH(ch as number), ""), ...lookup("msdyn_languageid", guid("b400", n as number), language as string),
    ...lookup("msdyn_ocvoiceid", guid("b500", n as number), voice as string), ...lookup("msdyn_holdmusicid", guid("b600", 1), "Transform"), ...choice("msdyn_isprimary", true, "Yes")
  })),
  msdyn_ocvoice: [1, 2, 3].map((n) => ({ msdyn_ocvoiceid: guid("b500", n), msdyn_voicename: ["en-US-AvaMultilingualNeural", "nl-NL-ColetteNeural", "en-US-AndrewNeural"][n - 1], msdyn_name: `Voice ${n}`, ...choice("msdyn_voicestyle", 1, "Default") })),
  msdyn_ocphonemusic: [{ msdyn_ocphonemusicid: guid("b600", 1), msdyn_name: "Transform" }, { msdyn_ocphonemusicid: guid("b600", 2), msdyn_name: "Calm piano" }],
  msdyn_livechatconfig: [{ msdyn_livechatconfigid: guid("b700", 1), msdyn_name: "Support chat widget", ...active(), ...lookup("msdyn_liveworkstreamid", W(3), "Support – Chat"), ...choice("msdyn_widgetposition", 1, "Bottom right") }],

  msdyn_liveworkstream: WORKSTREAMS,
  msdyn_ocliveworkstreamcontextvariable: [
    { msdyn_ocliveworkstreamcontextvariableid: guid("b800", 1), msdyn_name: "CustomerLanguage", msdyn_displayname: "Customer language", ...choice("msdyn_datatype", 192350000, "Text"), ...lookup("msdyn_liveworkstreamid", W(1), "Sales – Voice") },
    { msdyn_ocliveworkstreamcontextvariableid: guid("b800", 2), msdyn_name: "IsVip", msdyn_displayname: "VIP customer", ...choice("msdyn_datatype", 192350002, "True or false"), ...lookup("msdyn_liveworkstreamid", W(1), "Sales – Voice") }
  ],
  msdyn_liveworkstreamcapacityprofile: [[1, 1, 1], [2, 2, 1], [3, 3, 2]].map(([n, w, c]) => ({
    msdyn_liveworkstreamcapacityprofileid: guid("b900", n), msdyn_name: `link ${n}`, ...lookup("msdyn_workstream_id", W(w), WORKSTREAMS[w - 1].msdyn_name), ...lookup("msdyn_capacityprofile_id", CP(c), c === 1 ? "Default voice inbound" : "Chat")
  })),
  msdyn_masterentityroutingconfiguration: [
    { msdyn_masterentityroutingconfigurationid: guid("ba00", 1), msdyn_name: "Voicemail", msdyn_entitylogicalname: "msdyn_ocvoicemail", ...active() },
    { msdyn_masterentityroutingconfigurationid: guid("ba00", 2), msdyn_name: "Case", msdyn_entitylogicalname: "incident", ...active() }
  ],

  msdyn_routingconfiguration: ROUTING_CONFIGS.map(([n, w]) => ({
    msdyn_routingconfigurationid: RC(n), msdyn_name: `RC – ${WORKSTREAMS[w - 1].msdyn_name}`, ...choice("msdyn_isactiveconfiguration", true, "Yes"), ...lookup("msdyn_liveworkstreamid", W(w), WORKSTREAMS[w - 1].msdyn_name)
  })),
  msdyn_routingconfigurationstep: ROUTING_STEPS.map(([n, c, type, name, order, rs]) => ({
    msdyn_routingconfigurationstepid: guid("bb00", n), msdyn_name: name, ...choice("msdyn_type", type, STEP_TYPES[type]), msdyn_steporder: order,
    ...lookup("msdyn_routingconfigurationid", RC(c), `RC ${c}`), ...lookup("msdyn_rulesetid", RS(rs), rulesetName(rs))
  })),
  msdyn_decisionruleset: RULESETS.map(([n, name, definition]) => ({
    msdyn_decisionrulesetid: RS(n), msdyn_name: name, msdyn_rulesetdefinition: definition, ...choice("msdyn_rulesettype", 192350000, "Declarative"), ...choice("msdyn_authoringmode", 192350000, "Decision list"), ...active()
  })),
  msdyn_overflowactionconfig: [{ msdyn_overflowactionconfigid: OA(1), msdyn_name: "Offer a callback", ...choice("msdyn_overflowactiontype", 192350002, "Direct Callback") }],

  queue: QUEUES.map(([n, name, type, strategy, strategyLabel]) => ({
    queueid: Q(n), name, ...active(), msdyn_isomnichannelqueue: true, ...choice("msdyn_queuetype", { Voice: 192350002, Messaging: 192350000, Records: 192350001 }[type]!, type),
    ...choice("msdyn_assignmentstrategy", strategy, strategyLabel), msdyn_priority: n === 1 ? 1 : 10,
    ...(n === 2 ? lookup("msdyn_operatinghourid", OH, "Office hours") : {}), ...(n === 4 ? lookup("msdyn_prequeueoverflowrulesetid", RS(5), rulesetName(5)) : {})
  })),
  msdyn_assignmentconfiguration: [{ msdyn_assignmentconfigurationid: AC(1), msdyn_name: "Skills first", ...choice("msdyn_isactiveconfiguration", true, "Yes"), ...lookup("msdyn_queueid", Q(1), "Sales – NL") }],
  msdyn_assignmentconfigurationstep: [[1, 192350000, "Prioritization", 1, 6], [2, 192350002, "Assignment", 2, 7]].map(([n, type, name, order, rs]) => ({
    msdyn_assignmentconfigurationstepid: guid("bc00", n as number), msdyn_name: name, ...choice("msdyn_type", type as number, type === 192350000 ? "Prioritization" : "Assignment"), msdyn_steporder: order,
    ...lookup("msdyn_assignmentconfigurationid", AC(1), "Skills first"), ...lookup("msdyn_rulesetid", RS(rs as number), rulesetName(rs as number))
  })),
  msdyn_operatinghour: [{ msdyn_operatinghourid: OH, msdyn_name: "Office hours", msdyn_description: "Monday to Friday, 08:00–18:00 (Amsterdam)" }],

  bookableresource: [1, 2, 3, 4].map((n) => ({ bookableresourceid: BR(n), name: userName(n), ...lookup("userid", U(n), userName(n)), ...choice("resourcetype", 3, "User") })),
  bookableresourcecharacteristic: [[1, 1, 1, 5], [2, 1, 2, 4], [3, 2, 1, 3], [4, 3, 2, 5], [5, 3, 3, 4], [6, 4, 3, 2]].map(([n, r, s, v]) => ({
    bookableresourcecharacteristicid: guid("bd00", n), ...lookup("resource", BR(r), userName(r)), ...lookup("characteristic", SK(s), ["Dutch", "English", "Billing"][s - 1]),
    ...lookup("ratingvalue", RV(v), ["Basic", "Fair", "Good", "Very good", "Expert"][v - 1])
  })),
  msdyn_bookableresourcecapacityprofile: [[1, 1, 1], [2, 2, 1], [3, 3, 1], [4, 4, 2]].map(([n, r, c]) => ({
    msdyn_bookableresourcecapacityprofileid: guid("be00", n), ...lookup("msdyn_bookableresourceid", BR(r), userName(r)), ...lookup("msdyn_capacityprofileid", CP(c), c === 1 ? "Default voice inbound" : "Chat")
  })),
  characteristic: [1, 2, 3].map((n) => ({ characteristicid: SK(n), name: ["Dutch", "English", "Billing"][n - 1], ...choice("characteristictype", n < 3 ? 2 : 1, n < 3 ? "Language" : "Skill") })),
  ratingmodel: [{ ratingmodelid: RM, name: "Proficiency", minratingvalue: 1, maxratingvalue: 5 }],
  ratingvalue: [1, 2, 3, 4, 5].map((n) => ({ ratingvalueid: RV(n), name: ["Basic", "Fair", "Good", "Very good", "Expert"][n - 1], value: n, ...lookup("ratingmodel", RM, "Proficiency") })),
  msdyn_capacityprofile: [{ msdyn_capacityprofileid: CP(1), msdyn_name: "Default voice inbound", msdyn_defaultmaxunits: 1 }, { msdyn_capacityprofileid: CP(2), msdyn_name: "Chat", msdyn_defaultmaxunits: 3 }],
  team: [
    { teamid: T(1), name: "Contoso", isdefault: true, ...choice("teamtype", 0, "Owner"), ...lookup("businessunitid", BU(1), "Contoso") },
    { teamid: T(2), name: "Sales team", isdefault: false, ...choice("teamtype", 0, "Owner"), ...lookup("businessunitid", BU(1), "Contoso") },
    { teamid: T(3), name: "Support team", isdefault: false, ...choice("teamtype", 0, "Owner"), ...lookup("businessunitid", BU(2), "Contoso Support") }
  ],
  businessunit: [{ businessunitid: BU(1), name: "Contoso" }, { businessunitid: BU(2), name: "Contoso Support", ...lookup("parentbusinessunitid", BU(1), "Contoso") }],

  msdyn_presence: [["Available", "Available"], ["Busy", "Busy"], ["Do not disturb", "Busy - DND"], ["Away", "Away"], ["Offline", "Offline"]].map(([name, base], i) => ({
    msdyn_presenceid: guid("bf00", i + 1), msdyn_name: name, ...choice("msdyn_basepresencestatus", 192360000 + i, base), ...active()
  })),
  msdyn_sessiontemplate: [{ msdyn_sessiontemplateid: guid("c100", 1), msdyn_name: "Voice call – default session", msdyn_uniquename: "msdyn_voice_session" }, { msdyn_sessiontemplateid: guid("c100", 2), msdyn_name: "Chat – default session", msdyn_uniquename: "msdyn_chat_session" }],
  msdyn_notificationtemplate: [{ msdyn_notificationtemplateid: guid("c200", 1), msdyn_name: "Incoming call", msdyn_timeout: 120 }, { msdyn_notificationtemplateid: guid("c200", 2), msdyn_name: "Incoming chat", msdyn_timeout: 60 }],
  msdyn_appconfiguration: [{ msdyn_appconfigurationid: guid("c300", 1), msdyn_name: "Contoso agents", msdyn_uniquename: "contoso_agents" }],
  msdyn_ocsystemmessage: [["Average wait time", "Your estimated wait time is {AverageWaitTime} minutes."], ["Agent joined", "You are now connected to {Agent}."], ["Voicemail", "Please leave a message after the tone."]].map(([name, message], i) => ({
    msdyn_ocsystemmessageid: guid("c400", i + 1), msdyn_name: name, msdyn_defaultmessage: message, ...choice("msdyn_streamsource", 192440000, "Voice call")
  })),
  msdyn_omnichannelconfiguration: [{ msdyn_omnichannelconfigurationid: guid("c500", 1), msdyn_name: "Omnichannel configuration", ...choice("msdyn_enableagentaffinity", false, "No") }]
};

const USER_ROWS: Row[] = [
  ...USERS.map(([n, name, domain, bu]) => ({
    systemuserid: U(n), fullname: name, domainname: domain, internalemailaddress: domain, ...lookup("businessunitid", BU(bu), bu === 1 ? "Contoso" : "Contoso Support"),
    ...choice("isdisabled", false, "No"), ...choice("accessmode", 0, "Read-Write"), title: n === 1 ? "Team lead" : "Agent", address1_telephone1: "+15550199"
  })),
  { systemuserid: U(9), fullname: "Contoso IVR bot", domainname: "ivrbot@contoso.example", ...lookup("businessunitid", BU(1), "Contoso"), ...choice("isdisabled", false, "No"), ...choice("accessmode", 4, "Non-interactive") }
];

const MEMBERS: [number, number][] = [[1, 1], [1, 2], [2, 2], [2, 3], [4, 3], [4, 4], [5, 4], [5, 5], [6, 1]];
const INTERSECTS: Record<string, Row[]> = {
  queuemembership: MEMBERS.map(([q, u]) => ({ queueid: Q(q), systemuserid: U(u) })),
  teammembership: [[2, 1], [2, 2], [3, 3], [3, 4], [3, 5], [1, 1], [1, 2]].map(([t, u]) => ({ teamid: T(t), systemuserid: U(u) })),
  systemuserroles: [[1, 1], [1, 2], [2, 1], [3, 1], [4, 1], [5, 1]].map(([u, r]) => ({ systemuserid: U(u), roleid: ROLE(r) })),
  role: [{ roleid: ROLE(1), name: "Omnichannel agent", ...lookup("businessunitid", BU(1), "Contoso") }, { roleid: ROLE(2), name: "Omnichannel supervisor", ...lookup("businessunitid", BU(1), "Contoso") }],
  systemuser: USER_ROWS
};

// Tables that aren't installed in the sample, and one the sample user may not read.
const NOT_INSTALLED = new Set(["msdyn_ocwhatsappchannelnumber", "msdyn_ocfbpage", "msdyn_productivityagentscript"]);
const NO_PERMISSION = new Set(["msdyn_personasecurityrolemapping"]);

const LABELS: Record<string, string> = {
  msdyn_name: "Name", name: "Name", fullname: "Full Name", statecode: "Status", msdyn_streamsource: "Channel", msdyn_direction: "Direction", msdyn_mode: "Mode",
  msdyn_workdistributionmode: "Work distribution mode", msdyn_capacityformat: "Capacity format", msdyn_capacityrequired: "Capacity", msdyn_allowedpresences: "Allowed presences",
  msdyn_autocloseafterinactivity: "Auto-close after inactivity", msdyn_notification: "Notification", msdyn_defaultqueue: "Fallback queue", msdyn_bot_user: "Bot",
  msdyn_outboundqueueid: "Outbound queue", msdyn_phonenumberid: "Phone number", msdyn_calleridphonenumberid: "Caller ID number", msdyn_operatinghoursid: "Operating hours",
  msdyn_operatinghourid: "Operating hours", msdyn_transcriptionenabled: "Transcription", msdyn_recordingenabled: "Recording", msdyn_queuetype: "Type",
  msdyn_assignmentstrategy: "Assignment method", msdyn_priority: "Priority", msdyn_phonenumber: "Phone number", msdyn_phoneinboundenabled: "Inbound calling",
  msdyn_phoneoutboundenabled: "Outbound calling", domainname: "User Name", businessunitid: "Business Unit", isdisabled: "Status (disabled)", title: "Title",
  msdyn_rulesetdefinition: "Ruleset definition", msdyn_datatype: "Data type", msdyn_displayname: "Display name", msdyn_liveworkstreamid: "Workstream",
  msdyn_rulesetid: "Ruleset", msdyn_type: "Type", msdyn_steporder: "Step order", createdon: "Created On"
};

function attribute(logicalName: string, row: Row): AttributeMeta {
  const value = row[logicalName.startsWith("_") ? logicalName : logicalName];
  const isLookup = /^_.*_value$/.test(logicalName);
  const name = isLookup ? logicalName.slice(1, -6) : logicalName;
  const type = isLookup ? "Lookup" : logicalName === "statecode" ? "State" : typeof value === "boolean" ? "Boolean" : typeof value === "number" ? (row[`${logicalName}${F}`] ? "Picklist" : "Integer") : logicalName === "createdon" ? "DateTime" : "String";
  return { logicalName: name, label: LABELS[name] ?? name.replace(/^msdyn_/, "").replace(/_/g, " "), type, readable: true, typeName: logicalName === "msdyn_allowedpresences" ? "MultiSelectPicklistType" : undefined };
}

function describeFrom(logicalName: string, rows: Row[]): TableMeta {
  const keys = new Set<string>();
  rows.forEach((r) => Object.keys(r).filter((k) => !k.includes("@")).forEach((k) => keys.add(k)));
  const primaryId = `${logicalName}id`;
  keys.add(primaryId);
  const primaryName = ["msdyn_name", "name", "fullname", "msdyn_phonenumber"].find((k) => keys.has(k)) ?? "msdyn_name";
  keys.add(primaryName);
  const attributes = [...keys].map((k) => attribute(k, rows.find((r) => k in r) ?? {}));
  if (logicalName === "msdyn_liveworkstream") attributes.push({ logicalName: "msdyn_secureapikey", label: "Secure API key", type: "String", readable: true });
  attributes.push({ logicalName: "versionnumber", type: "BigInt", readable: true }, { logicalName: "createdbyname", type: "String", attributeOf: "createdby", readable: true });
  return { logicalName, label: TABLE_LABELS[logicalName] ?? logicalName, primaryId, primaryName, attributes };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

export const demoSource: SnapshotSource = {
  mode: "demo",
  environment: () => "sample environment",
  user: () => "Sample user",
  async describe(logicalName) {
    await pause();
    if (NOT_INSTALLED.has(logicalName)) return null;
    return describeFrom(logicalName, TABLE_ROWS[logicalName] ?? INTERSECTS[logicalName] ?? []);
  },
  async rows(logicalName, filter) {
    if (NO_PERMISSION.has(logicalName)) throw new SourceError("noPermission", "The sample user has no read access to this table.");
    const rows = TABLE_ROWS[logicalName] ?? [];
    return JSON.parse(JSON.stringify(filter === "msdyn_isomnichannelqueue eq true" ? rows.filter((r) => r.msdyn_isomnichannelqueue === true) : rows));
  },
  async rowsByIds(logicalName, idColumn, ids, select) {
    const wanted = new Set(ids.map((id) => id.toLowerCase()));
    const rows = (INTERSECTS[logicalName] ?? TABLE_ROWS[logicalName] ?? []).filter((r) => wanted.has(String(r[idColumn] ?? "").toLowerCase()));
    return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => select.some((s) => k === s || k.startsWith(`${s}@`)))));
  }
};
