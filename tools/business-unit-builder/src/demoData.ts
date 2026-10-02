import { Catalog } from "./model";
import { UnitSource } from "./dataSource";

// An in-memory sample environment: a root business unit with a few children, one of them disabled.
// Created business units are remembered for the session, so running the same CSV twice shows the
// "already exists" check. Every parent in the example CSV exists here.

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const CATALOG: Catalog = {
  units: [
    { id: id(1), name: "Contoso", disabled: false },
    { id: id(2), name: "Sales", parentId: id(1), disabled: false },
    { id: id(3), name: "Service", parentId: id(1), disabled: false },
    { id: id(4), name: "Legacy", parentId: id(1), disabled: true }
  ]
};

let catalog: Catalog = JSON.parse(JSON.stringify(CATALOG));
let counter = 1000;

export function resetDemo(): void {
  catalog = JSON.parse(JSON.stringify(CATALOG));
  counter = 1000;
}

export const demoSource: UnitSource = {
  mode: "demo",
  async loadCatalog() {
    return JSON.parse(JSON.stringify(catalog));
  },
  async createUnit(payload) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    const newId = id(counter++);
    const parent = String(payload["parentbusinessunitid@odata.bind"] ?? "").match(/\(([^)]+)\)/)?.[1];
    catalog.units.push({ id: newId, name: String(payload.name), parentId: parent, disabled: false });
    return newId;
  },
  // Like the platform, every new business unit gets a default team.
  async hasDefaultTeam() {
    return true;
  },
  recordUrl() {
    return undefined;
  },
  currentUser() {
    return "Sample user";
  }
};
