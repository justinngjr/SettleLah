/**
 * Asia/Singapore wall-clock helpers. Singapore is UTC+8 all year with no
 * DST, so the conversion is a fixed offset and needs no tz database. Every
 * function here is pure: callers pass the instant in, nothing reads the
 * system clock.
 */

export const SGT_UTC_OFFSET_MINUTES = 8 * 60;

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

const SGT_OFFSET_MS = SGT_UTC_OFFSET_MINUTES * MS_PER_MINUTE;

/** Wall-clock fields in Asia/Singapore. `month` is 1-12, `weekday` is 0 (Sun) - 6 (Sat). */
export interface SgtParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly weekday: number;
}

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function assertDate(value: unknown, label = "date"): Date {
  if (!isValidDate(value)) {
    throw new RangeError(`${label} must be a valid Date`);
  }
  return value;
}

export function toSgt(instant: Date): SgtParts {
  assertDate(instant, "instant");
  const shifted = new Date(instant.getTime() + SGT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * The instant at the given Asia/Singapore wall-clock time. Out-of-range
 * fields roll over the way `Date.UTC` does (day 0 is the last day of the
 * previous month, month 13 is January of the next year, ...).
 */
export function fromSgt(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  for (const [label, value] of Object.entries({ year, month, day, hour, minute, second })) {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be an integer, got ${String(value)}`);
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - SGT_OFFSET_MS);
}

/** Number of days in `month` (1-12) of `year`, leap years included. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`invalid year/month ${String(year)}/${String(month)}`);
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The calendar date in Asia/Singapore as `YYYYMMDD`. */
export function sgtDateString(instant: Date): string {
  const { year, month, day } = toSgt(instant);
  return `${String(year).padStart(4, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/** Midnight at the start of the Asia/Singapore calendar day containing `instant`, plus `dayOffset` days. */
export function startOfSgtDay(instant: Date, dayOffset = 0): Date {
  const { year, month, day } = toSgt(instant);
  return fromSgt(year, month, day + dayOffset);
}
