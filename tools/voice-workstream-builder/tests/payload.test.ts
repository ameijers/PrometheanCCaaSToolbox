import { ResolvedChannel, ResolvedWorkstream } from "../src/model";
import { capacityLinkPayload, channelPayload, languageSettingPayload, ttsVoicePayload, workstreamPayload } from "../src/payload";
import { DEFAULT_RECORDING_SETTINGS, readRecordingSettings, recordingColumns } from "../src/recordingSettings";

const channel: ResolvedChannel = {
  line: 2, name: "Sales – NL", phoneNumber: "+31201234567", language: "nl-NL", ttsVoice: "nl-NL-FennaNeural", voiceSpeed: 1, voicePitch: -2,
  recording: { ...DEFAULT_RECORDING_SETTINGS, capture: "transcriptAndRecording", start: "manual" },
  pstnTransferControls: true, teamsTransferControls: false,
  refs: { phoneNumber: "p1", language: { id: "l1", name: "Dutch - Netherlands", localeCode: "nl-NL" }, holdMusic: "m1", operatingHours: "o1" }
};

const workstream: ResolvedWorkstream = {
  key: "sales", name: "Sales", lines: [2], direction: "Inbound", workDistribution: "Push", capacityFormat: "Profile", capacityUnits: 30,
  presences: ["Available", "Busy"], defaultQueue: "Q", notification: "Screen pop with timeout", agentAffinity: false,
  restrictRecordingDownload: true, restrictTranscriptDownload: false,
  refs: { defaultQueue: "q1", capacityProfile: { id: "c1", name: "Default voice inbound" } },
  channels: [channel]
};

describe("payloads", () => {
  test("workstream: a Simplified voice workstream with verified option values", () => {
    expect(workstreamPayload(workstream)).toEqual({
      msdyn_name: "Sales",
      msdyn_streamsource: 192440000,
      msdyn_enablevoicev2: true,
      msdyn_mode: 717210001,
      msdyn_direction: 0,
      msdyn_workdistributionmode: 192350000,
      msdyn_capacityformat: 192360000,
      msdyn_capacityrequired: 30,
      msdyn_allowedpresences: "192360000,192360001",
      msdyn_autocloseafterinactivity: 5,
      msdyn_notification: 100000001,
      msdyn_enableagentaffinity: false,
      msdyn_restrictdownloadrecording: true,
      msdyn_restrictdownloadtranscript: false,
      "msdyn_defaultqueue@odata.bind": "/queues(q1)"
    });
  });

  test("workstream: outbound queue binds only when resolved", () => {
    const outbound = workstreamPayload({ ...workstream, direction: "Outbound", refs: { outboundQueue: "q2" } });
    expect(outbound["msdyn_outboundqueueid@odata.bind"]).toBe("/queues(q2)");
    expect(outbound).not.toHaveProperty("msdyn_defaultqueue@odata.bind");
    expect(outbound.msdyn_direction).toBe(1);
  });

  test("capacity link uses the case-sensitive navigation property and the admin center's naming", () => {
    expect(capacityLinkPayload("w1", { id: "c1", name: "Default voice inbound" })).toEqual({
      msdyn_name: "Default voice inbound-c1",
      "msdyn_workstream_id@odata.bind": "/msdyn_liveworkstreams(w1)",
      "msdyn_capacityProfile_id@odata.bind": "/msdyn_capacityprofiles(c1)"
    });
  });

  test("channel: recording columns, fixed required booleans and optional binds", () => {
    const payload = channelPayload("w1", channel);
    expect(payload).toMatchObject({
      msdyn_name: "Sales – NL",
      "msdyn_liveworkstreamid@odata.bind": "/msdyn_liveworkstreams(w1)",
      "msdyn_phonenumberid@odata.bind": "/msdyn_ocphonenumbers(p1)",
      "msdyn_operatinghoursid@odata.bind": "/msdyn_operatinghours(o1)",
      msdyn_transcriptionenabled: true, msdyn_transcriptionmode: "192351001",
      msdyn_recordingenabled: true, msdyn_recordingmode: "192351001",
      msdyn_agentexternalparticipanttransfercontrolenabled: true,
      msdyn_agentexternalteamsparticipanttransfercontrolenabled: false,
      msdyn_stoptranscriptionandrecordingafterpstntransfer: false,
      msdyn_usebridgetransferforteamstransfer: false
    });
  });

  test("channel without a number has no phone number bind at all", () => {
    const payload = channelPayload("w1", { ...channel, phoneNumber: undefined, refs: { ...channel.refs, phoneNumber: undefined } });
    expect(Object.keys(payload).some((k) => k.startsWith("msdyn_phonenumberid"))).toBe(false);
  });

  test("TTS voice binds its language through msdyn_language, not msdyn_languageid", () => {
    expect(ttsVoicePayload(channel)).toEqual({
      msdyn_name: "nl-NL-FennaNeural", msdyn_voicename: "nl-NL-FennaNeural", msdyn_speakingspeed: 1, msdyn_pitch: -2,
      "msdyn_language@odata.bind": "/msdyn_oclanguages(l1)"
    });
  });

  test("language setting is primary and links channel, language, voice and music", () => {
    expect(languageSettingPayload("ch1", channel, "v1")).toEqual({
      msdyn_name: "Sales – NL – nl-NL",
      msdyn_isprimary: true,
      "msdyn_ocvoicechannelsettingid@odata.bind": "/msdyn_ocvoicechannelsettings(ch1)",
      "msdyn_languageid@odata.bind": "/msdyn_oclanguages(l1)",
      "msdyn_ocvoiceid@odata.bind": "/msdyn_ocvoices(v1)",
      "msdyn_holdmusicid@odata.bind": "/msdyn_ocphonemusics(m1)"
    });
    expect(languageSettingPayload("ch1", channel, undefined)).not.toHaveProperty("msdyn_ocvoiceid@odata.bind");
  });
});

