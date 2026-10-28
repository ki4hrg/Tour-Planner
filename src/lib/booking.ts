import type { BookingStatus } from "@prisma/client";
import { addDays } from "./dates";

// Booking timing for v1 models only WHEN booking opens (earliest-bookable),
// not a deadline (see plan decision 1). A location's `bookingOpensLeadDays` means
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

/**
 * The earliest date a venue engagement is in use — the min over its covered
 * schedule-item day dates and stay check-ins. The booking window keys off this
 * (not trip start) so a mid-trip excursion opens relative to the excursion, not
 * arrival. Returns null when nothing covered has a date.
 */
export function earliestCoveredDate(dates: (Date | null | undefined)[]): Date | null {
  let min: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (min === null || d.getTime() < min.getTime()) min = d;
  }
  return min;
}

/**
 * Whether a booking is "locked in" — a reservation actually secured, so the
 * planner no longer needs to chase it (a workflow step that reaches CONFIRMED
 * or FINALIZED, or the same set by hand). Used to gate attention filters and
 * "Booked" labels across the dashboards.
 */
export function isBookingSecured(status: BookingStatus): boolean {
  return status === "CONFIRMED" || status === "FINALIZED";
}

/** The statuses that sit off the ladder — manual overrides workflow steps never clear. */
export const OFF_LADDER_STATUSES = ["CANCELLED", "NOT_NEEDED"] as const satisfies readonly BookingStatus[];

/**
 * Cancelled or not needed: out of play. Never actionable, never counted in
 * the estimate, never owed; a workflow's steps leave the status alone.
 */
export function isBookingOff(status: BookingStatus): boolean {
  return status === "CANCELLED" || status === "NOT_NEEDED";
}

/**
 * Whether a booking row needs the planner's attention — surfaced on the dashboard.
 * Pure (caller passes the already-computed window state), keeping render free of
 * Date.now(). "Needs info" = the window is open and the booking isn't secured yet,
 * OR it's secured but missing a reference, OR the venue is missing price/time,
 * OR a scheduled installment is past due (GH #51).
 */
export function bookingNeedsInfo(args: {
  status: BookingStatus;
  windowOpen: boolean;
  hasRef: boolean;
  isMissingCost: boolean;
  isMissingTime: boolean;
  paymentOverdue: boolean;
}): boolean {
  const { status, windowOpen, hasRef, isMissingCost, isMissingTime, paymentOverdue } =
    args;
  if (isBookingOff(status)) return false;
  if (windowOpen && !isBookingSecured(status))
    return true;
  if (isBookingSecured(status) && !hasRef) return true;
  return isMissingCost || isMissingTime || paymentOverdue;
}
