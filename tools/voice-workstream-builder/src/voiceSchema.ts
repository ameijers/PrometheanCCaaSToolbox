// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Every table, column, navigation property and option value this tool writes, in one place. All of
// it was read from the live academyexperiment environment's metadata and from the voice workstreams
// and channels the Copilot Service admin center had created there (see IMPLEMENTATION_STATUS.md,
// "Step 0"). Nothing here is guessed: a value that couldn't be confirmed isn't written at all.
//
// Navigation property names are copied exactly from ManyToOneRelationships metadata — they are
// case-sensitive and don't always match the column name (msdyn_ocvoice's language lookup is
// `msdyn_languageid` but binds through `msdyn_language`; the capacity link binds through
// `msdyn_capacityProfile_id`).

export const TABLES = {
  workstream: { logicalName: "msdyn_liveworkstream", entitySet: "msdyn_liveworkstreams", primaryId: "msdyn_liveworkstreamid" },
  capacityLink: { logicalName: "msdyn_liveworkstreamcapacityprofile", entitySet: "msdyn_liveworkstreamcapacityprofiles", primaryId: "msdyn_liveworkstreamcapacityprofileid" },
  channel: { logicalName: "msdyn_ocvoicechannelsetting", entitySet: "msdyn_ocvoicechannelsettings", primaryId: "msdyn_ocvoicechannelsettingid" },
  ttsVoice: { logicalName: "msdyn_ocvoice", entitySet: "msdyn_ocvoices", primaryId: "msdyn_ocvoiceid" },
  languageSetting: { logicalName: "msdyn_ocvoicechannellanguagesetting", entitySet: "msdyn_ocvoicechannellanguagesettings", primaryId: "msdyn_ocvoicechannellanguagesettingid" },
  queue: { logicalName: "queue", entitySet: "queues", primaryId: "queueid" },
  capacityProfile: { logicalName: "msdyn_capacityprofile", entitySet: "msdyn_capacityprofiles", primaryId: "msdyn_capacityprofileid" },
  operatingHour: { logicalName: "msdyn_operatinghour", entitySet: "msdyn_operatinghours", primaryId: "msdyn_operatinghourid" },
  phoneNumber: { logicalName: "msdyn_ocphonenumber", entitySet: "msdyn_ocphonenumbers", primaryId: "msdyn_ocphonenumberid" },
  language: { logicalName: "msdyn_oclanguage", entitySet: "msdyn_oclanguages", primaryId: "msdyn_oclanguageid" },
  music: { logicalName: "msdyn_ocphonemusic", entitySet: "msdyn_ocphonemusics", primaryId: "msdyn_ocphonemusicid" },
  routingConfiguration: { logicalName: "msdyn_routingconfiguration", entitySet: "msdyn_routingconfigurations", primaryId: "msdyn_routingconfigurationid" }
} as const;

export type TableKey = keyof typeof TABLES;

// `@odata.bind` navigation properties, per table being written.
export const NAV = {
  workstream: { defaultQueue: "msdyn_defaultqueue", outboundQueue: "msdyn_outboundqueueid" },
  capacityLink: { workstream: "msdyn_workstream_id", capacityProfile: "msdyn_capacityProfile_id" },
  channel: { workstream: "msdyn_liveworkstreamid", phoneNumber: "msdyn_phonenumberid", callerIdNumber: "msdyn_calleridphonenumberid", operatingHours: "msdyn_operatinghoursid" },
  ttsVoice: { language: "msdyn_language" },
  languageSetting: { channel: "msdyn_ocvoicechannelsettingid", language: "msdyn_languageid", ttsVoice: "msdyn_ocvoiceid", holdMusic: "msdyn_holdmusicid", waitMusic: "msdyn_waitmusicid" }
} as const;

export function bind(table: TableKey, id: string): string {
  return `/${TABLES[table].entitySet}(${id})`;
}

// msdyn_liveworkstream option values (from the option sets' own metadata).
export const STREAM_SOURCE_VOICE = 192440000;
export const WORKSTREAM_MODE_SIMPLIFIED = 717210001;
// Every voice workstream the admin center created had 5 here; the admin center doesn't show it for voice.
export const VOICE_AUTO_CLOSE_AFTER_INACTIVITY = 5;

export const DIRECTIONS = { Inbound: 0, Outbound: 1 } as const;
export type Direction = keyof typeof DIRECTIONS;

export const WORK_DISTRIBUTION = { Push: 192350000, Pick: 192350001 } as const;
export type WorkDistribution = keyof typeof WORK_DISTRIBUTION;

export const CAPACITY_FORMAT = { Profile: 192360000, Unit: 192350000 } as const;
export type CapacityFormat = keyof typeof CAPACITY_FORMAT;

export const NOTIFICATION = {
  "Screen pop with timeout": 100000001,
  "Screen pop with decline": 100000002,
  "Directly open session": 100000000
} as const;
export type Notification = keyof typeof NOTIFICATION;

// msdyn_allowedpresences is a multi-select option set; the Web API takes it as a comma-separated string.
export const PRESENCES = { Available: 192360000, Busy: 192360001, "Busy - DND": 192360002, Away: 192360003, Offline: 192360004 } as const;
export type Presence = keyof typeof PRESENCES;

// The admin center's own default capacity profiles (msdyn_uniquename), used when the CSV leaves
// capacity_profile blank on a profile-based workstream.
export const DEFAULT_CAPACITY_PROFILE: Record<Direction, string> = {
  Inbound: "msdyn_voice_inbound_profile",
  Outbound: "msdyn_voice_default_outbound_profile"
};

// Required (ApplicationRequired) booleans on the channel setting that this tool doesn't expose as
// CSV columns. Every channel in the reference environment had these false.
export const CHANNEL_FIXED_FIELDS = {
  msdyn_stoptranscriptionandrecordingafterpstntransfer: false,
  msdyn_stoptranscriptionandrecordingafterteamstransfer: false,
  msdyn_usebridgetransferforpstntransfer: false,
  msdyn_usebridgetransferforteamstransfer: false
} as const;
