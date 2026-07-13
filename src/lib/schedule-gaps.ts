// Schedule gap detection and formatting helpers for the itinerary timeline.

import type { SerializedScheduleItem } from "./trips";

/** Represents a gap between two timed items. */
export interface ScheduleGap {
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  durationMinutes: number;
  // The id of the timed item the gap follows — the renderer anchors the gap
  // line directly after this item's row so gaps read in place, not clumped.
  afterItemId: string;
}

/**
 * Parse a "HH:MM" time string into total minutes since midnight.
 * Returns null if the string is malformed.
 */
export function timeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Convert total minutes since midnight into a "HH:MM" time string.
 */
export function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Check if a time range is covered by a system category item (Free time, Break).
 * A system item covers the gap if its times span from gapStart to gapEnd or later.
 */
function isGapCoveredBySystemItem(
  gapStartMinutes: number,
  gapEndMinutes: number,
  items: SerializedScheduleItem[],
): boolean {
  for (const item of items) {
    // Only system categories can implicitly cover gaps
    if (!item.category || !item.category.name || !item.startTime || !item.endTime) {
      continue;
    }

    const itemStartMin = timeToMinutes(item.startTime);
    const itemEndMin = timeToMinutes(item.endTime);

    if (itemStartMin === null || itemEndMin === null) {
      continue;
    }

    // Check if this is a "Free time" or "Break" category by name
    const isFreeTimeOrBreak =
      item.category.name === "Free time" || item.category.name === "Break";

    if (isFreeTimeOrBreak && itemStartMin <= gapStartMinutes && itemEndMin >= gapEndMinutes) {
      return true;
    }
  }
  return false;
}

/**
 * Compute gaps (free time) between consecutive timed items in a day.
 * Gaps are only returned if:
 * - The earlier item has an end time and the later item a start time
 * - The gap is at least 10 minutes
 * - The gap is not covered by a "Free time" or "Break" system category item
 *
 * A start-only item (e.g. "10:00 Depart") still CLOSES the gap before it — its
 * start is a hard boundary — but opens no gap after it: its duration is
 * unknown, so the time until the next item can't be called free.
 */
export function computeScheduleGaps(items: SerializedScheduleItem[]): ScheduleGap[] {
  const gaps: ScheduleGap[] = [];
  const MIN_GAP_MINUTES = 10;

  // Every item with a start time participates as a boundary, sorted by start
  const timedItems = items
    .filter((item) => item.startTime)
    .sort((a, b) => {
      const aStart = timeToMinutes(a.startTime!);
      const bStart = timeToMinutes(b.startTime!);
      return (aStart ?? 0) - (bStart ?? 0);
    });

  // Find gaps between consecutive items
  for (let i = 0; i < timedItems.length - 1; i++) {
    const current = timedItems[i];
    const next = timedItems[i + 1];

    // No end time → open-ended; nothing after it is known to be free
    if (!current.endTime) {
      continue;
    }

    const currentEnd = timeToMinutes(current.endTime);
    const nextStart = timeToMinutes(next.startTime!);

    if (currentEnd === null || nextStart === null) {
      continue;
    }

    // Skip if next starts before or at current end (overlapping)
    if (nextStart <= currentEnd) {
      continue;
    }

    const gapDuration = nextStart - currentEnd;

    // Skip gaps smaller than 10 minutes
    if (gapDuration < MIN_GAP_MINUTES) {
      continue;
    }

    // Skip if this gap is covered by a system category (Free time / Break)
    if (isGapCoveredBySystemItem(currentEnd, nextStart, items)) {
      continue;
    }

    gaps.push({
      startTime: current.endTime,
      endTime: minutesToTime(nextStart),
      durationMinutes: gapDuration,
      afterItemId: current.id,
    });
  }

  return gaps;
}

/**
 * Format a duration in minutes into human-readable text.
 * Examples: "45 min free", "1 h 15 min free", "2 h free"
 */
export function formatDuration(durationMinutes: number, label: string = "free"): string {
  if (durationMinutes < 60) {
    return `${durationMinutes} min ${label}`;
  }

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (minutes === 0) {
    return `${hours} h ${label}`;
  }

  return `${hours} h ${minutes} min ${label}`;
}
