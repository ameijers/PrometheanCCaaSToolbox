import { CapturedValue, ContextVariableDefinition, ContextVariableType, MonitorSnapshot } from "./model";

// msdyn_ocliveworkstreamcontextvariable.msdyn_datatype: 192350000 Text, 192350001 Number,
// 192350002 Boolean, 192350100 Entity Reference — same enum Visual Routing Tester uses, confirmed
// against the same live environment.
export function variableType(datatype: unknown): ContextVariableType {
  if (datatype === 192350001) return "number";
  if (datatype === 192350002) return "boolean";
  if (datatype === 192350100) return "entityReference";
  if (datatype === 192350000) return "text";
  return "unknown";
}

// A captured elastic context item's msdyn_value is a plain string for text/number/boolean, but for
// an entity-reference it's a JSON array like [{"RecordId":"...","PrimaryDisplayValue":"..."}] —
// confirmed against real captured call data. Unwrap it to the human-readable display value.
export function parseDisplayValue(rawValue: string, type: ContextVariableType): string {
  if (type === "entityReference") {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object" && "PrimaryDisplayValue" in parsed[0]) {
        return String((parsed[0] as { PrimaryDisplayValue: unknown }).PrimaryDisplayValue);
      }
    } catch {
      // Not JSON after all — fall through and show the raw value rather than hide it.
    }
  }
  return rawValue;
}

// Captured values are matched back to their variable definition by name (case-insensitive) —
// the elastic table's own lookup to the definition record is null in practice on real calls, and
// condition XML already references variables by name, not id, so this matches established
// convention rather than introducing a new one.
export function buildSnapshot(definitions: ContextVariableDefinition[], captured: CapturedValue[]): MonitorSnapshot {
  const byName = new Map(captured.map((value) => [value.name.toLowerCase(), value]));
  const matched = definitions.map((definition) => ({ definition, value: byName.get(definition.name.toLowerCase()) }));
  const definedNames = new Set(definitions.map((definition) => definition.name.toLowerCase()));
  const extra = captured.filter((value) => !definedNames.has(value.name.toLowerCase()));
  return { matched, extra };
}