describe("recording settings", () => {
  test("each option writes all four capture columns; the start mode goes to what is switched on", () => {
    expect(recordingColumns({ capture: "none" })).toEqual({ msdyn_transcriptionenabled: false, msdyn_transcriptionmode: "192351000", msdyn_recordingenabled: false, msdyn_recordingmode: "192351000" });
    expect(recordingColumns({ capture: "transcript", start: "manual" })).toEqual({ msdyn_transcriptionenabled: true, msdyn_transcriptionmode: "192351001", msdyn_recordingenabled: false, msdyn_recordingmode: "192351000" });
    expect(recordingColumns({ capture: "transcriptAndRecording" })).toEqual({ msdyn_transcriptionenabled: true, msdyn_transcriptionmode: "192351002", msdyn_recordingenabled: true, msdyn_recordingmode: "192351002" });
  });

  test("only the fields given are written, and a start mode never goes alone", () => {
    expect(recordingColumns({ stopOnHold: true })).toEqual({ msdyn_enablestoprecordingtranscriptiononhold: true });
    expect(() => recordingColumns({ start: "manual" })).toThrow(/together/);
  });

  test("reading back what was written gives the same settings", () => {
    (["none", "transcript", "transcriptAndRecording"] as const).forEach((capture) => {
      const settings = { ...DEFAULT_RECORDING_SETTINGS, capture, start: capture === "none" ? "automatic" as const : "manual" as const, requestConsent: true };
      expect(readRecordingSettings(recordingColumns(settings))).toEqual(settings);
    });
  });

  test("reads the states found in environments", () => {
    // As the admin center stored them on academyexperiment.
    expect(readRecordingSettings({ msdyn_transcriptionenabled: true, msdyn_transcriptionmode: "192351002", msdyn_recordingenabled: true, msdyn_recordingmode: "192351002" })).toMatchObject({ capture: "transcriptAndRecording", start: "automatic" });
    expect(readRecordingSettings({ msdyn_transcriptionenabled: true, msdyn_transcriptionmode: "192351001", msdyn_recordingenabled: true, msdyn_recordingmode: "192351001" })).toMatchObject({ capture: "transcriptAndRecording", start: "manual" });
    expect(readRecordingSettings({ msdyn_transcriptionenabled: true, msdyn_transcriptionmode: null })).toMatchObject({ capture: "transcript", start: "automatic" });
    // A disabled flag wins over a leftover mode; recording alone isn't an option and reads as such.
    expect(readRecordingSettings({ msdyn_transcriptionenabled: false, msdyn_transcriptionmode: "192351001", msdyn_recordingenabled: false })).toMatchObject({ capture: "none", start: "automatic" });
    expect(readRecordingSettings({ msdyn_recordingenabled: true, msdyn_recordingmode: "192351001" })).toMatchObject({ capture: "recordingOnly", start: "manual" });
    expect(recordingColumns({ capture: "recordingOnly", start: "manual" })).toMatchObject({ msdyn_transcriptionenabled: false, msdyn_recordingenabled: true, msdyn_recordingmode: "192351001" });
  });
});
