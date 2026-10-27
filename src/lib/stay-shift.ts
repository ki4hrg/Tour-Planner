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

/** A stay's span as 1-based day positions: nights `checkIn .. checkOut - 1`. */
export type StaySpan = { id: string; checkIn: number; checkOut: number };

export type StayFollow =
  | { id: string; kind: "move"; delta: number }
  // Its nights' days no longer sit together in the same order, so there is
  // no single shift that keeps the stay on them; it stays where it is.
  | { id: string; kind: "split" };

/**
 * Lodging that should follow a day reorder. A stay follows the days whose
 * nights it covers: if those days are still consecutive (and in the same
 * order) after the reorder, the whole stay shifts by however far they moved.
 * Stays whose days didn't move, or that cover no day of the trip, are left
 * out. `oldOrder`/`newOrder` are the trip's day ids before and after.
 */
export function staysFollowingDays(
  oldOrder: string[],
  newOrder: string[],
  stays: StaySpan[],
): StayFollow[] {
  const newPos = new Map(newOrder.map((id, i) => [id, i + 1]));
  const out: StayFollow[] = [];
  for (const stay of stays) {
    const nights: number[] = [];
    for (let p = Math.max(1, stay.checkIn); p < stay.checkOut && p <= oldOrder.length; p++) {
      nights.push(p);
    }
    if (nights.length === 0) continue;
    const moved = nights.map((p) => newPos.get(oldOrder[p - 1]) ?? -1);
    const together = moved.every((p, i) => i === 0 || p === moved[i - 1] + 1);
    if (!together) {
      out.push({ id: stay.id, kind: "split" });
      continue;
    }
    const delta = moved[0] - nights[0];
    if (delta !== 0) out.push({ id: stay.id, kind: "move", delta });
  }
  return out;
}
