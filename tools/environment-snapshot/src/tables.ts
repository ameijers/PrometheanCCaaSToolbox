// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Section, SectionId } from "./model";

// Every table in a snapshot, by section. A table that doesn't exist in an environment (a channel that
// isn't installed, for example) is listed as "not in this environment", not treated as an error.
// Checked in academyexperiment on 2026-11-25 (read-only): all of these exist there except
// msdyn_agentscript, which isn't listed. Conversations, voicemails, recordings and other day-to-day
// data aren't configuration and are left out.

export const SECTIONS: Section[] = [
  { id: "channels", title: "Channels and phone numbers", description: "Phone numbers, voice channels with their languages, voices and music, and the messaging channels." },
  { id: "workstreams", title: "Workstreams", description: "Workstreams (including outbound profiles), their context variables and capacity profiles, and record routing." },
  { id: "routing", title: "Routing", description: "Routing configurations, their steps, every ruleset (routing, overflow and assignment rules) and overflow actions." },
  { id: "queues", title: "Queues and assignment", description: "Contact center queues, custom assignment methods, operating hours and queue members." },
  { id: "agents", title: "Agents, skills and capacity", description: "Agents, their skills, capacity profiles, teams, business units and security roles." },
  { id: "experience", title: "Agent experience", description: "Presence, session and notification templates, app profiles, productivity pane, quick replies and tags." },
  { id: "messages", title: "Messages and settings", description: "Automated messages and the Omnichannel configuration." }
];

export interface TableSpec {
  logicalName: string;
  section: SectionId;
  filter?: string;
  scope?: string;
  // Read by the ids other tables point to, with only these columns (users: no personal details).
  byIds?: { idColumn: string; select: string[] };
}

export const TABLES: TableSpec[] = [
  { logicalName: "msdyn_ocphonenumber", section: "channels" },
  { logicalName: "msdyn_ocvoicechannelsetting", section: "channels" },
  { logicalName: "msdyn_ocvoicechannellanguagesetting", section: "channels" },
  { logicalName: "msdyn_ocvoice", section: "channels" },
  { logicalName: "msdyn_ocphonemusic", section: "channels" },
  { logicalName: "msdyn_livechatconfig", section: "channels" },
  { logicalName: "msdyn_ocsmschannelsetting", section: "channels" },
  { logicalName: "msdyn_octeamschannelconfig", section: "channels" },
  { logicalName: "msdyn_ocwhatsappchannelnumber", section: "channels" },
  { logicalName: "msdyn_ocfbpage", section: "channels" },
  { logicalName: "msdyn_occustommessagingchannel", section: "channels" },
  { logicalName: "msdyn_ocbotchannelregistration", section: "channels" },

  { logicalName: "msdyn_liveworkstream", section: "workstreams" },
  { logicalName: "msdyn_ocliveworkstreamcontextvariable", section: "workstreams" },
  { logicalName: "msdyn_liveworkstreamcapacityprofile", section: "workstreams" },
  { logicalName: "msdyn_masterentityroutingconfiguration", section: "workstreams" },

  { logicalName: "msdyn_routingconfiguration", section: "routing" },
  { logicalName: "msdyn_routingconfigurationstep", section: "routing" },
  { logicalName: "msdyn_decisionruleset", section: "routing" },
  { logicalName: "msdyn_overflowactionconfig", section: "routing" },

  // Users' personal queues and email queues aren't contact center configuration.
  { logicalName: "queue", section: "queues", filter: "msdyn_isomnichannelqueue eq true", scope: "Contact center queues only" },
  { logicalName: "msdyn_assignmentconfiguration", section: "queues" },
  { logicalName: "msdyn_assignmentconfigurationstep", section: "queues" },
  { logicalName: "msdyn_operatinghour", section: "queues" },

  { logicalName: "bookableresource", section: "agents" },
  { logicalName: "bookableresourcecharacteristic", section: "agents" },
  { logicalName: "msdyn_bookableresourcecapacityprofile", section: "agents" },
  { logicalName: "characteristic", section: "agents" },
  { logicalName: "ratingmodel", section: "agents" },
  { logicalName: "ratingvalue", section: "agents" },
  { logicalName: "msdyn_capacityprofile", section: "agents" },
  // Only the users the configuration points to: queue members, agents and bots. Work details only.
  {
    logicalName: "systemuser", section: "agents", scope: "Queue members, agents and bots; name, sign-in, business unit and status only",
    byIds: { idColumn: "systemuserid", select: ["systemuserid", "fullname", "domainname", "internalemailaddress", "_businessunitid_value", "isdisabled", "accessmode", "title"] }
  },
  { logicalName: "team", section: "agents" },
  { logicalName: "businessunit", section: "agents" },

  { logicalName: "msdyn_presence", section: "experience" },
  { logicalName: "msdyn_sessiontemplate", section: "experience" },
  { logicalName: "msdyn_notificationtemplate", section: "experience" },
  { logicalName: "msdyn_templateparameter", section: "experience" },
  { logicalName: "msdyn_applicationtabtemplate", section: "experience" },
  { logicalName: "msdyn_appconfiguration", section: "experience" },
  { logicalName: "msdyn_paneconfiguration", section: "experience" },
  { logicalName: "msdyn_personasecurityrolemapping", section: "experience" },
  { logicalName: "msdyn_cannedmessage", section: "experience" },
  { logicalName: "msdyn_octag", section: "experience" },
  { logicalName: "msdyn_soundfile", section: "experience" },
  { logicalName: "msdyn_productivitymacroactiontemplate", section: "experience" },
  { logicalName: "msdyn_productivityagentscript", section: "experience" },

  { logicalName: "msdyn_ocsystemmessage", section: "messages" },
  { logicalName: "msdyn_omnichannelconfiguration", section: "messages" }
];

