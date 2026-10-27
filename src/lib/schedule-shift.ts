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
 * sees.
 *
 * **Fixed-time items** (`fixedTime` — a public event, a booked slot we don't control)
 * are anchors: neither gesture ever moves one, and a shift STOPS at the first fixed
 * item it reaches — that item and everything after it keep their times. What follows
 * a fixed event is timed relative to it (the coach after the parade), so sliding it
 * past the anchor would be wrong. The shifted run can end up overlapping the anchor;
 * `fixedTimeOverlaps` reports that so the caller can say so. See
 * `docs/itinerary-time-editing.md`.
 */

import { timeToMinutes, minutesToTime } from "./schedule-gaps";

export interface DayScheduleItem {
  id: string;
  order: number; // 1-based, contiguous within the day
  startTime: string | null;
  endTime: string | null;
  fixedTime?: boolean; // anchor: never shifted, and a shift stops at it
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

  return shiftRun(items, delta, edited.order + 1);
}

/**
 * The timed, movable items from `fromOrder` up to (not including) the first
 * fixed-time item ordered after `fromOrder`. A fixed item AT the start of the run
 * is skipped rather than ending it, so "shift from the parade onward" moves what
 * comes after the parade, up to the next anchor.
 */
function shiftRun(
  items: DayScheduleItem[],
  delta: number,
  fromOrder: number,
): TimeShift[] {
  const stopAt = items
    .filter((it) => it.fixedTime && it.order > fromOrder)
    .reduce((min, it) => Math.min(min, it.order), Infinity);
  return [...items]
    .sort((a, b) => a.order - b.order)
    .filter(
      (it) =>
        it.order >= fromOrder &&
        it.order < stopAt &&
        !it.fixedTime &&
        it.startTime != null,
    )
    .map((it) => shiftItem(it, delta))
    .filter((s): s is TimeShift => s !== null);
}

/**
 * Slide a run of timed items by a fixed `deltaMinutes` (negative = earlier).
 * Shifts every timed item whose `order >= fromOrder` (default 1 = the whole day),
 * stopping at the next fixed-time item. Returns only the items that changed;
 * untimed and fixed-time items are left alone.
 */
export function shiftDayItems(
  items: DayScheduleItem[],
  deltaMinutes: number,
  fromOrder = 1,
): TimeShift[] {
  if (deltaMinutes === 0) return [];
  return shiftRun(items, deltaMinutes, fromOrder);
}

/**
 * Fixed-time items that, once `shifts` are applied, overlap the movable item
 * just before them in the day's order — the ripple ran into the anchor. Returns
 * the ids of the fixed items run into (empty when everything still fits).
 */
export function fixedTimeOverlaps(
  items: DayScheduleItem[],
  shifts: TimeShift[],
): string[] {
  const shifted = new Map(shifts.map((s) => [s.id, s]));
  const timed = [...items]
    .sort((a, b) => a.order - b.order)
    .map((it) => ({ ...it, ...shifted.get(it.id) }))
    .filter((it) => it.startTime != null && timeToMinutes(it.startTime) !== null);

  const hits: string[] = [];
  for (let i = 1; i < timed.length; i++) {
    const anchor = timed[i];
    const prev = timed[i - 1];
    if (!anchor.fixedTime || !shifted.has(prev.id)) continue;
    const prevStart = timeToMinutes(prev.startTime!)!;
    if (effectiveEndMinutes(prevStart, prev.endTime) > timeToMinutes(anchor.startTime!)!) {
      hits.push(anchor.id);
    }
  }
  return hits;
}
