import { OperatingHoursRule } from "./model";

// `localTime`'s UTC-getters must already represent the queue's own local wall-clock time (obtained
// via Dataverse's LocalTimeFromUtcTime function, since the calendar's timezone can't be resolved
// correctly client-side without guessing at a Windows-timezone-id -> offset table). Using UTC
// getters on that value avoids the browser's own local timezone from being applied a second time.
export function isWithinOperatingHours(rules: OperatingHoursRule[] | undefined, localTime: Date): boolean | undefined {
  if (!rules || !rules.length) return undefined;
  return rules.some((rule) => matchesRule(rule, localTime));
}

function matchesRule(rule: OperatingHoursRule, localTime: Date): boolean {
  const dateStr = localTime.toISOString().slice(0, 10);
  if (rule.validFrom && dateStr < rule.validFrom) return false;
  if (rule.validTo && dateStr > rule.validTo) return false;
  if (!rule.weekdays.includes(localTime.getUTCDay())) return false;

  if (rule.intervalWeeks > 1) {
    const anchor = Date.UTC(...parseIsoDate(rule.anchorDate));
    const midnightLocal = Date.UTC(localTime.getUTCFullYear(), localTime.getUTCMonth(), localTime.getUTCDate());
    const weeksSinceAnchor = Math.floor((midnightLocal - anchor) / (7 * 24 * 60 * 60 * 1000));
    if (((weeksSinceAnchor % rule.intervalWeeks) + rule.intervalWeeks) % rule.intervalWeeks !== 0) return false;
  }

  const minutesOfDay = localTime.getUTCHours() * 60 + localTime.getUTCMinutes();
  return minutesOfDay >= rule.startMinutes && minutesOfDay < rule.startMinutes + rule.durationMinutes;
}

function parseIsoDate(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m - 1, d];
}
