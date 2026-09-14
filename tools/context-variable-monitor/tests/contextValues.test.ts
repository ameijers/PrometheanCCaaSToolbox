import { buildSnapshot, parseDisplayValue, variableType } from "../src/contextValues";
import { CapturedValue, ContextVariableDefinition } from "../src/model";

describe("variableType", () => {
  test("maps the real msdyn_datatype enum values", () => {
    expect(variableType(192350000)).toBe("text");
    expect(variableType(192350001)).toBe("number");
    expect(variableType(192350002)).toBe("boolean");
    expect(variableType(192350100)).toBe("entityReference");
  });

  test("returns unknown for an unrecognized value", () => {
    expect(variableType(999)).toBe("unknown");
    expect(variableType(undefined)).toBe("unknown");
  });
});

describe("parseDisplayValue", () => {
  test("passes text/number/boolean values through unchanged", () => {
    expect(parseDisplayValue("Dutch", "text")).toBe("Dutch");
    expect(parseDisplayValue("42", "number")).toBe("42");
    expect(parseDisplayValue("true", "boolean")).toBe("true");
  });

  test("unwraps an entity-reference JSON array to its PrimaryDisplayValue", () => {
    const raw = '[{"RecordId":"b863ecc8-849f-f111-aaad-70a8a5b10059","PrimaryDisplayValue":"Alexander Meijers"}]';
    expect(parseDisplayValue(raw, "entityReference")).toBe("Alexander Meijers");
  });

  test("falls back to the raw value if an entity-reference value isn't parseable JSON", () => {
    expect(parseDisplayValue("not json", "entityReference")).toBe("not json");
  });

  test("falls back to the raw value if the JSON doesn't have the expected shape", () => {
    expect(parseDisplayValue('{"foo":"bar"}', "entityReference")).toBe('{"foo":"bar"}');
    expect(parseDisplayValue("[]", "entityReference")).toBe("[]");
  });
});

describe("buildSnapshot", () => {
  const definitions: ContextVariableDefinition[] = [
    { id: "d1", name: "PreferredLanguage", displayName: "Preferred language", type: "text" },
    { id: "d2", name: "IsIdentified", displayName: "Caller identified", type: "boolean" }
  ];

  test("matches a captured value to its definition case-insensitively", () => {
    const captured: CapturedValue[] = [{ name: "preferredlanguage", rawValue: "Dutch", displayValue: "Dutch", type: "text" }];
    const snapshot = buildSnapshot(definitions, captured);
    expect(snapshot.matched.find((m) => m.definition.name === "PreferredLanguage")?.value?.displayValue).toBe("Dutch");
    expect(snapshot.matched.find((m) => m.definition.name === "IsIdentified")?.value).toBeUndefined();
  });

  test("puts a captured value with no matching definition into extra", () => {
    const captured: CapturedValue[] = [{ name: "va_BotName", rawValue: "MyBot", displayValue: "MyBot", type: "text" }];
    const snapshot = buildSnapshot(definitions, captured);
    expect(snapshot.extra).toHaveLength(1);
    expect(snapshot.extra[0].name).toBe("va_BotName");
    expect(snapshot.matched.every((m) => m.value === undefined)).toBe(true);
  });

  test("every definition appears in matched even with no captured values at all", () => {
    const snapshot = buildSnapshot(definitions, []);
    expect(snapshot.matched).toHaveLength(2);
    expect(snapshot.matched.every((m) => m.value === undefined)).toBe(true);
    expect(snapshot.extra).toHaveLength(0);
  });
});
