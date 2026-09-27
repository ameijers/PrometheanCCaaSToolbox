import { AccessFailure, DataSource, DescribeResult, ReadRequest, ReadResult } from "./dataSource";

// A hand-authored sample environment ("Contoso Contact Center"), served through the same DataSource
// interface as live Dataverse — so demo mode runs the real scan, relationship discovery and analysis.
// It deliberately mixes clean, in-use records with at least one example of every check: structural
// orphans, functional dead-ends (including the two worked examples from the brief: a voice
// workstream with no phone number, and an unused queue), broken references, and housekeeping items.
//
// Lookup columns for tables without repo-verified schema (cts_*, voice channel, assignment…) are
// illustrative: in a live environment they're discovered from relationship metadata, not assumed.

const d = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

// --- ids ---------------------------------------------------------------------------------------
const WS_SALES = d(1), WS_SUPPORT = d(2), WS_BILLING = d(3), WS_ESC = d(4), WS_ONBOARD = d(5), WS_CHAT = d(6), WS_LEGACY = d(7);
const Q_SALES = d(20), Q_SALES_OVERFLOW = d(21), Q_SUPPORT = d(22), Q_BILLING = d(23), Q_UNUSED = d(24), Q_LEGACY = d(25), Q_TIER2 = d(26), Q_OLD_ESC = d(27), Q_PERSONAL = d(28);
const MISSING_QUEUE = d(990), MISSING_RULESET = d(991), MISSING_PROFILE = d(992);
const OH_STANDARD = d(40), OH_LEGACY = d(41), OH_HOLIDAY = d(42);
const RC_SALES = d(50), RC_SALES_V1 = d(51), RC_SUPPORT = d(52), RC_BILLING = d(53), RC_ESC = d(54), RC_ONBOARD = d(55), RC_CHAT = d(56), RC_LEGACY = d(57);
const RS_SALES = d(70), RS_SALES_OVERFLOW = d(71), RS_SUPPORT = d(72), RS_BILLING = d(73), RS_ESC = d(74), RS_ONBOARD = d(75), RS_LEGACY = d(76), RS_EMPTY = d(77), RS_SKILLS = d(78), RS_COPY = d(79), RS_OLD_OVERFLOW = d(80);
const OA_TRANSFER = d(90), OA_OLD_VOICEMAIL = d(91), OA_UNUSED = d(92);
const CH_SPANISH = d(100), CH_FRENCH = d(101), CH_MANDARIN = d(102);
const CP_VOICE = d(110), CP_CHAT = d(111), CP_LEGACY = d(112), CP_OLD = d(113), CP_RETIRED = d(114);
const AC_SUPPORT = d(120), AC_EMPTY = d(121), AC_ORPHAN = d(122);
const DC_ROUTING = d(130), DC_UNUSED = d(131);
const NT_INCOMING = d(140), NT_OLD = d(141);
const SNS_RING = d(150), SNS_UNUSED = d(151);
const OV_SALES = d(160), OV_BILLING = d(161), OV_ESC = d(162), OV_ONBOARD = d(163), OV_UNLINKED = d(164);
const VCS_SALES = d(170), VCS_UNLINKED = d(171);
const CC_EMEA = d(180), CC_APAC = d(181), CC_UTRECHT = d(182);
const OPH_MAIN = d(190), OPH_UTRECHT = d(191), OPH_UNUSED = d(192);
const U_ANNA = d(200), U_BEN = d(201), U_CHLOE = d(202), U_FORMER = d(203);

// --- rule XML in the verified unified-routing decision format --------------------------------
function routingXml(queues: string[], variable: string): string {
  const rules = queues.map((q, i) => `<rule id="rule${i}" name="Route ${i + 1}"><logical operator="AND"><condition operator="=="><lhs>liveworkitemcontext.${variable}</lhs><rhs>*</rhs></condition></logical><action><setattribute><lhs>assign_to.queue</lhs><rhs>{${q.toUpperCase()}}</rhs></setattribute></action></rule>`).join("");
  return `<decision hit-policy="first"><rules>${rules}</rules></decision>`;
}

function overflowXml(action: string): string {
  return `<decision hit-policy="first"><rules><rule id="of1" name="Long wait"><logical operator="AND"><condition operator="&gt;"><lhs>queue_prequeue.estimatedwaittimeinminutes</lhs><rhs>10</rhs></condition></logical><action><setattribute><lhs>overflowaction.msdyn_overflowactionconfig.msdyn_overflowactionconfigid</lhs><rhs>${action}</rhs></setattribute></action></rule></rules></decision>`;
}

