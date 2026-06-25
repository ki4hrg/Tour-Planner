import { addDays } from "./dates";

// Booking timing for v1 models only WHEN booking opens (earliest-bookable),
// not a deadline (see plan decision 1). A site's `bookingOpensLeadDays` means
// "bookable from `trip.startDate − leadDays`".

const DAY_MS = 24 * 60 * 60 * 1000;

/** Earliest date a stop can be booked, or null if start date / lead days unknown. */
export function earliestBookable(
  startDate: Date | null,
  leadDays: number | null,
): Date | null {
  if (!startDate || leadDays == null) return null;
  return addDays(startDate, -leadDays);
}

export type WindowStatus = {
  open: boolean;
  // Whole days from `today` until the window opens. <= 0 once open; null when
  // there's no earliest-bookable date to compare against.
  daysUntilOpen: number | null;
};

/** Pure window check against an explicit `today` (both args treated date-only). */
export function windowStatus(
  earliest: Date | null,
  today: Date,
): WindowStatus {
  if (!earliest) return { open: false, daysUntilOpen: null };
  const diff = Math.round((earliest.getTime() - today.getTime()) / DAY_MS);
  return { open: diff <= 0, daysUntilOpen: diff };
}

/** Floor a Date to UTC midnight (date-only), matching `@db.Date` semantics. */
function utcToday(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export type BookingWindow = {
  earliest: Date | null;
  open: boolean;
  daysUntilOpen: number | null;
};

/**
 * Render-friendly wrapper: computes the window against "now". Date.now() is
 * isolated here (a plain helper) so component render stays pure — same pattern
 * as `isCostStale` in money.ts.
 */
export function bookingWindow(
  startDate: Date | null,
  leadDays: number | null,
): BookingWindow {
  const earliest = earliestBookable(startDate, leadDays);
  const { open, daysUntilOpen } = windowStatus(earliest, utcToday(new Date()));
  return { earliest, open, daysUntilOpen };
}
