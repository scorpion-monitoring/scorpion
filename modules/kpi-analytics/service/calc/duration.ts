/**
 * The seconds of a duration given as hours, minutes and seconds (`HH-MM-SS` once parsed): whole non-negative numbers, minutes and seconds below
 * 60, hours up to 9 999 (the value type's own limit). `null` for anything else, never `NaN`. The value type of `kpi.framework` stores a duration
 * as seconds; this is the same arithmetic for a caller that holds the parts.
 */
export function durationSeconds(hours: number, minutes: number, seconds: number): number | null {
  const whole = (value: number, limit: number) =>
    Number.isInteger(value) && value >= 0 && value < limit;
  if (!whole(hours, 10_000) || !whole(minutes, 60) || !whole(seconds, 60)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** The parts of a number of seconds (the inverse of {@link durationSeconds}), or `null` for a number that is no duration. */
export function durationParts(
  total: number,
): { hours: number; minutes: number; seconds: number } | null {
  if (!Number.isInteger(total) || total < 0 || total >= 10_000 * 3600) return null;
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}
