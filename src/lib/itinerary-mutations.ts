// Reordering and moving itinerary pieces — days, schedule items, rough-plan
// locations — shared by the web Server Actions (`trips/actions.ts`, which add
// auth + revalidation) and the MCP itinerary tools. No auth and no
// revalidatePath here (MCP-safe; see trip-mutations.ts for the pattern).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeDayDate, dayIndexForDate, formatDate } from "@/lib/dates";
import { cascadeReorderedTimes } from "@/lib/schedule-reorder";
import { planCrossDayMove } from "@/lib/schedule-move";
import { reslotAfterTimeEdit } from "@/lib/schedule-order";
import {
  shiftStayDates,
  staysFollowingDays,
  type StayFollow,
} from "@/lib/stay-shift";

type Result<T = object> = ({ ok: true } & T) | { error: string };

// --- Days + the lodging that may follow them ---

/** A stay a day reorder would carry along (or can't), described for a prompt. */
export type StayFollowLine = {
  stayId: string;
  name: string; // the lodging venue
  from: string; // "Tue, 2 Jun 2027 – Thu, 4 Jun 2027" or "Day 2 – Day 4"
  to: string | null; // null when the stay can't follow (its days split up)
};

async function loadDayOrder(tripId: string, orderedDayIds: string[]) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      startDate: true,
      days: { orderBy: { dayIndex: "asc" }, select: { id: true } },
      stays: {
        select: {
          id: true,
          checkIn: true,
          checkOut: true,
          checkInDayIndex: true,
          checkOutDayIndex: true,
          location: { select: { name: true } },
        },
      },
    },
  });
  if (!trip) return { error: "Trip not found." } as const;
  // The ids must be exactly this trip's days — no foreign ids (which would
  // renumber another trip's days), no omissions, no duplicates.
  const own = new Set(trip.days.map((d) => d.id));
  if (
    orderedDayIds.length !== own.size ||
    new Set(orderedDayIds).size !== orderedDayIds.length ||
    !orderedDayIds.every((id) => own.has(id))
  ) {
    return { error: "Day list out of date." } as const;
  }

  // Each stay as day positions (dated trip: from its dates; template: indices).
  const spans = trip.stays.flatMap((s) => {
    const checkIn = s.checkInDayIndex ?? dayIndexForDate(trip.startDate, s.checkIn);
    const checkOut =
      s.checkOutDayIndex ?? dayIndexForDate(trip.startDate, s.checkOut);
    return checkIn != null && checkOut != null
      ? [{ id: s.id, checkIn, checkOut }]
      : [];
  });
  const follows = staysFollowingDays(
    trip.days.map((d) => d.id),
    orderedDayIds,
    spans,
  );
  return { trip, spans, follows };
}

function spanLabel(
  startDate: Date | null,
  checkIn: number,
  checkOut: number,
): string {
  if (!startDate) return `Day ${checkIn} – Day ${checkOut}`;
  return `${formatDate(computeDayDate(startDate, checkIn))} – ${formatDate(
    computeDayDate(startDate, checkOut),
  )}`;
}

/**
 * The lodging a day reorder would affect, without changing anything: stays
 * that would move with their days, and stays whose days split up (can't
 * follow). Empty = the reorder leaves every stay's days where they were.
 */
export async function previewDayReorder(
  tripId: string,
  orderedDayIds: string[],
): Promise<Result<{ stays: StayFollowLine[] }>> {
  const loaded = await loadDayOrder(tripId, orderedDayIds);
  if ("error" in loaded) return { error: loaded.error as string };
  const { trip, spans, follows } = loaded;
  const byId = new Map(spans.map((s) => [s.id, s]));
  const names = new Map(trip.stays.map((s) => [s.id, s.location.name]));
  return {
    ok: true,
    stays: follows.map((f) => {
      const span = byId.get(f.id)!;
      return {
        stayId: f.id,
        name: names.get(f.id) ?? "Stay",
        from: spanLabel(trip.startDate, span.checkIn, span.checkOut),
        to:
          f.kind === "move"
            ? spanLabel(trip.startDate, span.checkIn + f.delta, span.checkOut + f.delta)
            : null,
      };
    }),
  };
}

/**
 * Renumber a trip's days into `orderedDayIds` (each slot keeps its date —
 * dates derive from startDate + dayIndex). With `moveStays`, lodging whose
 * nights moved together shifts with them in the same transaction; stays
 * whose days split up are left and counted in `split`.
 */
export async function reorderTripDays(
  tripId: string,
  orderedDayIds: string[],
  opts: { moveStays?: boolean } = {},
): Promise<Result<{ movedStays: number; splitStays: number }>> {
  const loaded = await loadDayOrder(tripId, orderedDayIds);
  if ("error" in loaded) return { error: loaded.error as string };
  const { trip, follows } = loaded;
  const moves = opts.moveStays
    ? follows.filter((f): f is Extract<StayFollow, { kind: "move" }> => f.kind === "move")
    : [];
  const stayById = new Map(trip.stays.map((s) => [s.id, s]));

  await prisma.$transaction([
    ...orderedDayIds.map((id, i) =>
      prisma.itineraryDay.update({
        where: { id, tripId },
        data: { dayIndex: i + 1, date: computeDayDate(trip.startDate, i + 1) },
      }),
    ),
    ...moves.map((m) => {
      const s = stayById.get(m.id)!;
      return prisma.stay.update({
        where: { id: m.id },
        data:
          s.checkIn && s.checkOut
            ? shiftStayDates({ checkIn: s.checkIn, checkOut: s.checkOut }, m.delta)
            : {
                checkInDayIndex: s.checkInDayIndex! + m.delta,
                checkOutDayIndex: s.checkOutDayIndex! + m.delta,
              },
      });
    }),
  ]);
  return {
    ok: true,
    movedStays: moves.length,
    splitStays: follows.filter((f) => f.kind === "split").length,
  };
}

