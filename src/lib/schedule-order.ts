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

/**
 * After an item's start time changes, where it should sit in the day's manual
 * sequence. The sequence is the planner's, so it's only disturbed when the edit
 * actually broke chronology: if the item still starts no earlier than the timed
 * item before it and no later than the timed item after it (untimed neighbours
 * are skipped), it stays put. Otherwise it's re-slotted by `timedInsertIndex`
 * among the others. An untimed item never moves.
 *
 * `items` are the day's items with their POST-edit times. Returns the new id
 * order, or null when nothing moves.
 */
export function reslotAfterTimeEdit(
  items: { id: string; order: number; startTime: string | null }[],
  editedId: string,
): string[] | null {
  const ordered = [...items].sort((a, b) => a.order - b.order);
  const at = ordered.findIndex((it) => it.id === editedId);
  if (at === -1) return null;
  const start = ordered[at].startTime;
  if (!start) return null;

  const prev = ordered.slice(0, at).reverse().find((it) => it.startTime != null);
  const next = ordered.slice(at + 1).find((it) => it.startTime != null);
  const inOrder =
    (!prev || prev.startTime! <= start) && (!next || next.startTime! >= start);
  if (inOrder) return null;

  const others = ordered.filter((it) => it.id !== editedId);
  const idx = timedInsertIndex(others, start);
  const ids = others.map((it) => it.id);
  ids.splice(idx, 0, editedId);
  return ids;
}
