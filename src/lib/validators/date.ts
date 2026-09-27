import { z } from "zod";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether `value` is a real "yyyy-mm-dd" calendar date. The format regex alone
 * lets through impossible days like 2026-02-31, which `new Date()` silently rolls
 * over (→ Mar 3) and a month of 13 parses to Invalid Date (→ null → a DB CHECK
 * violation downstream). Round-tripping through UTC catches both.
 */
export function isCalendarDate(value: string): boolean {
  const m = ISO_DATE.exec(value.trim());
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

/** A required "yyyy-mm-dd" string that must name a real calendar date. */
export function calendarDate(message = "Enter a valid date.") {
  return z.string().refine(isCalendarDate, message);
}
