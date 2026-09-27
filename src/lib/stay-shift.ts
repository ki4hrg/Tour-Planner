// Keeping lodging aligned with the itinerary when days move.
//
// A Stay anchors EITHER to calendar dates (dated trip) OR to 1-based day indices
// (date-less template) — see the `stay_anchor_mode` CHECK. Day dates derive from
// `startDate + dayIndex`, so when the trip's start moves or a day is deleted the
// days renumber/redate but stays don't follow on their own. These pure helpers
// compute where each stay should land; the actions apply them in the same
// transaction as the day change.

import { addDays, dayIndexForDate } from "./dates";

/** Whole-day delta between two start dates, or 0 when either is missing (a
 * dated↔date-less transition has no meaningful shift). */
export function startDateShiftDays(
  oldStart: Date | null,
  newStart: Date | null,
): number {
  if (!oldStart || !newStart) return 0;
  return (dayIndexForDate(oldStart, newStart) ?? 1) - 1;
}

/** Move a dated stay by `deltaDays` (both ends), preserving its length. */
export function shiftStayDates(
  stay: { checkIn: Date; checkOut: Date },
  deltaDays: number,
): { checkIn: Date; checkOut: Date } {
  return {
    checkIn: addDays(stay.checkIn, deltaDays),
    checkOut: addDays(stay.checkOut, deltaDays),
  };
}

export type DayIndexRange = { checkInDayIndex: number; checkOutDayIndex: number };

/**
 * Where a day-indexed stay lands once day `deletedIndex` is removed and later
 * days renumber down by one. Every index strictly after the deleted day shifts
 * down; indices at or before it stay put — so a stay spanning the deleted day
 * loses that night, and a stay starting on it now starts on the day that took
 * its place.
 *
 * Returns:
 *  - `{ kind: "unchanged" }` — nothing to write;
 *  - `{ kind: "shift", ... }` — the new indices;
 *  - `{ kind: "collapsed" }` — the stay covered ONLY the deleted day's night, so
 *    shifting would leave zero nights. The caller leaves it untouched (nothing
 *    is dropped silently) and the lodging UI surfaces it for the planner.
 */
export function shiftStayIndicesForDeletedDay(
  stay: DayIndexRange,
  deletedIndex: number,
):
  | { kind: "unchanged" }
  | { kind: "collapsed" }
  | ({ kind: "shift" } & DayIndexRange) {
  const shift = (i: number) => (i > deletedIndex ? i - 1 : i);
  const checkInDayIndex = shift(stay.checkInDayIndex);
  const checkOutDayIndex = shift(stay.checkOutDayIndex);
  if (
    checkInDayIndex === stay.checkInDayIndex &&
    checkOutDayIndex === stay.checkOutDayIndex
  ) {
    return { kind: "unchanged" };
  }
  if (checkOutDayIndex <= checkInDayIndex) return { kind: "collapsed" };
  return { kind: "shift", checkInDayIndex, checkOutDayIndex };
}
