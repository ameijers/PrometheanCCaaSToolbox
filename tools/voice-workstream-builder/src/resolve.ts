import { Catalog, Issue, NamedRecord, ParsedPlan, ResolvedChannel, ResolvedPlan, ResolvedWorkstream } from "./model";
import { DEFAULT_CAPACITY_PROFILE } from "./voiceSchema";

// Matches every name in the parsed CSV to a record the environment already holds, and catches what
// can only be known with the environment in hand: a workstream that already exists, a queue name two
// queues share, a number that's inactive or not enabled for the direction. Pure: the catalog is read
// beforehand (dataverse.ts / demoData.ts).

type Find<T> = { record?: T; problem?: string };

function findByName<T extends NamedRecord>(records: T[], name: string, kind: string, extraKeys: (r: T) => (string | undefined)[] = () => []): Find<T> {
  const wanted = name.trim().toLowerCase();
  const matches = records.filter((r) => [r.name, ...extraKeys(r)].some((k) => k?.trim().toLowerCase() === wanted));
  if (matches.length === 1) return { record: matches[0] };
  if (matches.length > 1) return { problem: `${matches.length} ${kind} records are named "${name}", so it's not clear which one is meant. Rename one of them first.` };
  return { problem: `No ${kind} named "${name}" exists in this environment.` };
}

export function resolvePlan(parsed: ParsedPlan, catalog: Catalog): ResolvedPlan {
  const issues: Issue[] = [...parsed.issues];
  const existingWorkstreams = new Set(catalog.workstreams.map((w) => w.name.trim().toLowerCase()));
  const existingChannels = new Map(catalog.channels.map((c) => [c.name.trim().toLowerCase(), c]));
  const channelsByNumber = new Map<string, string[]>();
  catalog.channels.forEach((c) => { if (c.phoneNumberId) channelsByNumber.set(c.phoneNumberId, [...(channelsByNumber.get(c.phoneNumberId) ?? []), c.name]); });

  const workstreams: ResolvedWorkstream[] = parsed.workstreams.map((ws) => {
    const firstLine = ws.lines[0];
    const error = (column: string | undefined, message: string, line = firstLine) => issues.push({ severity: "error", line, column, workstream: ws.name, message });
    const warning = (column: string | undefined, message: string, line = firstLine) => issues.push({ severity: "warning", line, column, workstream: ws.name, message });
    const refs: ResolvedWorkstream["refs"] = {};

    if (existingWorkstreams.has(ws.key)) error("workstream_name", `A workstream named "${ws.name}" already exists. This tool only creates new workstreams; rename the row or remove it.`);

    if (ws.defaultQueue) {
      const found = findByName(catalog.queues, ws.defaultQueue, "queue");
      if (found.record) refs.defaultQueue = found.record.id; else error("default_queue", found.problem!);
    }
    if (ws.outboundQueue && ws.direction === "Outbound") {
      const found = findByName(catalog.queues, ws.outboundQueue, "queue");
      if (found.record) refs.outboundQueue = found.record.id; else error("outbound_queue", found.problem!);
    }
    if (ws.capacityFormat === "Profile") {
      const wanted = ws.capacityProfile ?? DEFAULT_CAPACITY_PROFILE[ws.direction];
      const found = findByName(catalog.capacityProfiles, wanted, "capacity profile", (p) => [p.uniqueName]);
      if (found.record) refs.capacityProfile = { id: found.record.id, name: found.record.name };
      else error("capacity_profile", ws.capacityProfile ? found.problem! : `The admin center's default capacity profile (${wanted}) wasn't found. Set capacity_profile to a profile that exists.`);
    }

    const channels: ResolvedChannel[] = ws.channels.map((ch) => {
      const chRefs: ResolvedChannel["refs"] = {};
      const chError = (column: string, message: string) => error(column, message, ch.line);
      const chWarning = (column: string, message: string) => warning(column, message, ch.line);

      const existing = existingChannels.get(ch.name.trim().toLowerCase());
      if (existing) chWarning("channel_name", `A voice channel named "${ch.name}" already exists${existing.workstreamName ? ` (on "${existing.workstreamName}")` : ""}. A second one will be created with the same name.`);

      if (ch.phoneNumber) {
        const number = catalog.phoneNumbers.find((p) => p.number === ch.phoneNumber);
        if (!number) chError("phone_number", `${ch.phoneNumber} isn't a phone number in this environment. Acquire or import it in the admin center first, or leave phone_number blank to create the channel without a number.`);
        else if (!number.active) chError("phone_number", `${ch.phoneNumber} is deactivated in this environment.`);
        else {
          chRefs.phoneNumber = number.id;
          if (ws.direction === "Inbound" && !number.inbound) chWarning("phone_number", `${ch.phoneNumber} isn't enabled for inbound calling.`);
          if (ws.direction === "Outbound" && !number.outbound) chWarning("phone_number", `${ch.phoneNumber} isn't enabled for outbound calling.`);
          const users = channelsByNumber.get(number.id);
          if (users?.length) chWarning("phone_number", `${ch.phoneNumber} is already used by ${users.map((u) => `"${u}"`).join(", ")}.`);
        }
      }

      const language = catalog.languages.find((l) => l.localeCode.toLowerCase() === ch.language.toLowerCase());
      if (language) chRefs.language = language; else chError("language", `"${ch.language}" isn't a language this environment supports. Use a locale code such as en-US or nl-NL.`);

      const music = (name: string | undefined, column: string, key: "holdMusic" | "waitMusic") => {
        if (!name) return;
        const found = findByName(catalog.music, name, "music");
        if (found.record) chRefs[key] = found.record.id; else chError(column, found.problem!);
      };
      music(ch.holdMusic, "hold_music", "holdMusic");
      music(ch.waitMusic, "wait_music", "waitMusic");

      // A caller ID that is the channel's own number shares its lookup (and any problem with it is
      // already reported on phone_number); a different one is checked on its own.
      if (ch.outbound?.callerIdNumber && ch.outbound.callerIdNumber === ch.phoneNumber) {
        chRefs.callerIdNumber = chRefs.phoneNumber;
      } else if (ch.outbound?.callerIdNumber) {
        const number = catalog.phoneNumbers.find((p) => p.number === ch.outbound!.callerIdNumber);
        if (!number) chError("caller_id_number", `${ch.outbound.callerIdNumber} isn't a phone number in this environment. The caller ID must be one of your own numbers.`);
        else if (!number.active) chError("caller_id_number", `${ch.outbound.callerIdNumber} is deactivated in this environment.`);
        else chRefs.callerIdNumber = number.id;
      }

      if (ch.operatingHours) {
        const found = findByName(catalog.operatingHours, ch.operatingHours, "operating hours");
        if (found.record) chRefs.operatingHours = found.record.id; else chError("operating_hours", found.problem!);
      }
      return { ...ch, refs: chRefs };
    });

    return { ...ws, refs, channels };
  });

  return { workstreams, issues, rowCount: parsed.rowCount };
}
