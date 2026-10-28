// One booking per venue per trip: a schedule item AT a venue is covered by the
// (trip, venue) engagement, so an item-targeted booking on it is a stray —
// legacy per-session rows ("Lunch", "Compline" each booked separately at the
// same college), or a site-less item booking whose item later gained a venue.
// Folding moves each into its venue's engagement (creating the engagement
// from it when there is none yet). Prisma-aware, no revalidatePath (MCP-safe).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { foldBookingInto } from "./location-merge";

type Tx = Prisma.TransactionClient;

/**
 * Fold the item bookings on venue items into their venue engagements —
 * scoped to one item, one trip, or (no scope) everything. The venue is the
 * item site the booking named (else the item's first site), resolved through
 * "booked via" to the engaged parent. Returns how many bookings folded.
 */
export async function foldSessionBookings(
  tx: Tx,
  scope: { scheduleItemId?: string; tripId?: string } = {},
): Promise<number> {
  const strays = await tx.booking.findMany({
    where: {
      scheduleItemId: scope.scheduleItemId ?? { not: null },
      scheduleItem: {
        sites: { some: {} },
        ...(scope.tripId ? { day: { tripId: scope.tripId } } : {}),
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      locationId: true,
      scheduleItem: {
        select: {
          day: { select: { tripId: true } },
          sites: {
            orderBy: { order: "asc" },
            select: { locationId: true, location: { select: { bookedViaId: true } } },
          },
        },
      },
    },
  });
  for (const b of strays) {
    const item = b.scheduleItem!;
    const site =
      item.sites.find((s) => s.locationId === b.locationId) ?? item.sites[0];
    const locationId = site.location.bookedViaId ?? site.locationId;
    const tripId = item.day.tripId;
    const engagement = await tx.booking.findUnique({
      where: { tripId_locationId: { tripId, locationId } },
      select: { id: true },
    });
    if (engagement) {
      await foldBookingInto(tx, b.id, engagement.id);
    } else {
      // The stray becomes the engagement, keeping everything on it.
      await tx.booking.update({
        where: { id: b.id },
        data: { scheduleItemId: null, tripId, locationId },
      });
    }
  }
  return strays.length;
}

/**
 * Boot-time repair: fold every stray across all trips, one transaction per
 * trip. Idempotent — a no-op once nothing is left to fold.
 */
export async function foldAllSessionBookings(): Promise<number> {
  const trips = await prisma.scheduleItem.findMany({
    where: { bookings: { some: {} }, sites: { some: {} } },
    select: { day: { select: { tripId: true } } },
  });
  let folded = 0;
  for (const tripId of new Set(trips.map((t) => t.day.tripId))) {
    folded += await prisma.$transaction((tx) => foldSessionBookings(tx, { tripId }));
  }
  return folded;
}
