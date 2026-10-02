import { Catalog } from "./model";

// What the business unit builder needs from an environment. dataverse.ts implements it against the
// live org; demoData.ts in memory for the offline demo.
export interface UnitSource {
  mode: "live" | "demo";
  loadCatalog(): Promise<Catalog>;
  // Creates one business unit and returns its id.
  createUnit(payload: Record<string, unknown>): Promise<string>;
  // Whether the platform gave the new business unit its default team; undefined when it can't be read.
  hasDefaultTeam(unitId: string): Promise<boolean | undefined>;
  recordUrl(unitId: string): string | undefined;
  currentUser(): string;
}

export const UNIT_TABLE = "businessunit";
export const UNIT_ENTITY_SET = "businessunits";
export const PARENT_NAV = "parentbusinessunitid";
