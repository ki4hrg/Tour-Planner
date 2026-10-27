import { timedInsertIndex } from "./schedule-order";

/**
 * Moving a schedule item to ANOTHER day (the itinerary's drag between days, or
 * "Move to day…"). Unlike a within-day reorder — which re-sequences and
 * cascades times (cascadeReorderedTimes) — a cross-day move relocates an
 * appointment: the item keeps its own times. So where it lands follows them:
 *   - a TIMED item slots chronologically (timedInsertIndex), whatever spot it
 *     was dropped on, so the target day's sequence and clock never disagree;
 *   - an UNTIMED item takes the dropped position (clamped to the list).
 * Both days are renumbered 1..n. Pure; returns the `order` (and, for the moved
 * item, `dayId`) every affected row should get.
 */
export type MovableItem = { id: string; order: number; startTime: string | null };

export type MoveUpdate = { id: string; order: number; dayId?: string };

export function planCrossDayMove(
  item: MovableItem,
  sourceItems: MovableItem[],
  targetItems: MovableItem[],
  targetDayId: string,
  dropIndex: number,
): { updates: MoveUpdate[]; index: number } {
  const byOrder = (a: MovableItem, b: MovableItem) => a.order - b.order;
  const source = sourceItems.filter((it) => it.id !== item.id).sort(byOrder);
  const target = targetItems.filter((it) => it.id !== item.id).sort(byOrder);
  const index = item.startTime
    ? timedInsertIndex(
        target.map((it, i) => ({ order: i + 1, startTime: it.startTime })),
        item.startTime,
      )
    : Math.max(0, Math.min(dropIndex, target.length));
  const placed = [...target.slice(0, index), item, ...target.slice(index)];

  const updates: MoveUpdate[] = [
    ...source.map((it, i) => ({ id: it.id, order: i + 1 })),
    ...placed.map((it, i) =>
      it.id === item.id
        ? { id: it.id, order: i + 1, dayId: targetDayId }
        : { id: it.id, order: i + 1 },
    ),
  ];
  return { updates, index };
}