const SKILLS_XML = `<decision hit-policy="all"><rules><rule id="sk1" name="French speakers"><logical operator="AND"><condition operator="=="><lhs>liveworkitemcontext.Language</lhs><rhs>fr</rhs></condition></logical><action><setattribute><lhs>requiredskills</lhs><rhs>[{"characteristicid":"${CH_FRENCH}","name":"French"}]</rhs></setattribute></action></rule></rules></decision>`;
const EMPTY_XML = `<decision hit-policy="first"><rules></rules></decision>`;

const QUEUE_DEFAULT_FETCH = `<fetch version="1.0" mapping="logical"><entity name="queue"><attribute name="name" /><attribute name="queueid" /><order attribute="name" descending="false" /><filter type="and"><condition attribute="statecode" operator="eq" value="0" /></filter></entity></fetch>`;

// --- tables ------------------------------------------------------------------------------------
interface DemoTable {
  primaryName?: string;
  lookups: Record<string, string>;
  rows: Record<string, unknown>[];
}

function rows(table: string, primaryName: string | undefined, entries: [string, string, Record<string, unknown>?][]): Record<string, unknown>[] {
  return entries.map(([id, name, extra]) => ({ [`${table}id`]: id, ...(primaryName ? { [primaryName]: name } : {}), statecode: 0, ...extra }));
}

