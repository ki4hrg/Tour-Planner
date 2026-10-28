// Shared, non-"use server" mutation helpers used by BOTH the web Server Actions
// (`src/app/(app)/trips/actions.ts`, `src/app/(app)/documents/actions.ts`) and
// the MCP tools (`src/lib/mcp/tools/*`). Plain helpers must never be exported
// from a "use server" file — every export there becomes a public endpoint — so
// the logic lives here and each caller does its own auth.
//
// No revalidatePath here — MCP-safe; web callers revalidate themselves.

import {
  Prisma,
  type PaymentAnchor,
  type PaymentOffsetUnit,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeDayDate, dayIndexForDate } from "@/lib/dates";
import { seedWorkflowFor } from "@/lib/booking-workflow-sync";
import { engagementLocationIdFor } from "@/lib/booked-via.server";
import {
  shiftStayDates,
  shiftStayIndicesForDeletedDay,
  startDateShiftDays,
} from "@/lib/stay-shift";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

// --- Venue engagements ---

/** A location flagged not-bookable (a walk-by stop) can never hold a booking.
 * Returns an error message, or null when the location may be booked. */
export async function assertBookable(
  locationId: string,
  db: Db = prisma,
): Promise<string | null> {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: { bookable: true },
  });
  if (!loc) return "Location not found.";
  if (!loc.bookable) return "This site is marked not bookable.";
  return null;
}

export type LocationScheduleSeed = {
  label: string | null;
  percent: Prisma.Decimal | null;
  fixedAmount: Prisma.Decimal | null;
  anchor: PaymentAnchor;
  offsetValue: number | null;
  offsetUnit: PaymentOffsetUnit | null;
  sortOrder: number;
};

export function toScheduleSeed(d: LocationScheduleSeed): LocationScheduleSeed {
  return {
    label: d.label,
    percent: d.percent,
    fixedAmount: d.fixedAmount,
    anchor: d.anchor,
    offsetValue: d.offsetValue,
    offsetUnit: d.offsetUnit,
    sortOrder: d.sortOrder,
  };
}

/**
 * A venue's standing payment terms (GH #86) pre-fill a NEW engagement's
 * schedule. Returns Prisma nested-create data for `Booking.paymentSchedule`, or
 * undefined when the location carries no default. Only ever used on the create
 * branch — an existing engagement keeps whatever schedule it already has.
 */
export async function seedScheduleFromLocation(
  locationId: string,
  db: Db = prisma,
): Promise<{ create: LocationScheduleSeed[] } | undefined> {
  const defaults = await db.locationPaymentScheduleItem.findMany({
    where: { locationId },
    orderBy: { sortOrder: "asc" },
  });
  if (!defaults.length) return undefined;
  return { create: defaults.map(toScheduleSeed) };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/**
 * Make sure a (trip, location) engagement exists and return its id. Create-
 * only: an engagement that already exists is left exactly as it is. A new one
 * gets the bookable check and standing-terms seeding like every other create
 * path. Two concurrent first creates can race past the upsert's read and hit
 * the `@@unique([tripId, locationId])`; the loser re-reads the winner's row.
 * A site booked via a parent resolves to the PARENT's engagement.
 */
export async function ensureVenueEngagement(
  tripId: string,
  siteId: string,
): Promise<{ error: string } | { bookingId: string }> {
  const locationId = await engagementLocationIdFor(siteId);
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, defaultCurrency: true },
  });
  if (!trip) return { error: "Trip not found." };
  const loc = await prisma.location.findUnique({
    where: { id: locationId },
    select: { archivedAt: true, bookable: true },
  });
  if (!loc) return { error: "Location not found." };
  if (loc.archivedAt) return { error: "This location is archived." };
  // Same rule as assertBookable, folded into the one lookup.
  if (!loc.bookable) return { error: "This site is marked not bookable." };

  const schedule = await seedScheduleFromLocation(locationId);
  const workflow = await seedWorkflowFor(locationId);
  const where = { tripId_locationId: { tripId, locationId } };
  try {
    const booking = await prisma.booking.upsert({
      where,
      create: {
        tripId,
        locationId,
        agreedCurrency: trip.defaultCurrency,
        ...workflow,
        ...(schedule ? { paymentSchedule: schedule } : {}),
      },
      update: {},
      select: { id: true },
    });
    return { bookingId: booking.id };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await prisma.booking.findUnique({
      where,
      select: { id: true },
    });
    if (!existing) throw err;
    return { bookingId: existing.id };
  }
}

// --- Itinerary days + stays ---

/** Renumber a trip's days 1..n by current dayIndex and recompute each date. */
export async function recomputeDayDates(
  tx: Tx,
  tripId: string,
  startDate: Date | null,
) {
  const days = await tx.itineraryDay.findMany({
    where: { tripId },
    orderBy: { dayIndex: "asc" },
    select: { id: true },
  });
  for (let i = 0; i < days.length; i++) {
    await tx.itineraryDay.update({
      where: { id: days[i].id },
      data: { dayIndex: i + 1, date: computeDayDate(startDate, i + 1) },
    });
  }
}

/** Move every dated stay on a trip by `deltaDays` (both ends). Day-indexed
 * (template) stays are relative already and need no shift. */
