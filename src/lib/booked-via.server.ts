// DB-aware side of "booked via" parent venues (see booked-via.ts for the
// rules). Plain module — no "use server", no revalidatePath — so both the web
// Server Actions and the MCP tools call it.

import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { bookedViaError } from "./booked-via";
import { foldVenueEngagements } from "./location-merge";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * The location whose (trip, location) engagement covers `locationId`: its
 * parent when it is booked via one, else itself. Unknown ids pass through so
 * the caller's own "not found" check still fires.
 */
export async function engagementLocationIdFor(
  locationId: string,
  db: Db = prisma,
): Promise<string> {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: { bookedViaId: true },
  });
  return loc?.bookedViaId ?? locationId;
}

/** Validate a proposed parent for `locationId` (null = a location being created). */
export async function checkBookedVia(
  locationId: string | null,
  parentId: string,
  db: Db = prisma,
): Promise<string | null> {
  const [parent, covered] = await Promise.all([
    db.location.findUnique({
      where: { id: parentId },
      select: {
        name: true,
        bookedViaId: true,
        bookable: true,
        bookedVia: { select: { name: true } },
      },
    }),
    locationId
      ? db.location.count({ where: { bookedViaId: locationId } })
      : Promise.resolve(0),
  ]);
  return bookedViaError({
    locationId,
    parentId,
    hasCoveredSites: covered > 0,
    parent: parent && {
      name: parent.name,
      bookedViaId: parent.bookedViaId,
      bookedViaName: parent.bookedVia?.name ?? null,
      bookable: parent.bookable,
    },
  });
}

/** Trips where `locationId` holds its own engagement — what setting a parent folds. */
export async function engagementsToFold(
  locationId: string,
  db: Db = prisma,
): Promise<{ tripId: string; tripName: string }[]> {
  const rows = await db.booking.findMany({
    where: { locationId, tripId: { not: null } },
    select: { trip: { select: { id: true, name: true } } },
    orderBy: { trip: { name: "asc" } },
  });
  return rows.flatMap((r) =>
    r.trip ? [{ tripId: r.trip.id, tripName: r.trip.name }] : [],
  );
}

/**
 * Set (or clear, with null) the location's "booked via" parent. Gaining a
 * parent hands the location's own engagements to the parent: each folds into
 * the parent's engagement on the same trip (same rules as a location merge —
 * payments, notes, documents and step progress move, the further-along status
 * wins) or is repointed to the parent where it has none. Returns how many
 * engagements moved. Runs in one transaction.
 */
export async function setBookedVia(
  locationId: string,
  parentId: string | null,
): Promise<{ error: string } | { folded: number }> {
  try {
    return await prisma.$transaction(async (tx) => {
      if (parentId) {
        const err = await checkBookedVia(locationId, parentId, tx);
        if (err) throw new BookedViaError(err);
      }
      await tx.location.update({
        where: { id: locationId },
        data: { bookedViaId: parentId },
      });
      const folded = parentId
        ? await foldVenueEngagements(tx, locationId, parentId)
        : 0;
      return { folded };
    });
  } catch (err) {
    if (err instanceof BookedViaError) return { error: err.message };
    throw err;
  }
}

class BookedViaError extends Error {}