// --- Schedule items ---

/**
 * Re-sequence a day's items. Times move with the sequence: a moved item keeps
 * its own duration while the day's anchor + free-time gaps are preserved (see
 * cascadeReorderedTimes); fixed-time items keep their times. Ids not on the day
 * are ignored.
 */
export async function reorderDayItems(
  dayId: string,
  orderedItemIds: string[],
): Promise<Result<{ tripId: string }>> {
  const day = await prisma.itineraryDay.findUnique({
    where: { id: dayId },
    select: {
      tripId: true,
      scheduleItems: {
        select: { id: true, startTime: true, endTime: true, fixedTime: true },
      },
    },
  });
  if (!day) return { error: "Day not found." };
  const reordered = cascadeReorderedTimes(day.scheduleItems, orderedItemIds);
  await prisma.$transaction(
    reordered.map((it) =>
      prisma.scheduleItem.update({
        where: { id: it.id },
        data: { order: it.order, startTime: it.startTime, endTime: it.endTime },
      }),
    ),
  );
  return { ok: true, tripId: day.tripId };
}

/**
 * After an item's times were edited (inside the caller's txn), move it to its
 * chronological slot when the edit broke the day's sequence (see
 * reslotAfterTimeEdit) and renumber. A no-op when it still fits where it is.
 */
export async function reslotEditedItem(
  tx: Prisma.TransactionClient,
  dayId: string,
  itemId: string,
): Promise<void> {
  const items = await tx.scheduleItem.findMany({
    where: { dayId },
    select: { id: true, order: true, startTime: true },
  });
  const ids = reslotAfterTimeEdit(items, itemId);
  if (!ids) return;
  for (let i = 0; i < ids.length; i++) {
    await tx.scheduleItem.update({
      where: { id: ids[i] },
      data: { order: i + 1 },
    });
  }
}

/**
 * Move an item to `toIndex` (0-based, among the target day's OTHER items) on
 * `toDayId`. Same day = a reorder (times cascade). Another day of the same
 * trip: the item keeps its times and lands by them (planCrossDayMove); both
 * days renumber in one txn.
 */
export async function moveItemToDay(
  itemId: string,
  toDayId: string,
  toIndex: number,
): Promise<Result<{ tripId: string }>> {
  if (!Number.isInteger(toIndex)) return { error: "Invalid position." };
  const item = await prisma.scheduleItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      order: true,
      startTime: true,
      dayId: true,
      day: { select: { tripId: true } },
    },
  });
  if (!item) return { error: "Item not found." };
  const target = await prisma.itineraryDay.findUnique({
    where: { id: toDayId },
    select: { tripId: true },
  });
  if (!target || target.tripId !== item.day.tripId) {
    return { error: "Day not found." };
  }

  if (toDayId === item.dayId) {
    const ids = (
      await prisma.scheduleItem.findMany({
        where: { dayId: toDayId },
        orderBy: { order: "asc" },
        select: { id: true },
      })
    )
      .map((r) => r.id)
      .filter((id) => id !== itemId);
    ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, itemId);
    return reorderDayItems(toDayId, ids);
  }

  const select = { id: true, order: true, startTime: true } as const;
  const [sourceItems, targetItems] = await Promise.all([
    prisma.scheduleItem.findMany({ where: { dayId: item.dayId }, select }),
    prisma.scheduleItem.findMany({ where: { dayId: toDayId }, select }),
  ]);
  const { updates } = planCrossDayMove(
    item,
    sourceItems,
    targetItems,
    toDayId,
    toIndex,
  );
  await prisma.$transaction(
    updates.map((u) =>
      prisma.scheduleItem.update({
        where: { id: u.id },
        data: { order: u.order, ...(u.dayId ? { dayId: u.dayId } : {}) },
      }),
    ),
  );
  return { ok: true, tripId: item.day.tripId };
}

// --- Rough-plan (planned) locations ---

/**
 * Move a rough-plan location to another day of the same trip. If that day
 * already plans the location, the two collapse into the existing row (its note
 * kept, the moved note appended when they differ).
 */
export async function movePlannedLocationTo(
  id: string,
  toDayId: string,
): Promise<Result<{ tripId: string }>> {
  const row = await prisma.itineraryDayLocation.findUnique({
    where: { id },
    select: {
      dayId: true,
      locationId: true,
      note: true,
      day: { select: { tripId: true } },
    },
  });
  if (!row) return { error: "Planned location not found." };
  if (row.dayId === toDayId) return { ok: true, tripId: row.day.tripId };
  const target = await prisma.itineraryDay.findUnique({
    where: { id: toDayId },
    select: { tripId: true },
  });
  if (!target || target.tripId !== row.day.tripId) {
    return { error: "Day not found." };
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.itineraryDayLocation.findUnique({
      where: { dayId_locationId: { dayId: toDayId, locationId: row.locationId } },
      select: { id: true, note: true },
    });
    if (existing) {
      if (row.note && row.note !== existing.note) {
        await tx.itineraryDayLocation.update({
          where: { id: existing.id },
          data: { note: existing.note ? `${existing.note}; ${row.note}` : row.note },
        });
      }
      await tx.itineraryDayLocation.delete({ where: { id } });
    } else {
      const count = await tx.itineraryDayLocation.count({ where: { dayId: toDayId } });
      await tx.itineraryDayLocation.update({
        where: { id },
        data: { dayId: toDayId, order: count },
      });
    }
  });
  return { ok: true, tripId: row.day.tripId };
}
