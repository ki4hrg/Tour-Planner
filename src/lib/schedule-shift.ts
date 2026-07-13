/**
 * Time-shift helpers for editing a day on the fly.
 *
 * Two on-the-ground gestures that the reorder cascade (see `schedule-reorder.ts`)
 * doesn't cover:
 *
 *  1. **Edit ripple** — when one item's time changes (a talk runs long, a stop is
 *     trimmed), the rest of the day should optionally slide to keep its spacing.
 *     `cascadeFromEdit` moves every LATER timed item by the same delta the edited
 *     item's trailing edge moved, so every downstream gap survives untouched.
 *
 *  2. **Day reflow** — "we're 30 minutes behind": `shiftDayItems` slides a run of
 *     timed items (the whole day, or from a chosen item onward) by a fixed delta.
 *
 * Both are duration-preserving and gap-preserving: shifting is a rigid translation
 * of each affected item's start and end by one delta, so nothing's length changes
 * and the spacing between shifted items is identical afterward. Untimed items are
 * never touched; a start-only "point" item keeps its null end. Times are clamped to
 * a valid 00:00–23:59 so a large shift can't produce an out-of-range clock value.
 *
 * These operate on an item's `order` (the day's manual sequence), NOT on wall-clock
 * position — "from here onward" means "later in the list," matching what the planner
 * sees. Fixed anchors (a booked tour that mustn't move) are NOT modelled yet; the
 * ripple is opt-in per edit so a planner declines it when a downstream item is
 * pinned in reality. See `docs/itinerary-time-editing.md` for that deferred design.
 */

import { timeToMinutes, minutesToTime } from "./schedule-gaps";

export interface DayScheduleItem {
  id: string;
  order: number; // 1-based, contiguous within the day
  startTime: string | null;
  endTime: string | null;
}

/** A recomputed timing for one item — write these back verbatim. */
export interface TimeShift {
  id: string;
  startTime: string | null;
  endTime: string | null;
}

const MIN_OF_DAY = 0;
const MAX_OF_DAY = 24 * 60 - 1; // 23:59

const clamp = (minutes: number): number =>
  Math.max(MIN_OF_DAY, Math.min(MAX_OF_DAY, minutes));

/** An item's effective end in minutes: its end, or its start for a point item. */
function effectiveEndMinutes(startMinutes: number, endTime: string | null): number {
  const end = endTime ? timeToMinutes(endTime) : null;
  return end ?? startMinutes;
}

/**
 * Translate a single item's times by `delta` minutes (clamped to a valid clock).
 * Returns null for an untimed / unparseable item (nothing to shift). A point item
 * (null end) stays a point.
 */
function shiftItem(item: DayScheduleItem, delta: number): TimeShift | null {
  if (item.startTime == null) return null;
  const start = timeToMinutes(item.startTime);
  if (start === null) return null;
  const end = item.endTime ? timeToMinutes(item.endTime) : null;
  return {
    id: item.id,
    startTime: minutesToTime(clamp(start + delta)),
    endTime: end === null ? null : minutesToTime(clamp(end + delta)),
  };
}

/**
 * Ripple one item's new times through the rest of its day.
 *
 * Every item ordered AFTER the edited one that carries a start time is shifted by
 * the delta the edited item's trailing edge moved — `newEnd - oldEnd`, using each
 * side's start for a point item. Because it's a single rigid delta, every gap
 * BETWEEN downstream items and the gap AFTER the edited item are preserved exactly.
 *
 * Returns ONLY the downstream items whose times change (the caller writes the edited
 * item's own new times separately). No ripple happens — an empty array — when:
 *  - the edited item had no start before, or is being given/left no start (there's
 *    no spacing to ripple from / to), or
 *  - its trailing edge didn't move (delta 0), e.g. only its start was pulled in.
 *
 * `items` must be the day's items as currently persisted (pre-edit times), including
 * the edited one, with contiguous 1-based `order`.
 */
export function cascadeFromEdit(
  items: DayScheduleItem[],
  editedId: string,
  newStartTime: string | null,
  newEndTime: string | null,
): TimeShift[] {
  const edited = items.find((it) => it.id === editedId);
  if (!edited) return [];

  const oldStart = edited.startTime ? timeToMinutes(edited.startTime) : null;
  const newStart = newStartTime ? timeToMinutes(newStartTime) : null;
  if (oldStart === null || newStart === null) return [];

  const delta =
    effectiveEndMinutes(newStart, newEndTime) -
    effectiveEndMinutes(oldStart, edited.endTime);
  if (delta === 0) return [];

  return items
    .filter((it) => it.order > edited.order && it.startTime != null)
    .map((it) => shiftItem(it, delta))
    .filter((s): s is TimeShift => s !== null);
}

/**
 * Slide a run of timed items by a fixed `deltaMinutes` (negative = earlier).
 * Shifts every timed item whose `order >= fromOrder` (default 1 = the whole day).
 * Returns only the items that changed; untimed items are left alone.
 */
export function shiftDayItems(
  items: DayScheduleItem[],
  deltaMinutes: number,
  fromOrder = 1,
): TimeShift[] {
  if (deltaMinutes === 0) return [];
  return items
    .filter((it) => it.order >= fromOrder && it.startTime != null)
    .map((it) => shiftItem(it, deltaMinutes))
    .filter((s): s is TimeShift => s !== null);
}