const TABLES: Record<string, DemoTable> = {
  msdyn_liveworkstream: {
    primaryName: "msdyn_name",
    lookups: { msdyn_defaultqueue: "queue", msdyn_notificationtemplate_incoming: "msdyn_notificationtemplate", cts_contactcenterid: "cts_contactcenter", ownerid: "systemuser" },
    rows: rows("msdyn_liveworkstream", "msdyn_name", [
      [WS_SALES, "Sales – Voice", { msdyn_enablevoicev2: true, msdyn_direction: 0, _msdyn_defaultqueue_value: Q_SALES, _msdyn_notificationtemplate_incoming_value: NT_INCOMING, _cts_contactcenterid_value: CC_EMEA }],
      [WS_SUPPORT, "Support – Voice", { msdyn_enablevoicev2: true, msdyn_direction: 0, _cts_contactcenterid_value: CC_EMEA }],
      [WS_BILLING, "Billing – Voice", { msdyn_enablevoicev2: true, msdyn_direction: 0 }],
      [WS_ESC, "Escalations – Voice", { msdyn_enablevoicev2: true, msdyn_direction: 0 }],
      [WS_ONBOARD, "Onboarding hotline", { msdyn_enablevoicev2: true, msdyn_direction: 0 }],
      [WS_CHAT, "Web chat (pilot)", { msdyn_enablevoicev2: false }],
      [WS_LEGACY, "Legacy callback line", { statecode: 1, msdyn_enablevoicev2: true, msdyn_direction: 0, _cts_contactcenterid_value: CC_UTRECHT }]
    ])
  },
  queue: {
    primaryName: "name",
    lookups: { msdyn_operatinghourid: "msdyn_operatinghour" },
    rows: rows("queue", "name", [
      [Q_SALES, "Sales", { msdyn_isomnichannelqueue: true, _msdyn_operatinghourid_value: OH_STANDARD, _msdyn_prequeueoverflowrulesetid_value: RS_SALES_OVERFLOW }],
      [Q_SALES_OVERFLOW, "Sales – overflow", { msdyn_isomnichannelqueue: true, _msdyn_operatinghourid_value: OH_STANDARD }],
      [Q_SUPPORT, "Support", { msdyn_isomnichannelqueue: true, _msdyn_operatinghourid_value: OH_STANDARD }],
      [Q_BILLING, "Billing", { msdyn_isomnichannelqueue: true, _msdyn_operatinghourid_value: OH_STANDARD }],
      [Q_UNUSED, "Returns (pilot)", { msdyn_isomnichannelqueue: true }],
      [Q_LEGACY, "Callback queue", { msdyn_isomnichannelqueue: true, _msdyn_operatinghourid_value: OH_LEGACY }],
      [Q_TIER2, "Tier 2 specialists", { msdyn_isomnichannelqueue: true, _msdyn_operatinghourid_value: OH_STANDARD }],
      [Q_OLD_ESC, "Escalations (old)", { statecode: 1, msdyn_isomnichannelqueue: true }],
      [Q_PERSONAL, "<Anna Jansen>", { msdyn_isomnichannelqueue: false }]
    ])
  },
  queuemembership: {
    lookups: {},
    rows: [
      [Q_SALES, U_ANNA], [Q_SALES_OVERFLOW, U_BEN], [Q_SUPPORT, U_CHLOE], [Q_BILLING, U_ANNA], [Q_LEGACY, U_BEN], [Q_TIER2, U_CHLOE]
    ].map(([queueid, systemuserid], i) => ({ queuemembershipid: d(300 + i), queueid, systemuserid }))
  },
  msdyn_operatinghour: {
    primaryName: "msdyn_name",
    lookups: {},
    rows: rows("msdyn_operatinghour", "msdyn_name", [[OH_STANDARD, "Mon–Fri 08:00–18:00"], [OH_LEGACY, "Callback hours (legacy)"], [OH_HOLIDAY, "Holiday schedule 2019"]])
  },
  msdyn_routingconfiguration: {
    primaryName: "msdyn_name",
    lookups: { msdyn_liveworkstreamid: "msdyn_liveworkstream" },
    rows: rows("msdyn_routingconfiguration", "msdyn_name", [
      [RC_SALES, "Sales – Voice v2", { msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: WS_SALES }],
      [RC_SALES_V1, "Sales – Voice v1", { msdyn_isactiveconfiguration: false, _msdyn_liveworkstreamid_value: WS_SALES }],
      [RC_SUPPORT, "Support – Voice", { msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: WS_SUPPORT }],
      [RC_BILLING, "Billing – Voice", { msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: WS_BILLING }],
      [RC_ESC, "Escalations – Voice", { msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: WS_ESC }],
      [RC_ONBOARD, "Onboarding hotline", { msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: WS_ONBOARD }],
      [RC_CHAT, "Web chat (draft)", { msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: WS_CHAT }],
      [RC_LEGACY, "Legacy callback", { msdyn_isactiveconfiguration: true, _msdyn_liveworkstreamid_value: WS_LEGACY }]
    ])
  },
  msdyn_routingconfigurationstep: {
    primaryName: "msdyn_name",
    lookups: { msdyn_routingconfigurationid: "msdyn_routingconfiguration", msdyn_rulesetid: "msdyn_decisionruleset" },
    rows: rows("msdyn_routingconfigurationstep", "msdyn_name", [
      [d(60), "Sales: route to queue", { msdyn_type: 192350002, _msdyn_routingconfigurationid_value: RC_SALES, _msdyn_rulesetid_value: RS_SALES }],
      [d(61), "Sales v1: route to queue", { msdyn_type: 192350002, _msdyn_routingconfigurationid_value: RC_SALES_V1, _msdyn_rulesetid_value: RS_SALES }],
      [d(62), "Support: classify", { msdyn_type: 192350000, _msdyn_routingconfigurationid_value: RC_SUPPORT, _msdyn_rulesetid_value: RS_EMPTY }],
      [d(63), "Support: route to queue", { msdyn_type: 192350002, _msdyn_routingconfigurationid_value: RC_SUPPORT, _msdyn_rulesetid_value: RS_SUPPORT }],
      [d(64), "Support: skill identification", { msdyn_type: 192350001, _msdyn_routingconfigurationid_value: RC_SUPPORT, _msdyn_rulesetid_value: MISSING_RULESET }],
      [d(65), "Billing: route to queue", { msdyn_type: 192350002, _msdyn_routingconfigurationid_value: RC_BILLING, _msdyn_rulesetid_value: RS_BILLING }],
      [d(66), "Escalations: route to queue", { msdyn_type: 192350002, _msdyn_routingconfigurationid_value: RC_ESC, _msdyn_rulesetid_value: RS_ESC }],
      [d(67), "Onboarding: route to queue", { msdyn_type: 192350002, _msdyn_routingconfigurationid_value: RC_ONBOARD, _msdyn_rulesetid_value: RS_ONBOARD }],
      [d(68), "Callback: route to queue", { msdyn_type: 192350002, _msdyn_routingconfigurationid_value: RC_LEGACY, _msdyn_rulesetid_value: RS_LEGACY }]
    ])
  },
  msdyn_decisionruleset: {
    primaryName: "msdyn_name",
    lookups: { msdyn_inputcontractid: "msdyn_decisioncontract" },
    rows: rows("msdyn_decisionruleset", "msdyn_name", [
      [RS_SALES, "Sales routing", { msdyn_rulesetdefinition: routingXml([Q_SALES], "AccountNumber"), _msdyn_inputcontractid_value: DC_ROUTING }],
      [RS_SALES_OVERFLOW, "Sales pre-queue overflow", { msdyn_rulesetdefinition: overflowXml(OA_TRANSFER) }],
      [RS_SUPPORT, "Support routing", { msdyn_rulesetdefinition: routingXml([Q_SUPPORT], "Language") }],
      [RS_BILLING, "Billing routing", { msdyn_rulesetdefinition: routingXml([Q_BILLING], "Language") }],
      [RS_ESC, "Escalations routing", { msdyn_rulesetdefinition: routingXml([Q_OLD_ESC, MISSING_QUEUE], "Language") }],
      [RS_ONBOARD, "Onboarding routing", { msdyn_rulesetdefinition: routingXml([Q_SUPPORT], "Language") }],
      [RS_LEGACY, "Callback routing", { msdyn_rulesetdefinition: routingXml([Q_LEGACY], "CallbackTime") }],
      [RS_EMPTY, "Support classification (empty)", { msdyn_rulesetdefinition: EMPTY_XML }],
      [RS_SKILLS, "Support skill matching", { msdyn_rulesetdefinition: SKILLS_XML }],
      [RS_COPY, "Copy of Sales routing", { msdyn_rulesetdefinition: routingXml([Q_SALES], "AccountNumber") }],
      [RS_OLD_OVERFLOW, "Overflow to voicemail (2023)", { msdyn_rulesetdefinition: overflowXml(OA_OLD_VOICEMAIL) }]
    ])
  },
  msdyn_overflowactionconfig: {
    primaryName: "msdyn_name",
    lookups: {},
    rows: rows("msdyn_overflowactionconfig", "msdyn_name", [
      [OA_TRANSFER, "Transfer to Sales – overflow", { msdyn_overflowactiontype: 192350004, "msdyn_overflowactiontype@OData.Community.Display.V1.FormattedValue": "Queue Transfer", msdyn_overflowactiondata: Q_SALES_OVERFLOW }],
      [OA_OLD_VOICEMAIL, "Voicemail (2023)", { msdyn_overflowactiontype: 192350001, "msdyn_overflowactiontype@OData.Community.Display.V1.FormattedValue": "Voicemail" }],
      [OA_UNUSED, "Direct callback (never used)", { msdyn_overflowactiontype: 192350002, "msdyn_overflowactiontype@OData.Community.Display.V1.FormattedValue": "Direct Callback" }]
    ])
  },
  msdyn_ocliveworkstreamcontextvariable: {
    primaryName: "msdyn_name",
    lookups: { msdyn_liveworkstreamid: "msdyn_liveworkstream" },
    rows: rows("msdyn_ocliveworkstreamcontextvariable", "msdyn_name", [
      [d(210), "AccountNumber", { _msdyn_liveworkstreamid_value: WS_SALES, msdyn_isdisplayable: false }],
      [d(211), "PromoCode", { _msdyn_liveworkstreamid_value: WS_SALES, msdyn_isdisplayable: false }],
      [d(212), "Language", { _msdyn_liveworkstreamid_value: WS_SALES, msdyn_isdisplayable: true }],
      [d(213), "CallbackTime", { _msdyn_liveworkstreamid_value: WS_LEGACY, msdyn_isdisplayable: false }]
    ])
  },
  msdyn_ocruleitem: { primaryName: "msdyn_name", lookups: { msdyn_liveworkstream: "msdyn_liveworkstream" }, rows: [] },
  characteristic: {
    primaryName: "name",
    lookups: {},
    rows: rows("characteristic", "name", [[CH_SPANISH, "Spanish"], [CH_FRENCH, "French"], [CH_MANDARIN, "Mandarin (2022 pilot)"]])
  },
  bookableresourcecharacteristic: {
    lookups: { characteristic: "characteristic" },
    rows: [{ bookableresourcecharacteristicid: d(220), statecode: 0, _characteristic_value: CH_SPANISH }]
  },
  msdyn_capacityprofile: {
    primaryName: "msdyn_name",
    lookups: {},
    rows: rows("msdyn_capacityprofile", "msdyn_name", [
      [CP_VOICE, "Default voice inbound"], [CP_CHAT, "Chat – 3 sessions"], [CP_LEGACY, "Callback agents"], [CP_OLD, "Holiday temps 2024"], [CP_RETIRED, "Overflow agents (retired)", { statecode: 1 }]
    ])
  },
  msdyn_bookableresourcecapacityprofile: {
    lookups: { msdyn_capacityprofileid: "msdyn_capacityprofile" },
    rows: [{ msdyn_bookableresourcecapacityprofileid: d(230), statecode: 0, _msdyn_capacityprofileid_value: CP_VOICE }]
  },
  msdyn_liveworkstreamcapacityprofile: {
    primaryName: "msdyn_name",
    lookups: { msdyn_liveworkstreamid: "msdyn_liveworkstream", msdyn_capacityprofileid: "msdyn_capacityprofile" },
    rows: rows("msdyn_liveworkstreamcapacityprofile", "msdyn_name", [
      [d(240), "Web chat ↔ Chat – 3 sessions", { _msdyn_liveworkstreamid_value: WS_CHAT, _msdyn_capacityprofileid_value: CP_CHAT }],
      [d(241), "Legacy callback ↔ Callback agents", { _msdyn_liveworkstreamid_value: WS_LEGACY, _msdyn_capacityprofileid_value: CP_LEGACY }],
      [d(242), "Sales ↔ (deleted profile)", { _msdyn_liveworkstreamid_value: WS_SALES, _msdyn_capacityprofileid_value: MISSING_PROFILE }]
    ])
  },
  msdyn_assignmentconfiguration: {
    primaryName: "msdyn_name",
    lookups: { msdyn_queueid: "queue" },
    rows: rows("msdyn_assignmentconfiguration", "msdyn_name", [
      [AC_SUPPORT, "Support – skill-based assignment", { _msdyn_queueid_value: Q_SUPPORT }],
      [AC_EMPTY, "Sales – custom assignment (draft)", { _msdyn_queueid_value: Q_SALES }],
      [AC_ORPHAN, "Returns – assignment (queue deleted)", { _msdyn_queueid_value: MISSING_QUEUE }]
    ])
  },
  msdyn_assignmentconfigurationstep: {
    primaryName: "msdyn_name",
    lookups: { msdyn_assignmentconfigurationid: "msdyn_assignmentconfiguration", msdyn_rulesetid: "msdyn_decisionruleset", msdyn_capacityprofileid: "msdyn_capacityprofile" },
    rows: rows("msdyn_assignmentconfigurationstep", "msdyn_name", [
      [d(250), "Support: match skills", { _msdyn_assignmentconfigurationid_value: AC_SUPPORT, _msdyn_rulesetid_value: RS_SKILLS, _msdyn_capacityprofileid_value: CP_VOICE }],
      [d(251), "Support: overflow agents", { _msdyn_assignmentconfigurationid_value: AC_SUPPORT, _msdyn_capacityprofileid_value: CP_RETIRED }],
      [d(252), "Returns: round robin", { _msdyn_assignmentconfigurationid_value: AC_ORPHAN }]
    ])
  },
  msdyn_decisioncontract: {
    primaryName: "msdyn_name",
    lookups: {},
    rows: rows("msdyn_decisioncontract", "msdyn_name", [[DC_ROUTING, "Voice routing input"], [DC_UNUSED, "Chat routing input (unused)"]])
  },
  msdyn_notificationtemplate: {
    primaryName: "msdyn_name",
    lookups: { msdyn_soundnotificationsettingid: "msdyn_soundnotificationsetting" },
    rows: rows("msdyn_notificationtemplate", "msdyn_name", [
      [NT_INCOMING, "Incoming voice call", { _msdyn_soundnotificationsettingid_value: SNS_RING }],
      [NT_OLD, "Incoming chat – old branding"]
    ])
  },
  msdyn_soundnotificationsetting: {
    primaryName: "msdyn_name",
    lookups: {},
    rows: rows("msdyn_soundnotificationsetting", "msdyn_name", [[SNS_RING, "Ring tone"], [SNS_UNUSED, "Chime (unused)"]])
  },
  msdyn_omnichannelconfiguration: {
    primaryName: "msdyn_name",
    lookups: {},
    rows: rows("msdyn_omnichannelconfiguration", "msdyn_name", [
      [d(260), "Omnichannel configuration", { modifiedon: daysAgo(12) }],
      [d(261), "Omnichannel configuration (copy)", { modifiedon: daysAgo(500) }],
      [d(262), "Omnichannel configuration (pre-upgrade)", { statecode: 1, modifiedon: daysAgo(900) }]
    ])
  },
  msdyn_ocvoice: {
    primaryName: "msdyn_name",
    lookups: { msdyn_liveworkstreamid: "msdyn_liveworkstream" },
    rows: rows("msdyn_ocvoice", "msdyn_name", [
      [OV_SALES, "Sales line", { _msdyn_liveworkstreamid_value: WS_SALES }],
      [OV_BILLING, "Billing line", { _msdyn_liveworkstreamid_value: WS_BILLING }],
      [OV_ESC, "Escalations line", { _msdyn_liveworkstreamid_value: WS_ESC }],
      [OV_ONBOARD, "Onboarding line", { statecode: 1, _msdyn_liveworkstreamid_value: WS_ONBOARD }],
      [OV_UNLINKED, "Promo campaign line (2024)"]
    ])
  },
  msdyn_ocvoicechannelsetting: {
    primaryName: "msdyn_name",
    lookups: { msdyn_ocvoiceid: "msdyn_ocvoice" },
    rows: rows("msdyn_ocvoicechannelsetting", "msdyn_name", [
      [VCS_SALES, "Sales line settings", { _msdyn_ocvoiceid_value: OV_SALES }],
      [VCS_UNLINKED, "Promo line settings", { _msdyn_ocvoiceid_value: OV_UNLINKED }]
    ])
  },
  msdyn_ocvoicechannellanguagesetting: {
    primaryName: "msdyn_name",
    lookups: { msdyn_ocvoicechannelsettingid: "msdyn_ocvoicechannelsetting" },
    rows: rows("msdyn_ocvoicechannellanguagesetting", "msdyn_name", [
      [d(270), "Sales line – English", { _msdyn_ocvoicechannelsettingid_value: VCS_SALES }],
      [d(271), "Promo line – Dutch", { _msdyn_ocvoicechannelsettingid_value: VCS_UNLINKED }]
    ])
  },
  cts_servicenumber: {
    primaryName: "cts_name",
    lookups: { cts_ocvoiceid: "msdyn_ocvoice" },
    rows: rows("cts_servicenumber", "cts_name", [
      [d(280), "+31 20 555 0100", { _cts_ocvoiceid_value: OV_SALES }],
      [d(281), "+31 20 555 0140", { _cts_ocvoiceid_value: OV_ESC }],
      [d(282), "+31 20 555 0160", { _cts_ocvoiceid_value: OV_ONBOARD }],
      [d(283), "+31 20 555 0199"]
    ])
  },
  cts_contactcenter: {
    primaryName: "cts_name",
    lookups: { cts_openinghourid: "cts_openinghour" },
    rows: rows("cts_contactcenter", "cts_name", [
      [CC_EMEA, "Amsterdam (EMEA)", { _cts_openinghourid_value: OPH_MAIN }],
      [CC_APAC, "Singapore (APAC pilot)"],
      [CC_UTRECHT, "Utrecht site (closed)", { statecode: 1, _cts_openinghourid_value: OPH_UTRECHT }]
    ])
  },
  cts_openinghour: {
    primaryName: "cts_name",
    lookups: {},
    rows: rows("cts_openinghour", "cts_name", [[OPH_MAIN, "Amsterdam hours"], [OPH_UTRECHT, "Utrecht hours"], [OPH_UNUSED, "Summer hours 2021"]])
  },
  userquery: {
    primaryName: "name",
    lookups: {},
    rows: rows("userquery", "name", [
      [d(310), "My escalation queues", { returnedtypecode: "queue", _ownerid_value: U_FORMER, fetchxml: `<fetch><entity name="queue"><attribute name="name" /></entity></fetch>` }],
      [d(311), "Active Queues (my copy)", { returnedtypecode: "queue", _ownerid_value: U_ANNA, fetchxml: QUEUE_DEFAULT_FETCH.replace(/></g, ">\n  <") }],
      [d(312), "Workstreams – old filter", { statecode: 1, returnedtypecode: "msdyn_liveworkstream", _ownerid_value: U_BEN, fetchxml: `<fetch><entity name="msdyn_liveworkstream"><attribute name="msdyn_name" /></entity></fetch>` }],
      [d(313), "Queues with overflow", { returnedtypecode: "queue", _ownerid_value: U_CHLOE, fetchxml: `<fetch><entity name="queue"><attribute name="name" /><filter><condition attribute="msdyn_prequeueoverflowrulesetid" operator="not-null" /></filter></entity></fetch>` }],
      [d(314), "My accounts", { returnedtypecode: "account", _ownerid_value: U_FORMER, statecode: 1, fetchxml: `<fetch><entity name="account" /></fetch>` }]
    ])
  },
  savedquery: {
    primaryName: "name",
    lookups: {},
    rows: rows("savedquery", "name", [[d(320), "Active Queues", { returnedtypecode: "queue", isdefault: true, querytype: 0, fetchxml: QUEUE_DEFAULT_FETCH }]])
  },
  systemuser: {
    primaryName: "fullname",
    lookups: {},
    rows: rows("systemuser", "fullname", [[U_FORMER, "Former Agent", { isdisabled: true }], [U_ANNA, "Anna Jansen", { isdisabled: false }]])
  },
  bulkdeleteoperation: {
    primaryName: "name",
    lookups: {},
    rows: rows("bulkdeleteoperation", "name", [
      [d(330), "Purge closed conversations older than 2 years", { statecode: 3, statuscode: 30, isrecurring: false, createdon: daysAgo(420), modifiedon: daysAgo(418), successcount: 18422, failurecount: 0 }],
      [d(331), "Delete test agents' sessions", { statecode: 3, statuscode: 31, isrecurring: false, createdon: daysAgo(230), modifiedon: daysAgo(229), successcount: 0, failurecount: 57 }],
      [d(332), "Remove duplicate contacts (September)", { statecode: 3, statuscode: 30, isrecurring: false, createdon: daysAgo(12), modifiedon: daysAgo(12), successcount: 311, failurecount: 0 }],
      [d(333), "Nightly transcript purge", { statecode: 0, statuscode: 10, isrecurring: true, createdon: daysAgo(700), modifiedon: daysAgo(1) }]
    ])
  }
};

