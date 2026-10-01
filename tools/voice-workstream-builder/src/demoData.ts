import { BuilderSource, CreatableTable } from "./dataSource";
import { Catalog } from "./model";
import { NAV } from "./voiceSchema";

// An in-memory sample environment for the offline demo. Creates are kept in memory for the session,
// so running the same CSV twice shows the "already exists" check. The template's example rows resolve
// against it without errors; the tests change it to show how problems are reported.

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const CATALOG: Catalog = {
  queues: [
    { id: id(1), name: "Sales Fallback" },
    { id: id(2), name: "Support Fallback" },
    { id: id(3), name: "Callbacks" },
    { id: id(4), name: "Escalations" },
    { id: id(7), name: "Claims Fallback" },
    // Two queues share a name, to show the ambiguity check.
    { id: id(5), name: "Billing" },
    { id: id(6), name: "Billing" }
  ],
  capacityProfiles: [
    { id: id(20), name: "Default voice inbound", uniqueName: "msdyn_voice_inbound_profile" },
    { id: id(21), name: "Default voice outbound", uniqueName: "msdyn_voice_default_outbound_profile" },
    { id: id(22), name: "Escalation profile", uniqueName: "msdyn_escalationprofile" }
  ],
  operatingHours: [{ id: id(30), name: "Workdays" }, { id: id(31), name: "24/7" }],
  phoneNumbers: [
    { id: id(40), number: "+31201234567", active: true, inbound: true, outbound: true },
    { id: id(41), number: "+31207654321", active: false, inbound: true, outbound: false },
    { id: id(42), number: "+13159956114", active: true, inbound: true, outbound: true },
    { id: id(43), number: "+18005550100", active: true, inbound: false, outbound: true },
    { id: id(44), number: "+31201234568", active: true, inbound: true, outbound: true }
  ],
  languages: [
    { id: id(50), name: "English - United States", localeCode: "en-US" },
    { id: id(51), name: "English - United Kingdom", localeCode: "en-GB" },
    { id: id(52), name: "Dutch - Netherlands", localeCode: "nl-NL" },
    { id: id(53), name: "Dutch - Belgium", localeCode: "nl-BE" },
    { id: id(54), name: "German - Germany", localeCode: "de-DE" },
    { id: id(55), name: "French - France", localeCode: "fr-FR" }
  ],
  music: ["Anthem", "Beep", "Transform", "Compose", "Parallel", "Personalize", "Deep Vision", "Tree Line", "Rising Sun"].map((name, i) => ({ id: id(60 + i), name })),
  workstreams: [
    { id: id(80), name: "Contoso Voice" },
    { id: id(81), name: "Contoso Voice Sales" }
  ],
  channels: [
    { id: id(90), name: "Contoso Voice Channel", phoneNumberId: id(42), workstreamName: "Contoso Voice" },
    { id: id(91), name: "Contoso Voice Sales", workstreamName: "Contoso Voice Sales" }
  ]
};

let catalog: Catalog = JSON.parse(JSON.stringify(CATALOG));
let counter = 1000;

export function resetDemo(): void {
  catalog = JSON.parse(JSON.stringify(CATALOG));
  counter = 1000;
}

function boundId(payload: Record<string, unknown>, nav: string): string | undefined {
  const value = payload[`${nav}@odata.bind`];
  return typeof value === "string" ? value.match(/\(([^)]+)\)/)?.[1] : undefined;
}

export const demoSource: BuilderSource = {
  mode: "demo",
  async loadCatalog() {
    return JSON.parse(JSON.stringify(catalog));
  },
  async create(table: CreatableTable, payload: Record<string, unknown>) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    const newId = id(counter++);
    const name = String(payload.msdyn_name ?? "");
    if (table === "workstream") catalog.workstreams.push({ id: newId, name });
    if (table === "channel") {
      const workstreamId = boundId(payload, NAV.channel.workstream);
      catalog.channels.push({ id: newId, name, phoneNumberId: boundId(payload, NAV.channel.phoneNumber), workstreamName: catalog.workstreams.find((w) => w.id === workstreamId)?.name });
    }
    return newId;
  },
  // Like the live platform, nothing creates a routing configuration for a new workstream.
  async countRoutingConfigurations() {
    return 0;
  },
  recordUrl() {
    return undefined;
  },
  currentUser() {
    return "Sample user";
  }
};
