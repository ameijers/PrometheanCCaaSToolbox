// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { cellText, idOf, lookupId, text } from "./columns";
import { Row, Snapshot, SnapshotTable } from "./model";
import { RulesetText, rulesetText } from "./rules";
import { SECTIONS } from "./tables";

// What the PDF document shows, worked out from a snapshot. Pure: the page (Document.tsx) only lays it
// out. Everything here is also in the Excel workbook, which has every column of every table.

export type Field = [string, string];

export interface RulesetBlock {
  title: string;       // "Route to queue: Sales route", "Pre-queue overflow"
  ruleset?: string;
  text: RulesetText | null;
}

export interface WorkstreamDoc {
  id: string;
  name: string;
  kind: string;        // channel, e.g. "Voice"
  direction: string;
  distribution: string;
  queues: string[];    // where it sends work: fallback and outbound queues, and every queue its rules name
  fields: Field[];
  channels: { name: string; fields: Field[]; languages: string[] }[];
  variables: Field[];
  capacityProfiles: string[];
  routing: RulesetBlock[];
  routingNote?: string;
}

export interface QueueDoc {
  id: string;
  name: string;
  type: string;
  assignment: string;
  hours: string;
  fields: Field[];
  usedBy: string[];
  methods: { name: string; active: boolean; rulesets: RulesetBlock[] }[];
  overflow: RulesetBlock[];
  members: string[];
}

export interface AgentDoc {
  name: string;
  disabled: boolean;
  fields: Field[];
  queues: string[];
  skills: string[];
  capacityProfiles: string[];
  roles: string[];
  teams: string[];
}

