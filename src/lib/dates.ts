// Calendar-date helpers. Trip/day dates are stored as `@db.Date` (date-only,
// no timezone), so we operate in UTC throughout to avoid off-by-one shifts when
// the server's local zone is behind/ahead of UTC.

/** Parse a "yyyy-mm-dd" form value into a UTC-midnight Date, or null if empty. */
export function parseDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date (or ISO string) as "yyyy-mm-dd" for a date input, in UTC. */
export function toDateInput(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Add `days` to a date-only value, staying on UTC midnight. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Date for the nth day of a trip. dayIndex is 1-based, so day 1 == startDate.
 * Returns null when the trip has no startDate.
 */
export function computeDayDate(
  startDate: Date | null,
  dayIndex: number,
): Date | null {
  if (!startDate) return null;
  return addDays(startDate, dayIndex - 1);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Inverse of `computeDayDate`: the 1-based day index a date falls on relative to
 * a trip's startDate (day 1 == startDate). Used to templatize an absolute stay
 * date into a day-relative anchor. Returns null when startDate is missing.
 * Can exceed the trip's day count (e.g. a checkout the morning after the last
 * day → dayCount + 1), matching how an absolute checkOut can be endDate + 1.
 */
export function dayIndexForDate(
  startDate: Date | null,
  date: Date | null | undefined,
): number | null {
  if (!startDate || !date) return null;
  return Math.round((date.getTime() - startDate.getTime()) / DAY_MS) + 1;
}

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Whether "now" falls within [startDate, endDate] inclusive (date-only).
 * Date.now() is isolated here (a plain helper) so component render stays pure.
 */
export function isOngoing(
  startDate: Date | null,
  endDate: Date | null,
): boolean {
  if (!startDate) return false;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = endDate ?? startDate;
  return startDate.getTime() <= today && today <= end.getTime();
}

/**
 * Today at UTC midnight (date-only), matching the `@db.Date` convention. Isolates
 * `new Date()` in a plain helper so component render stays pure (same pattern as
 * `isOngoing`). Use to line a real "today" up against day/stay dates.
 */
export function todayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Human-readable date, e.g. "Mon, 6 Jul 2026". Empty string when null. */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAY_FMT.format(d);
}
