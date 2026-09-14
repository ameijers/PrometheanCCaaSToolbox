import { isWithinOperatingHours } from "../src/operatingHours";
import { OperatingHoursRule } from "../src/model";

// Modeled on the real Contoso Sales calendar: Mon-Fri 08:00-17:00, no end date.
const WEEKDAYS_8_TO_5: OperatingHoursRule = {
  timeZoneCode: 95,
  weekdays: [1, 2, 3, 4, 5],
  intervalWeeks: 1,
  anchorDate: "2026-09-13",
  startMinutes: 480,
  durationMinutes: 540,
  validFrom: "2026-09-13"
};

// localTime's UTC-getters represent the queue's own local wall clock (as returned by Dataverse's
// LocalTimeFromUtcTime), so construct fixtures the same way: a "Z"-suffixed ISO string whose
// components ARE the local time, not an actual UTC instant.
const localTime = (iso: string) => new Date(iso);

describe("isWithinOperatingHours", () => {
  test("returns undefined when no rules are configured (queue has no operating hours)", () => {
    expect(isWithinOperatingHours(undefined, localTime("2026-09-14T10:00:00Z"))).toBeUndefined();
    expect(isWithinOperatingHours([], localTime("2026-09-14T10:00:00Z"))).toBeUndefined();
  });

  test("is within hours on a weekday during the window", () => {
    // 2026-09-14 is a Monday.
    expect(isWithinOperatingHours([WEEKDAYS_8_TO_5], localTime("2026-09-14T10:00:00Z"))).toBe(true);
  });

  test("is outside hours on a weekday before the window opens", () => {
    expect(isWithinOperatingHours([WEEKDAYS_8_TO_5], localTime("2026-09-14T07:59:00Z"))).toBe(false);
  });

  test("is outside hours on a weekday after the window closes", () => {
    expect(isWithinOperatingHours([WEEKDAYS_8_TO_5], localTime("2026-09-14T17:00:00Z"))).toBe(false);
  });

  test("is outside hours on a weekend even during the daily window", () => {
    // 2026-09-13 is a Sunday.
    expect(isWithinOperatingHours([WEEKDAYS_8_TO_5], localTime("2026-09-13T10:00:00Z"))).toBe(false);
  });

  test("respects validFrom/validTo bounds", () => {
    const bounded: OperatingHoursRule = { ...WEEKDAYS_8_TO_5, validFrom: "2026-09-14", validTo: "2026-09-18" };
    expect(isWithinOperatingHours([bounded], localTime("2026-09-10T10:00:00Z"))).toBe(false); // before validFrom
    expect(isWithinOperatingHours([bounded], localTime("2026-09-21T10:00:00Z"))).toBe(false); // after validTo
    expect(isWithinOperatingHours([bounded], localTime("2026-09-14T10:00:00Z"))).toBe(true);
  });

  test("respects an interval-week (fortnightly) recurrence anchored to a given date", () => {
    const biweekly: OperatingHoursRule = { ...WEEKDAYS_8_TO_5, intervalWeeks: 2, anchorDate: "2026-09-14" };
    expect(isWithinOperatingHours([biweekly], localTime("2026-09-14T10:00:00Z"))).toBe(true); // anchor week
    expect(isWithinOperatingHours([biweekly], localTime("2026-09-21T10:00:00Z"))).toBe(false); // next week, skipped
    expect(isWithinOperatingHours([biweekly], localTime("2026-09-28T10:00:00Z"))).toBe(true); // two weeks later
  });

  test("any matching rule in the list is enough (multiple windows in a day)", () => {
    const morning: OperatingHoursRule = { ...WEEKDAYS_8_TO_5, startMinutes: 480, durationMinutes: 240 }; // 08:00-12:00
    const afternoon: OperatingHoursRule = { ...WEEKDAYS_8_TO_5, startMinutes: 780, durationMinutes: 240 }; // 13:00-17:00
    expect(isWithinOperatingHours([morning, afternoon], localTime("2026-09-14T12:30:00Z"))).toBe(false); // lunch gap
    expect(isWithinOperatingHours([morning, afternoon], localTime("2026-09-14T14:00:00Z"))).toBe(true);
  });
});