export interface ListBlock {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface TableSummary {
  section: string;
  label: string;
  logicalName: string;
  rows: number;
  status: string;
}

export interface SnapshotDocument {
  title: string;
  environment: string;
  takenAt: string;
  takenBy: string;
  sample: boolean;
  totals: { label: string; value: number }[];
  workstreams: WorkstreamDoc[];
  queues: QueueDoc[];
  agents: AgentDoc[];
  lists: ListBlock[];
  tables: TableSummary[];
  leftOut: string[];
  warnings: string[];
}

const STATUS_TEXT: Record<SnapshotTable["status"], string> = { ok: "Read", notFound: "Not in this environment", noPermission: "No permission", error: "Couldn't be read" };

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const sortText = (values: string[]) => unique(values).sort((a, b) => a.localeCompare(b));

export function buildDocument(snapshot: Snapshot): SnapshotDocument {
  const table = (logicalName: string) => snapshot.tables.find((t) => t.logicalName === logicalName);
  const rows = (logicalName: string) => table(logicalName)?.rows ?? [];

  // Every record's name by id, to word rules and links.
  const names = new Map<string, string>();
  snapshot.tables.forEach((t) => {
    if (!t.idKey || !t.nameKey) return;
    t.rows.forEach((r) => { const id = idOf(r, t.idKey); const name = r[t.nameKey!]; if (id && typeof name === "string" && name) names.set(id, name); });
  });

  // [label, value] for the given columns that exist and have a value, with the table's own labels.
  const fields = (logicalName: string, row: Row, keys: string[]): Field[] => {
    const t = table(logicalName);
    return keys.flatMap((key): Field[] => {
      const column = t?.columns.find((c) => c.key === key);
      if (!column) return [];
      const value = cellText(row, column);
      return value ? [[column.label, value]] : [];
    });
  };

  const rulesets = new Map(rows("msdyn_decisionruleset").map((r) => [idOf(r, "msdyn_decisionrulesetid")!, r]));
  // Context variables by their display names, for rules outside a workstream (assignment rules).
  const variableLabels = Object.fromEntries(rows("msdyn_ocliveworkstreamcontextvariable").filter((v) => text(v, "msdyn_displayname")).map((v) => [text(v, "msdyn_name"), text(v, "msdyn_displayname")]));
  const rulesetBlock = (title: string, rulesetId: string | undefined, labels: Record<string, string> = variableLabels): RulesetBlock | undefined => {
    if (!rulesetId) return undefined;
    const r = rulesets.get(rulesetId);
    if (!r) return { title, text: null, ruleset: names.get(rulesetId) };
    return { title, ruleset: text(r, "msdyn_name"), text: rulesetText(r.msdyn_rulesetdefinition, r.msdyn_disabledrules, names, labels) };
  };

  // Workstreams
  const variables = rows("msdyn_ocliveworkstreamcontextvariable");
  const channels = rows("msdyn_ocvoicechannelsetting");
  const languages = rows("msdyn_ocvoicechannellanguagesetting");
  const configurations = rows("msdyn_routingconfiguration");
  const steps = rows("msdyn_routingconfigurationstep");
  const queueRows = rows("queue");
  const queueIds = new Set(queueRows.map((q) => idOf(q, "queueid")!));
  const usedBy = new Map<string, string[]>();
  const workstreams: WorkstreamDoc[] = rows("msdyn_liveworkstream").map((w) => {
    const id = idOf(w, "msdyn_liveworkstreamid")!;
    const name = text(w, "msdyn_name");
    const own = (r: Row, column: string) => lookupId(r, column) === id;
    const labels = Object.fromEntries(variables.filter((v) => own(v, "msdyn_liveworkstreamid")).flatMap((v) => [[text(v, "msdyn_name"), text(v, "msdyn_displayname") || text(v, "msdyn_name")]]));
    const configuration = configurations.filter((c) => own(c, "msdyn_liveworkstreamid")).sort((a, b) => Number(b.msdyn_isactiveconfiguration === true) - Number(a.msdyn_isactiveconfiguration === true))[0];
    const routing: RulesetBlock[] = configuration
      ? steps.filter((s) => lookupId(s, "msdyn_routingconfigurationid") === idOf(configuration, "msdyn_routingconfigurationid"))
        .sort((a, b) => Number(a.msdyn_steporder ?? 0) - Number(b.msdyn_steporder ?? 0))
        .map((s) => rulesetBlock(`${text(s, "msdyn_type") || "Step"}: ${text(s, "msdyn_name")}`, lookupId(s, "msdyn_rulesetid"), labels))
        .filter((b): b is RulesetBlock => !!b)
      : [];
    // Which queues this workstream sends work to: its fallback and outbound queues, and every queue its rules name.
    const targets = new Set<string>([lookupId(w, "msdyn_defaultqueue"), lookupId(w, "msdyn_outboundqueueid")].filter((q): q is string => !!q));
    if (configuration) steps.filter((s) => lookupId(s, "msdyn_routingconfigurationid") === idOf(configuration, "msdyn_routingconfigurationid")).forEach((s) => {
      const definition = String(rulesets.get(lookupId(s, "msdyn_rulesetid") ?? "")?.msdyn_rulesetdefinition ?? "");
      (definition.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).forEach((g) => { if (queueIds.has(g.toLowerCase())) targets.add(g.toLowerCase()); });
    });
    targets.forEach((q) => usedBy.set(q, [...(usedBy.get(q) ?? []), name]));
    return {
      id, name,
      kind: text(w, "msdyn_streamsource") || "Workstream",
      direction: text(w, "msdyn_direction"),
      distribution: text(w, "msdyn_workdistributionmode"),
      queues: sortText([...targets].map((q) => names.get(q) ?? q)),
      fields: fields("msdyn_liveworkstream", w, ["msdyn_streamsource", "msdyn_direction", "statecode", "msdyn_mode", "msdyn_workdistributionmode", "msdyn_capacityformat", "msdyn_capacityrequired",
        "msdyn_allowedpresences", "msdyn_autocloseafterinactivity", "msdyn_notification", "msdyn_screenpoptimeout", "msdyn_matchinglogic", "msdyn_enableagentaffinity", "msdyn_blockcapacityforwrapup",
        "_msdyn_defaultqueue_value", "_msdyn_outboundqueueid_value", "_msdyn_bot_user_value", "msdyn_enableautomatedmessages", "msdyn_fallbacklanguage", "msdyn_recordingmode", "msdyn_transcriptionmode"]),
      channels: channels.filter((c) => own(c, "msdyn_liveworkstreamid")).map((c) => ({
        name: text(c, "msdyn_name"),
        fields: fields("msdyn_ocvoicechannelsetting", c, ["_msdyn_phonenumberid_value", "_msdyn_calleridphonenumberid_value", "msdyn_calleridname", "_msdyn_operatinghoursid_value", "statecode",
          "msdyn_transcriptionenabled", "msdyn_transcriptionmode", "msdyn_recordingenabled", "msdyn_recordingmode", "msdyn_usebridgetransferforpstntransfer", "msdyn_usebridgetransferforteamstransfer"]),
        languages: languages.filter((l) => lookupId(l, "msdyn_ocvoicechannelsettingid") === idOf(c, "msdyn_ocvoicechannelsettingid"))
          .map((l) => [text(l, "_msdyn_languageid_value"), text(l, "_msdyn_ocvoiceid_value") && `voice ${text(l, "_msdyn_ocvoiceid_value")}`, text(l, "_msdyn_holdmusicid_value") && `hold music ${text(l, "_msdyn_holdmusicid_value")}`].filter(Boolean).join(", "))
      })),
      variables: variables.filter((v) => own(v, "msdyn_liveworkstreamid")).map((v): Field => [text(v, "msdyn_displayname") || text(v, "msdyn_name"), [text(v, "msdyn_datatype"), text(v, "msdyn_name")].filter(Boolean).join(" · ")]),
      capacityProfiles: sortText(rows("msdyn_liveworkstreamcapacityprofile").filter((l) => own(l, "msdyn_workstream_id")).map((l) => text(l, "_msdyn_capacityprofile_id_value"))),
      routing,
      routingNote: configuration ? undefined : "No routing configuration: routing rules haven't been set up for this workstream."
    };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  // Agents' names, for queues and the agents list.
  const queueMembers = table("queuemembership")?.rows ?? [];
  const queues: QueueDoc[] = queueRows.map((q) => {
    const id = idOf(q, "queueid")!;
    const methods = rows("msdyn_assignmentconfiguration").filter((m) => lookupId(m, "msdyn_queueid") === id).map((m) => ({
      name: text(m, "msdyn_name"),
      active: m.msdyn_isactiveconfiguration === true,
      rulesets: rows("msdyn_assignmentconfigurationstep").filter((s) => lookupId(s, "msdyn_assignmentconfigurationid") === idOf(m, "msdyn_assignmentconfigurationid"))
        .sort((a, b) => Number(a.msdyn_steporder ?? 0) - Number(b.msdyn_steporder ?? 0))
        .map((s) => rulesetBlock(`${text(s, "msdyn_type") || "Step"}: ${text(s, "msdyn_name")}`, lookupId(s, "msdyn_rulesetid")))
        .filter((b): b is RulesetBlock => !!b)
    }));
    return {
      id,
      name: text(q, "name"),
      type: text(q, "msdyn_queuetype"),
      assignment: text(q, "msdyn_assignmentstrategy"),
      hours: text(q, "_msdyn_operatinghourid_value"),
      fields: fields("queue", q, ["msdyn_queuetype", "msdyn_assignmentstrategy", "msdyn_priority", "_msdyn_operatinghourid_value", "statecode", "msdyn_isdefaultqueue", "description"]),
      usedBy: sortText(usedBy.get(id) ?? []),
      methods,
      overflow: [rulesetBlock("Pre-queue overflow", lookupId(q, "msdyn_prequeueoverflowrulesetid")), rulesetBlock("In-queue overflow", lookupId(q, "msdyn_inqueueoverflowrulesetid"))].filter((b): b is RulesetBlock => !!b),
      members: sortText(queueMembers.filter((m) => m.queueid === id).map((m) => String(m.agent ?? "")))
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Agents: the interactive users the configuration points to.
  const resources = rows("bookableresource");
  const resourceOf = new Map(resources.map((r) => [lookupId(r, "userid") ?? "", idOf(r, "bookableresourceid")!]));
  const derivedRows = (logicalName: string) => table(logicalName)?.rows ?? [];
  // Built-in accounts (SYSTEM, INTEGRATION) can be members of the platform's own queues; they aren't agents.
  const builtIn = (u: Row) => !text(u, "domainname") || ["SYSTEM", "INTEGRATION"].includes(text(u, "fullname").toUpperCase());
  const agents: AgentDoc[] = rows("systemuser").filter((u) => (u.accessmode === undefined || u.accessmode === 0) && !builtIn(u)).map((u) => {
    const userId = idOf(u, "systemuserid")!;
    const resource = resourceOf.get(userId);
    return {
      name: text(u, "fullname") || text(u, "domainname"),
      disabled: u.isdisabled === true,
      fields: fields("systemuser", u, ["domainname", "_businessunitid_value", "title"]),
      queues: sortText(queueMembers.filter((m) => m.systemuserid === userId).map((m) => String(m.queue ?? ""))),
      skills: sortText(rows("bookableresourcecharacteristic").filter((s) => resource && lookupId(s, "resource") === resource)
        .map((s) => [text(s, "_characteristic_value"), text(s, "_ratingvalue_value")].filter(Boolean).join(" · "))),
      capacityProfiles: sortText(rows("msdyn_bookableresourcecapacityprofile").filter((c) => resource && lookupId(c, "msdyn_bookableresourceid") === resource).map((c) => text(c, "_msdyn_capacityprofileid_value"))),
      roles: sortText(derivedRows("systemuserroles").filter((r) => r.systemuserid === userId).map((r) => String(r.role ?? ""))),
      teams: sortText(derivedRows("teammembership").filter((r) => r.systemuserid === userId).map((r) => String(r.team ?? "")))
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Shorter lists.
  const channelsByNumber = (numberId: string) => sortText(channels.filter((c) => lookupId(c, "msdyn_phonenumberid") === numberId).map((c) => text(c, "msdyn_name")));
  const lists: ListBlock[] = [
    {
      title: "Phone numbers",
      columns: ["Number", "Inbound", "Outbound", "Status", "Voice channels"],
      rows: rows("msdyn_ocphonenumber").map((n) => [text(n, "msdyn_phonenumber"), text(n, "msdyn_phoneinboundenabled"), text(n, "msdyn_phoneoutboundenabled"), text(n, "statecode"), channelsByNumber(idOf(n, "msdyn_ocphonenumberid")!).join(", ")])
        .sort((a, b) => a[0].localeCompare(b[0]))
    },
    {
      title: "Capacity profiles",
      columns: ["Capacity profile", "Workstreams", "Agents"],
      rows: rows("msdyn_capacityprofile").map((c) => {
        const id = idOf(c, "msdyn_capacityprofileid")!;
        return [text(c, "msdyn_name"),
          String(rows("msdyn_liveworkstreamcapacityprofile").filter((l) => lookupId(l, "msdyn_capacityprofile_id") === id).length),
          String(rows("msdyn_bookableresourcecapacityprofile").filter((l) => lookupId(l, "msdyn_capacityprofileid") === id).length)];
      }).sort((a, b) => a[0].localeCompare(b[0]))
    },
    {
      title: "Skills",
      columns: ["Skill", "Type", "Agents"],
      rows: rows("characteristic").map((s) => [text(s, "name"), text(s, "characteristictype"),
        String(rows("bookableresourcecharacteristic").filter((r) => lookupId(r, "characteristic") === idOf(s, "characteristicid")).length)]).sort((a, b) => a[0].localeCompare(b[0]))
    },
    {
      title: "Rating models",
      columns: ["Rating model", "Values"],
      rows: rows("ratingmodel").map((m) => [text(m, "name"), rows("ratingvalue").filter((v) => lookupId(v, "ratingmodel") === idOf(m, "ratingmodelid"))
        .sort((a, b) => Number(a.value ?? 0) - Number(b.value ?? 0)).map((v) => text(v, "name")).join(", ")]).sort((a, b) => a[0].localeCompare(b[0]))
    },
    {
      title: "Operating hours",
      columns: ["Operating hours", "Queues", "Voice channels"],
      rows: rows("msdyn_operatinghour").map((h) => {
        const id = idOf(h, "msdyn_operatinghourid")!;
        return [text(h, "msdyn_name"), sortText(queueRows.filter((q) => lookupId(q, "msdyn_operatinghourid") === id).map((q) => text(q, "name"))).join(", "),
          sortText(channels.filter((c) => lookupId(c, "msdyn_operatinghoursid") === id).map((c) => text(c, "msdyn_name"))).join(", ")];
      }).sort((a, b) => a[0].localeCompare(b[0]))
    },
    {
      title: "Record routing",
      columns: ["Name", "Table", "Status"],
      rows: rows("msdyn_masterentityroutingconfiguration").map((r) => [text(r, "msdyn_name"), text(r, "msdyn_entitylogicalname"), text(r, "statecode")]).sort((a, b) => a[0].localeCompare(b[0]))
    },
    {
      title: "Presence",
      columns: ["Presence", "Base status", "Status"],
      rows: rows("msdyn_presence").map((p) => [text(p, "msdyn_name"), text(p, "msdyn_basepresencestatus"), text(p, "statecode")]).sort((a, b) => a[0].localeCompare(b[0]))
    },
    {
      title: "Business units and teams",
      columns: ["Name", "Kind", "Business unit"],
      rows: [
        ...rows("businessunit").map((b) => [text(b, "name"), "Business unit", text(b, "_parentbusinessunitid_value")]),
        ...rows("team").filter((t) => t.isdefault !== true).map((t) => [text(t, "name"), `Team${text(t, "teamtype") ? ` (${text(t, "teamtype")})` : ""}`, text(t, "_businessunitid_value")])
      ]
    }
  ].filter((l) => l.rows.length);

  const sectionTitle = new Map(SECTIONS.map((s) => [s.id, s.title]));
  const tables: TableSummary[] = snapshot.tables.map((t) => ({ section: sectionTitle.get(t.section) ?? t.section, label: t.label, logicalName: t.logicalName, rows: t.rows.length, status: STATUS_TEXT[t.status] }));
  const leftOut = snapshot.tables.flatMap((t) => t.leftOut.map((c) => `${t.label}: ${c}`));

  return {
    title: "Contact center configuration",
    environment: snapshot.environment,
    takenAt: snapshot.takenAt,
    takenBy: snapshot.takenBy,
    sample: snapshot.mode === "demo",
    totals: [
      { label: "Workstreams", value: workstreams.length },
      { label: "Queues", value: queues.length },
      { label: "Agents", value: agents.length },
      { label: "Phone numbers", value: rows("msdyn_ocphonenumber").length },
      { label: "Routing rulesets", value: rows("msdyn_decisionruleset").length },
      { label: "Tables read", value: snapshot.tables.filter((t) => t.status === "ok").length }
    ],
    workstreams, queues, agents, lists, tables, leftOut,
    warnings: snapshot.warnings
  };
}
