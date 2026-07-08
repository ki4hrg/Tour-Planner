/**
 * Chronological insertion slot for a newly-added schedule item.
 *
 * Items within a day are sequenced by an explicit, drag-reorderable `order` field —
 * NOT by time — so a bare append would drop a new item at the end even when it starts
 * earlier than items already on the day (annoying on templates, which are all built by
 * adding items). The intended shape: timed items first in start-time order, then
 * unscheduled (no-startTime) items clustered at the end where they stay visible as
 * work-to-do. So:
 *   - a new UNTIMED item appends at the very end;
 *   - a new TIMED item slots just before the first existing item that is either
 *     unscheduled OR starts strictly later (equal times land after existing same-time
 *     items). It never lands after an unscheduled item.
 * The manual sequence is otherwise left intact.
 *
 * `items` must be the day's current items — their `order` values are assumed contiguous
 * 1..n (the invariant every mutation here maintains: add appends, delete/reorder
 * renumber in a txn). Returns a 0-based index in [0, items.length]; the caller creates
 * the item at `order = index + 1` after bumping every existing item with `order > index`.
 */
export function timedInsertIndex(
  items: { order: number; startTime: string | null }[],
  startTime: string | null | undefined,
): number {
  if (!startTime) return items.length;
  const ordered = [...items].sort((a, b) => a.order - b.order);
  const idx = ordered.findIndex(
    (it) => it.startTime == null || it.startTime > startTime,
  );
  return idx === -1 ? ordered.length : idx;
}