// A readable name for each table, for when the environment can't give one (a table that isn't
// installed). Live, the table's own display name is used.
export const TABLE_LABELS: Record<string, string> = {
  msdyn_ocphonenumber: "Phone numbers", msdyn_ocvoicechannelsetting: "Voice channels", msdyn_ocvoicechannellanguagesetting: "Voice channel languages",
  msdyn_ocvoice: "Text-to-speech voices", msdyn_ocphonemusic: "Hold and wait music", msdyn_livechatconfig: "Chat widgets", msdyn_ocsmschannelsetting: "SMS numbers",
  msdyn_octeamschannelconfig: "Microsoft Teams channels", msdyn_ocwhatsappchannelnumber: "WhatsApp numbers", msdyn_ocfbpage: "Facebook pages",
  msdyn_occustommessagingchannel: "Custom messaging channels", msdyn_ocbotchannelregistration: "Custom messaging accounts",
  msdyn_liveworkstream: "Workstreams", msdyn_ocliveworkstreamcontextvariable: "Context variables", msdyn_liveworkstreamcapacityprofile: "Workstream capacity profiles",
  msdyn_masterentityroutingconfiguration: "Record routing", msdyn_routingconfiguration: "Routing configurations", msdyn_routingconfigurationstep: "Routing configuration steps",
  msdyn_decisionruleset: "Rulesets", msdyn_overflowactionconfig: "Overflow actions", queue: "Queues", msdyn_assignmentconfiguration: "Assignment methods",
  msdyn_assignmentconfigurationstep: "Assignment method steps", msdyn_operatinghour: "Operating hours", bookableresource: "Bookable resources",
  bookableresourcecharacteristic: "Agent skills", msdyn_bookableresourcecapacityprofile: "Agent capacity profiles", characteristic: "Skills",
  ratingmodel: "Rating models", ratingvalue: "Rating values", msdyn_capacityprofile: "Capacity profiles", systemuser: "Users", team: "Teams",
  businessunit: "Business units", msdyn_presence: "Presence", msdyn_sessiontemplate: "Session templates", msdyn_notificationtemplate: "Notification templates",
  msdyn_templateparameter: "Template parameters", msdyn_applicationtabtemplate: "Application tab templates", msdyn_appconfiguration: "App profiles",
  msdyn_paneconfiguration: "Productivity pane", msdyn_personasecurityrolemapping: "Persona security role mappings", msdyn_cannedmessage: "Quick replies",
  msdyn_octag: "Tags", msdyn_soundfile: "Audio files", msdyn_productivitymacroactiontemplate: "Macro action templates", msdyn_productivityagentscript: "Agent scripts",
  msdyn_ocsystemmessage: "Automated messages", msdyn_omnichannelconfiguration: "Omnichannel configuration"
};

// Tables this tool makes from other reads, with plain columns.
export const DERIVED = {
  queueMembers: { logicalName: "queuemembership", label: "Queue members", section: "queues" as SectionId },
  teamMembers: { logicalName: "teammembership", label: "Team members", section: "agents" as SectionId },
  securityRoles: { logicalName: "systemuserroles", label: "Security roles of agents", section: "agents" as SectionId }
};
