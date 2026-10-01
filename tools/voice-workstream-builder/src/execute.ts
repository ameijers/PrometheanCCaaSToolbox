import { BuilderSource, CreatableTable } from "./dataSource";
import { ResolvedPlan, ResolvedWorkstream, StepResult, WorkstreamOutcome, WorkstreamResult } from "./model";
import { capacityLinkPayload, channelPayload, languageSettingPayload, ttsVoicePayload, workstreamPayload } from "./payload";

// Creates the plan one workstream at a time, one record at a time, in dependency order:
//   workstream → capacity profile link → for each channel: channel → TTS voice → language setting.
// A failure stops that workstream (later records depend on earlier ones) and is reported with every
// record that was already created, so the admin knows exactly what exists. Other workstreams still
// run. Nothing is deleted automatically: removing half-built records is left to the admin, with links.

export interface ExecuteProgress {
  done: number;
  total: number;
  message: string;
}

interface PlannedStep {
  table: CreatableTable;
  label: string;
  name: string;
  run: (ids: Map<string, string>) => Promise<string>;
  key: string;
}

export const STEP_LABELS: Record<CreatableTable, string> = {
  workstream: "Workstream",
  capacityLink: "Capacity profile link",
  channel: "Voice channel",
  ttsVoice: "Text-to-speech voice",
  languageSetting: "Channel language"
};

function plannedSteps(ws: ResolvedWorkstream, source: BuilderSource): PlannedStep[] {
  const need = (ids: Map<string, string>, key: string) => {
    const id = ids.get(key);
    if (!id) throw new Error(`Internal: ${key} wasn't created.`);
    return id;
  };
  const steps: PlannedStep[] = [
    { table: "workstream", label: STEP_LABELS.workstream, name: ws.name, key: "ws", run: () => source.create("workstream", workstreamPayload(ws)) }
  ];
  const profile = ws.refs.capacityProfile;
  if (ws.capacityFormat === "Profile" && profile) {
    steps.push({ table: "capacityLink", label: STEP_LABELS.capacityLink, name: profile.name, key: "cap", run: (ids) => source.create("capacityLink", capacityLinkPayload(need(ids, "ws"), profile)) });
  }
  ws.channels.forEach((ch, i) => {
    steps.push({ table: "channel", label: STEP_LABELS.channel, name: ch.phoneNumber ? `${ch.name} (${ch.phoneNumber})` : `${ch.name} (no number yet)`, key: `ch${i}`, run: (ids) => source.create("channel", channelPayload(need(ids, "ws"), ch)) });
    if (ch.ttsVoice) steps.push({ table: "ttsVoice", label: STEP_LABELS.ttsVoice, name: ch.ttsVoice, key: `tts${i}`, run: () => source.create("ttsVoice", ttsVoicePayload(ch)) });
    steps.push({ table: "languageSetting", label: STEP_LABELS.languageSetting, name: `${ch.name} – ${ch.refs.language?.localeCode ?? ch.language}`, key: `lang${i}`, run: (ids) => source.create("languageSetting", languageSettingPayload(need(ids, `ch${i}`), ch, ids.get(`tts${i}`))) });
  });
  return steps;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

export async function executePlan(plan: ResolvedPlan, source: BuilderSource, onProgress?: (p: ExecuteProgress) => void): Promise<WorkstreamResult[]> {
  const all = plan.workstreams.map((ws) => ({ ws, steps: plannedSteps(ws, source) }));
  const total = all.reduce((n, w) => n + w.steps.length, 0);
  let done = 0;
  const results: WorkstreamResult[] = [];

  for (const { ws, steps } of all) {
    const ids = new Map<string, string>();
    const stepResults: StepResult[] = [];
    let failed = false;
    for (const step of steps) {
      if (failed) {
        stepResults.push({ table: step.table, label: step.label, name: step.name, status: "skipped" });
        done++;
        continue;
      }
      onProgress?.({ done, total, message: `${ws.name}: creating ${step.label.toLowerCase()} "${step.name}"` });
      try {
        const id = await step.run(ids);
        ids.set(step.key, id);
        stepResults.push({ table: step.table, label: step.label, name: step.name, status: "created", id, at: new Date().toISOString() });
      } catch (error) {
        failed = true;
        stepResults.push({ table: step.table, label: step.label, name: step.name, status: "failed", error: errorMessage(error), at: new Date().toISOString() });
      }
      done++;
    }

    const created = stepResults.filter((s) => s.status === "created").length;
    const outcome: WorkstreamOutcome = !failed ? "created" : created ? "partial" : "failed";
    const notes: string[] = [];
    if (failed && created) notes.push("Stopped at the failed record. The records marked Created exist in the environment: fix the cause, then finish this workstream in the admin center or delete them and run the row again.");
    const workstreamId = ids.get("ws");
    if (workstreamId && ws.direction === "Inbound") {
      // The platform completes a new workstream (routing contract, templates, record identification)
      // but doesn't give it a routing configuration: the admin center only creates one when routing
      // rules are set up (confirmed live, 2026-10-01). Say so for inbound workstreams, since they can't
      // route by rules until then. Outbound workstreams (outbound profiles) don't use routing rules: the
      // admin center's own outbound profile has no routing configuration.
      const count = await source.countRoutingConfigurations(workstreamId).catch(() => undefined);
      if (count === 0) notes.push("No routing rules yet. Open the workstream in the admin center and set up its routing rules (route to queue) before assigning a number.");
      if (count === undefined) notes.push("Couldn't check whether a routing configuration was created. Open the workstream in the admin center to confirm.");
    }
    ws.channels.forEach((ch, i) => {
      if (!ch.phoneNumber && ids.has(`ch${i}`)) notes.push(`"${ch.name}" has no phone number yet. Assign one in the admin center when it's available.`);
    });
    results.push({ name: ws.name, outcome, steps: stepResults, notes });
  }
  onProgress?.({ done: total, total, message: "Done" });
  return results;
}
