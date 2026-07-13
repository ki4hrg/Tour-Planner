/**
 * Duration-preserving time cascade for reordered schedule items.
 *
 * Items within a day carry an explicit `order` (drag/↑↓-reorderable) plus optional
 * `"HH:MM"` start/end times. Reordering used to rewrite `order` alone, so the visible
 * sequence and the clock times could disagree (an item nudged to the top still showed a
 * later time than the row beneath it).
 *
 * This recomputes times so the day stays internally consistent, while respecting that a
 * moved item does NOT inherit the duration of whatever it displaced. The current times
 * define a "skeleton": an anchor (the earliest start) and the free-time gaps between
 * consecutive timed slots. The reordered items are laid back onto that skeleton — each
 * keeping ITS OWN duration — cascading downstream:
 *
 *   09:00–10:00 Museum · 10:30–12:30 Cathedral   (move Cathedral up)
 *   → 09:00–11:00 Cathedral · 11:30–12:30 Museum
 *
 * Cathedral keeps its 2 h, Museum its 1 h, and the 30-min gap survives its position.
 *
 * Rules:
 *  - Only items that currently have a (parseable) start time are re-timed; the set of
 *    timed items is invariant under reorder, so anchor + gaps line up 1:1 with the new
 *    order. Untimed items keep null times and simply take their new `order` slot.
 *  - A start-only "point" item (start, no end) stays a point: its end is left null and it
 *    contributes zero duration to the cascade.
 *  - Gaps and durations are clamped to ≥ 0 so malformed/overlapping originals can't
 *    produce times that run backwards.
 *  - When no item has a start time, only `order` changes.
 */

import { timeToMinutes, minutesToTime } from "./schedule-gaps";

export interface ReorderableItem {
  id: string;
  startTime: string | null;
  endTime: string | null;
}

export interface ReorderedItem {
  id: string;
  order: number; // 1-based
  startTime: string | null;
  endTime: string | null;
}

/** Minutes of a parseable start time, or null. */
function startMinutes(item: ReorderableItem): number | null {
  return item.startTime ? timeToMinutes(item.startTime) : null;
}

/**
 * Given a day's current items and the desired new order of their ids, return each item's
 * new `order` (1-based) and cascaded start/end times. Ids in `orderedItemIds` that aren't
 * in `items` are ignored; items missing from `orderedItemIds` are dropped.
 */
export function cascadeReorderedTimes(
  items: ReorderableItem[],
  orderedItemIds: string[],
): ReorderedItem[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const ordered = orderedItemIds
    .map((id) => byId.get(id))
    .filter((it): it is ReorderableItem => it != null);

  // Skeleton: timed items in chronological order define the anchor + inter-slot gaps.
  const timedNow = items
    .filter((it) => startMinutes(it) !== null)
    .sort((a, b) => startMinutes(a)! - startMinutes(b)!);

  // Nothing timed → order-only change, times untouched.
  if (timedNow.length === 0) {
    return ordered.map((it, i) => ({
      id: it.id,
      order: i + 1,
      startTime: it.startTime,
      endTime: it.endTime,
    }));
  }

  const anchor = startMinutes(timedNow[0])!;

  // duration(item): its own length in minutes (0 for a point / malformed).
  const duration = (it: ReorderableItem): number => {
    const start = startMinutes(it);
    if (start === null) return 0;
    const end = it.endTime ? timeToMinutes(it.endTime) : null;
    if (end === null) return 0; // point item
    return Math.max(0, end - start);
  };

  // gaps[k] = free time between chronological slot k and k+1 (position-anchored).
  const gaps: number[] = [];
  for (let k = 1; k < timedNow.length; k++) {
    const prev = timedNow[k - 1];
    const prevStart = startMinutes(prev)!;
    const prevEnd = prev.endTime ? timeToMinutes(prev.endTime) : null;
    const prevEndMin = prevEnd ?? prevStart; // point → ends where it starts
    const thisStart = startMinutes(timedNow[k])!;
    gaps.push(Math.max(0, thisStart - prevEndMin));
  }

  // Lay the reordered timed items onto the skeleton, cascading downstream.
  const newTimes = new Map<string, { startTime: string; endTime: string | null }>();
  let slot = 0;
  let cursor = anchor;
  for (const it of ordered) {
    if (startMinutes(it) === null) continue; // untimed: keep null, no slot consumed
    const start = slot === 0 ? anchor : cursor + gaps[slot - 1];
    const isPoint = it.endTime == null;
    const end = start + duration(it);
    newTimes.set(it.id, {
      startTime: minutesToTime(start),
      endTime: isPoint ? null : minutesToTime(end),
    });
    cursor = end; // point item ends where it starts, so cursor = start
    slot++;
  }

  return ordered.map((it, i) => {
    const t = newTimes.get(it.id);
    return {
      id: it.id,
      order: i + 1,
      startTime: t ? t.startTime : it.startTime,
      endTime: t ? t.endTime : it.endTime,
    };
  });
}