// Two tables are deliberately unavailable, to show how the scan degrades.
const UNAVAILABLE: Record<string, { status: AccessFailure; message: string }> = {
  msdyn_templateruleset: { status: "notFound", message: "Sample environment: this table doesn't exist here." },
  msdyn_oclocalizationdata: { status: "noPermission", message: "Sample environment: no read permission on this table." }
};

export const demoSource: DataSource = {
  mode: "demo",
  async describeTable(logicalName: string): Promise<DescribeResult> {
    const unavailable = UNAVAILABLE[logicalName];
    if (unavailable) return unavailable;
    const table = TABLES[logicalName];
    if (!table) return { status: "notFound", message: `Sample environment: “${logicalName}” isn't part of the sample data.` };
    return {
      status: "ok",
      metadata: {
        primaryId: `${logicalName}id`,
        primaryName: table.primaryName,
        lookups: Object.entries(table.lookups).map(([attribute, target]) => ({ attribute, target }))
      }
    };
  },
  async readTable(request: ReadRequest): Promise<ReadResult> {
    // Filters are ignored: every rule re-applies its own conditions, exactly as it must when a live
    // server rejects a filter.
    return { rows: JSON.parse(JSON.stringify(TABLES[request.logicalName]?.rows ?? [])), droppedColumns: [], filterApplied: false };
  }
};

// Ids referenced by the demo-coverage test.
export const DEMO_IDS = {
  cleanRecords: [WS_SALES, Q_SALES, Q_SALES_OVERFLOW, Q_SUPPORT, OH_STANDARD, CH_SPANISH, CH_FRENCH, CP_VOICE, CP_CHAT, OA_TRANSFER, NT_INCOMING, SNS_RING, DC_ROUTING, OPH_MAIN, CC_EMEA, RS_SALES, RS_SKILLS, RC_SALES, OV_SALES, VCS_SALES, d(210), d(212), d(280), d(60), d(250)],
  personalQueue: Q_PERSONAL,
  spareNumber: d(283),
  unusedQueue: Q_UNUSED,
  billingWorkstream: WS_BILLING
};