export async function shiftDatedStays(
  tx: Tx,
  tripId: string,
  deltaDays: number,
) {
  const stays = await tx.stay.findMany({
    where: { tripId, checkIn: { not: null }, checkOut: { not: null } },
    select: { id: true, checkIn: true, checkOut: true },
  });
  for (const s of stays) {
    if (!s.checkIn || !s.checkOut) continue;
    await tx.stay.update({
      where: { id: s.id },
      data: shiftStayDates(
        { checkIn: s.checkIn, checkOut: s.checkOut },
        deltaDays,
      ),
    });
  }
}

/**
 * After a trip's startDate changed from `before` to `after` (already written),
 * recompute every day's date and move dated stays by the same delta so lodging
 * stays on the same trip nights. dated ↔ date-less transitions have no delta
 * and leave stays alone.
 */
export async function applyStartDateChange(
  tx: Tx,
  tripId: string,
  before: Date | null,
  after: Date | null,
) {
  await recomputeDayDates(tx, tripId, after);
  const delta = startDateShiftDays(before, after);
  if (delta !== 0) await shiftDatedStays(tx, tripId, delta);
}

/**
 * After day `deletedIndex` is removed (and later days renumber down), pull each
 * stay's anchors down to match. Template stays shift by day index; dated stays
 * are measured against `startDate`, shifted the same way, and written back as
 * dates. A stay that covered ONLY the deleted night is left untouched (never
 * silently dropped) — the count comes back so the caller can say so.
 */
export async function shiftStaysForDeletedDay(
  tx: Tx,
  tripId: string,
  deletedIndex: number,
  startDate: Date | null,
): Promise<number> {
  const stays = await tx.stay.findMany({
    where: { tripId },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      checkInDayIndex: true,
      checkOutDayIndex: true,
    },
  });
  let collapsed = 0;
  for (const s of stays) {
    const dated = s.checkIn != null && s.checkOut != null;
    const range = dated
      ? {
          checkInDayIndex: dayIndexForDate(startDate, s.checkIn),
          checkOutDayIndex: dayIndexForDate(startDate, s.checkOut),
        }
      : {
          checkInDayIndex: s.checkInDayIndex,
          checkOutDayIndex: s.checkOutDayIndex,
        };
    if (range.checkInDayIndex == null || range.checkOutDayIndex == null)
      continue;
    const next = shiftStayIndicesForDeletedDay(
      {
        checkInDayIndex: range.checkInDayIndex,
        checkOutDayIndex: range.checkOutDayIndex,
      },
      deletedIndex,
    );
    if (next.kind === "collapsed") collapsed++;
    if (next.kind !== "shift") continue;
    await tx.stay.update({
      where: { id: s.id },
      data: dated
        ? {
            checkIn: computeDayDate(startDate, next.checkInDayIndex),
            checkOut: computeDayDate(startDate, next.checkOutDayIndex),
          }
        : {
            checkInDayIndex: next.checkInDayIndex,
            checkOutDayIndex: next.checkOutDayIndex,
          },
    });
  }
  return collapsed;
}

/**
 * Delete an itinerary day, renumber/redate the remaining days, and pull stays
 * along — all in one transaction. The trip row is locked first (as `addDay`
 * does) and the day's index / trip start are read INSIDE the lock, so a
 * concurrent add/delete can't renumber under us. Returns the owning trip and
 * the count of stays that covered only the deleted night (left untouched).
 */
export async function deleteItineraryDay(
  dayId: string,
): Promise<{ error: string } | { tripId: string; collapsedStays: number }> {
  const owner = await prisma.itineraryDay.findUnique({
    where: { id: dayId },
    select: { tripId: true },
  });
  if (!owner) return { error: "Day not found." };
  const tripId = owner.tripId;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Trip" WHERE "id" = ${tripId} FOR UPDATE`;
    const day = await tx.itineraryDay.findUnique({
      where: { id: dayId },
      select: {
        tripId: true,
        dayIndex: true,
        trip: { select: { startDate: true } },
      },
    });
    // Deleted (or moved) by a concurrent request while we waited on the lock.
    if (!day || day.tripId !== tripId) return { error: "Day not found." };

    await tx.itineraryDay.delete({ where: { id: dayId } }); // cascades to items
    await recomputeDayDates(tx, tripId, day.trip.startDate);
    // Later days just renumbered/redated down by one — pull lodging along.
    const collapsedStays = await shiftStaysForDeletedDay(
      tx,
      tripId,
      day.dayIndex,
      day.trip.startDate,
    );
    return { tripId, collapsedStays };
  });
}

/**
 * The currency a NEW booking on a trip starts in (`Trip.defaultCurrency`),
 * looked up from the engagement's trip or the item's day. USD when the trip
 * can't be found (the caller's own lookup reports that).
 */
export async function tripDefaultCurrencyFor(
  target: { tripId: string } | { scheduleItemId: string },
): Promise<string> {
  if ("tripId" in target) {
    const t = await prisma.trip.findUnique({
      where: { id: target.tripId },
      select: { defaultCurrency: true },
    });
    return t?.defaultCurrency ?? "USD";
  }
  const item = await prisma.scheduleItem.findUnique({
    where: { id: target.scheduleItemId },
    select: { day: { select: { trip: { select: { defaultCurrency: true } } } } },
  });
  return item?.day.trip.defaultCurrency ?? "USD";
}
