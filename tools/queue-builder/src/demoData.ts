import { Catalog } from "./model";
import { QueueSource } from "./dataSource";

// An in-memory sample environment for the offline demo. Created queues are remembered for the session,
// so running the same CSV twice shows the "already exists" check. Every name in the example CSV exists
// here.

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const CATALOG: Catalog = {
  queueNames: ["Default messaging queue", "Default entity queue", "Contoso Voice", "Contoso Voice Fallback"],
  operatingHours: [{ id: id(30), name: "Workdays" }, { id: id(31), name: "24/7" }],
  users: [
    { id: id(100), fullName: "Anna de Vries", signIn: "anna@contoso.com", email: "anna@contoso.com", disabled: false },
    { id: id(101), fullName: "Bram Jansen", signIn: "bram@contoso.com", email: "bram@contoso.com", disabled: false },
    { id: id(102), fullName: "Chris Peters", signIn: "chris@contoso.com", email: "chris@contoso.com", disabled: false },
    { id: id(103), fullName: "Dana Smit", signIn: "dana@contoso.com", email: "dana.smit@contoso.com", disabled: false },
    { id: id(104), fullName: "Eva Mulder", signIn: "eva@contoso.com", email: "eva@contoso.com", disabled: true }
  ]
};

let catalog: Catalog = JSON.parse(JSON.stringify(CATALOG));
let counter = 1000;

export function resetDemo(): void {
  catalog = JSON.parse(JSON.stringify(CATALOG));
  counter = 1000;
}

export const demoSource: QueueSource = {
  mode: "demo",
  async loadCatalog() {
    return JSON.parse(JSON.stringify(catalog));
  },
  async createQueue(payload) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    catalog.queueNames.push(String(payload.name));
    return id(counter++);
  },
  async addMember() {
    await new Promise((resolve) => setTimeout(resolve, 30));
  },
  // The sample environment behaves like the live one: the platform adds the decision contract.
  async hasAssignmentContract() {
    return true;
  },
  recordUrl() {
    return undefined;
  },
  currentUser() {
    return "Sample user";
  }
};
