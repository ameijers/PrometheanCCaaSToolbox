import { PARENT_NAV, UNIT_ENTITY_SET, UnitSource } from "./dataSource";
import { Plan, PlannedUnit, UnitResult } from "./model";
import { parentLabel } from "./plan";

// Creates the business units in plan order (every parent before its children). A unit whose parent
// failed or was skipped is skipped too, since it has nowhere to go; everything else continues. Nothing
// is ever deleted.

export interface ExecuteProgress {
  done: number;
  total: number;
  message: string;
}

export function unitPayload(unit: PlannedUnit, parentId: string): Record<string, unknown> {
  return { ...unit.fields, [`${PARENT_NAV}@odata.bind`]: `/${UNIT_ENTITY_SET}(${parentId})` };
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

export async function executePlan(plan: Plan, source: UnitSource, onProgress?: (p: ExecuteProgress) => void): Promise<UnitResult[]> {
  const created = new Map<string, string>();
  const results: UnitResult[] = [];
  const total = plan.units.length;

  for (let i = 0; i < plan.units.length; i++) {
    const unit = plan.units[i];
    const parentName = parentLabel(unit, plan);
    const parentId = unit.parent?.kind === "existing" ? unit.parent.unit.id : unit.parent ? created.get(unit.parent.key) : undefined;
    if (!parentId) {
      results.push({ name: unit.name, parentName, status: "skipped", error: `Not created because its parent "${parentName}" wasn't created.`, notes: [] });
      continue;
    }
    onProgress?.({ done: i, total, message: `Creating "${unit.name}" under "${parentName}"` });
    try {
      const id = await source.createUnit(unitPayload(unit, parentId));
      created.set(unit.key, id);
      const notes: string[] = [];
      // The platform gives every business unit a default team (and its own copy of each security role).
      const team = await source.hasDefaultTeam(id).catch(() => undefined);
      if (team === false) notes.push("No default team was found for this business unit. Check it in the Power Platform admin center.");
      if (team === undefined) notes.push("Couldn't check the business unit's default team.");
      results.push({ name: unit.name, parentName, status: "created", id, at: new Date().toISOString(), notes });
    } catch (error) {
      results.push({ name: unit.name, parentName, status: "failed", error: errorMessage(error), at: new Date().toISOString(), notes: [] });
    }
  }
  onProgress?.({ done: total, total, message: "Done" });
  return results;
}
