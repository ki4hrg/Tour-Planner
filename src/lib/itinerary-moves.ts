import { planCrossDayMove } from "./schedule-move";

// Client-side preview of an itinerary drag (day reorder, item move, planned-
// location move), applied optimistically while the server action runs. Mirrors
// the server rules so the preview lands where the revalidated page will:
//  - days take the slot's date (a date belongs to the slot, not the day);
//  - a same-day item move is a plain reorder (times re-cascade on the server);
//  - a cross-day item move lands per planCrossDayMove (timed → by time);
//  - a planned location already on the target day collapses into it.

type DayShape = {
  id: string;
  dayIndex: number;
  date: string | null;
  items: { id: string; startTime: string | null }[];
  plannedLocations?: { id: string; locationId: string }[];
};

export type ItineraryMove =
  | { kind: "days"; orderedIds: string[] }
  | { kind: "item"; itemId: string; toDayId: string; toIndex: number }
  | { kind: "planned"; id: string; toDayId: string };

export function applyItineraryMove<D extends DayShape>(
  days: D[],
  move: ItineraryMove,
): D[] {
  if (move.kind === "days") {
    const byId = new Map(days.map((d) => [d.id, d]));
    const reordered = move.orderedIds
      .map((id) => byId.get(id))
      .filter((d): d is D => d != null);
    if (reordered.length !== days.length) return days;
    return reordered.map((d, i) => ({
      ...d,
      dayIndex: i + 1,
      date: days[i].date,
    }));
  }

  if (move.kind === "item") {
    const from = days.find((d) => d.items.some((it) => it.id === move.itemId));
    const to = days.find((d) => d.id === move.toDayId);
    if (!from || !to) return days;
    const item = from.items.find((it) => it.id === move.itemId)!;
    if (from.id === to.id) {
      const rest = from.items.filter((it) => it.id !== item.id);
      const at = Math.max(0, Math.min(move.toIndex, rest.length));
      const items = [...rest.slice(0, at), item, ...rest.slice(at)];
      return days.map((d) => (d.id === from.id ? { ...d, items } : d));
    }
    const pos = (list: { id: string; startTime: string | null }[]) =>
      list.map((it, i) => ({ id: it.id, order: i + 1, startTime: it.startTime }));
    const { index } = planCrossDayMove(
      { id: item.id, order: 0, startTime: item.startTime },
      pos(from.items),
      pos(to.items),
      to.id,
      move.toIndex,
    );
    return days.map((d) => {
      if (d.id === from.id) {
        return { ...d, items: d.items.filter((it) => it.id !== item.id) };
      }
      if (d.id === to.id) {
        return {
          ...d,
          items: [...d.items.slice(0, index), item, ...d.items.slice(index)],
        };
      }
      return d;
    });
  }

  const from = days.find((d) =>
    (d.plannedLocations ?? []).some((p) => p.id === move.id),
  );
  if (!from || from.id === move.toDayId) return days;
  const row = from.plannedLocations!.find((p) => p.id === move.id)!;
  return days.map((d) => {
    if (d.id === from.id) {
      return {
        ...d,
        plannedLocations: d.plannedLocations!.filter((p) => p.id !== move.id),
      };
    }
    if (d.id === move.toDayId) {
      const planned = d.plannedLocations ?? [];
      return planned.some((p) => p.locationId === row.locationId)
        ? d
        : { ...d, plannedLocations: [...planned, row] };
    }
    return d;
  });
}
