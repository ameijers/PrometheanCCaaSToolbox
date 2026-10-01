import { NamedRecord, ResolvedChannel, ResolvedWorkstream } from "./model";
import { recordingColumns } from "./recordingSettings";
import {
  CAPACITY_FORMAT, CHANNEL_FIXED_FIELDS, DIRECTIONS, NAV, NOTIFICATION, PRESENCES, STREAM_SOURCE_VOICE,
  VOICE_AUTO_CLOSE_AFTER_INACTIVITY, WORKSTREAM_MODE_SIMPLIFIED, WORK_DISTRIBUTION, bind
} from "./voiceSchema";

// The exact JSON sent to Dataverse for each record, built from a resolved spec. Pure, so every
// payload can be unit-tested and shown to the admin before anything is written.

type Payload = Record<string, unknown>;

export function workstreamPayload(ws: ResolvedWorkstream): Payload {
  const payload: Payload = {
    msdyn_name: ws.name,
    msdyn_streamsource: STREAM_SOURCE_VOICE,
    msdyn_enablevoicev2: true,
    msdyn_mode: WORKSTREAM_MODE_SIMPLIFIED,
    msdyn_direction: DIRECTIONS[ws.direction],
    msdyn_workdistributionmode: WORK_DISTRIBUTION[ws.workDistribution],
    msdyn_capacityformat: CAPACITY_FORMAT[ws.capacityFormat],
    msdyn_capacityrequired: ws.capacityUnits,
    msdyn_allowedpresences: ws.presences.map((p) => PRESENCES[p]).join(","),
    msdyn_autocloseafterinactivity: VOICE_AUTO_CLOSE_AFTER_INACTIVITY,
    msdyn_notification: NOTIFICATION[ws.notification],
    msdyn_enableagentaffinity: ws.agentAffinity,
    msdyn_restrictdownloadrecording: ws.restrictRecordingDownload,
    msdyn_restrictdownloadtranscript: ws.restrictTranscriptDownload
  };
  if (ws.refs.defaultQueue) payload[`${NAV.workstream.defaultQueue}@odata.bind`] = bind("queue", ws.refs.defaultQueue);
  if (ws.refs.outboundQueue) payload[`${NAV.workstream.outboundQueue}@odata.bind`] = bind("queue", ws.refs.outboundQueue);
  return payload;
}

// Named the way the admin center names them: "<profile name>-<profile id>".
export function capacityLinkPayload(workstreamId: string, profile: NamedRecord): Payload {
  return {
    msdyn_name: `${profile.name}-${profile.id}`,
    [`${NAV.capacityLink.workstream}@odata.bind`]: bind("workstream", workstreamId),
    [`${NAV.capacityLink.capacityProfile}@odata.bind`]: bind("capacityProfile", profile.id)
  };
}

export function channelPayload(workstreamId: string, ch: ResolvedChannel): Payload {
  const payload: Payload = {
    msdyn_name: ch.name,
    [`${NAV.channel.workstream}@odata.bind`]: bind("workstream", workstreamId),
    ...recordingColumns(ch.recording),
    msdyn_agentexternalparticipanttransfercontrolenabled: ch.pstnTransferControls,
    msdyn_agentexternalteamsparticipanttransfercontrolenabled: ch.teamsTransferControls,
    ...CHANNEL_FIXED_FIELDS
  };
  // No number is a supported state: the channel is created now and a number is assigned later.
  if (ch.refs.phoneNumber) payload[`${NAV.channel.phoneNumber}@odata.bind`] = bind("phoneNumber", ch.refs.phoneNumber);
  if (ch.refs.operatingHours) payload[`${NAV.channel.operatingHours}@odata.bind`] = bind("operatingHour", ch.refs.operatingHours);
  // Outbound calling (outbound profiles): caller ID number, name and anonymity, as the admin center
  // stores them on the channel. Absent for inbound channels, so nothing is written for them.
  if (ch.outbound) {
    payload.msdyn_isanonymouscallerid = ch.outbound.anonymousCallerId;
    if (ch.outbound.callerIdName) payload.msdyn_calleridname = ch.outbound.callerIdName;
    if (ch.refs.callerIdNumber) payload[`${NAV.channel.callerIdNumber}@odata.bind`] = bind("phoneNumber", ch.refs.callerIdNumber);
  }
  return payload;
}

// The admin center gives every channel language its own msdyn_ocvoice row rather than sharing one.
export function ttsVoicePayload(ch: ResolvedChannel): Payload {
  const payload: Payload = {
    msdyn_name: ch.ttsVoice,
    msdyn_voicename: ch.ttsVoice,
    msdyn_speakingspeed: ch.voiceSpeed,
    msdyn_pitch: ch.voicePitch
  };
  if (ch.voiceStyle) payload.msdyn_voicestyle = ch.voiceStyle;
  if (ch.refs.language) payload[`${NAV.ttsVoice.language}@odata.bind`] = bind("language", ch.refs.language.id);
  return payload;
}

export function languageSettingPayload(channelId: string, ch: ResolvedChannel, ttsVoiceId: string | undefined): Payload {
  const payload: Payload = {
    msdyn_name: `${ch.name} – ${ch.refs.language?.localeCode ?? ch.language}`,
    msdyn_isprimary: true,
    [`${NAV.languageSetting.channel}@odata.bind`]: bind("channel", channelId)
  };
  if (ch.refs.language) payload[`${NAV.languageSetting.language}@odata.bind`] = bind("language", ch.refs.language.id);
  if (ttsVoiceId) payload[`${NAV.languageSetting.ttsVoice}@odata.bind`] = bind("ttsVoice", ttsVoiceId);
  if (ch.refs.holdMusic) payload[`${NAV.languageSetting.holdMusic}@odata.bind`] = bind("music", ch.refs.holdMusic);
  if (ch.refs.waitMusic) payload[`${NAV.languageSetting.waitMusic}@odata.bind`] = bind("music", ch.refs.waitMusic);
  return payload;
}
