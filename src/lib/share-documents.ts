import type { Prisma, ShareAudience } from "@prisma/client";

/**
 * Which documents a share link's trip *reaches* — scope only, before any
 * audience release is considered.
 *
 * For a STAFF or PARTICIPANT link that's the trip itself plus everything hanging
 * off it: its bookings (venue engagements and site-less item bookings alike) and
 * its stays. Venue documents are deliberately absent — a `Location`'s files are
 * global across every trip that visits it, so exposing them through one trip's
 * link would leak another trip's paperwork.
 *
 * A HOST_SITE link is scoped to one venue, so it narrows to that venue's own
 * documents, the engagement for it, stays there, and trip-level documents. Its
 * own venue files ARE included: they are the host's own paperwork. A HOST_SITE
 * link with no venue (its location was deleted) reaches nothing.
 */
export function shareableDocumentWhere(
  tripId: string,
  audience: ShareAudience,
  scopedLocationId: string | null,
): Prisma.DocumentWhereInput {
  if (audience === "HOST_SITE") {
    // A host-site link whose venue was deleted (FK SET NULL) must fail closed —
    // never widen to the whole trip. `id IN ()` matches nothing.
    if (!scopedLocationId) return { id: { in: [] } };
    return {
      OR: [
        { locationId: scopedLocationId },
        { booking: { tripId, locationId: scopedLocationId } },
        { stay: { tripId, locationId: scopedLocationId } },
        { tripId },
      ],
    };
  }
  return {
    OR: [
      { tripId },
      {
        booking: {
          OR: [{ tripId }, { scheduleItem: { day: { tripId } } }],
        },
      },
      { stay: { tripId } },
    ],
  };
}

/**
 * The complete filter for documents a share link may serve: in scope AND
 * released to the audience.
 *
 * A STAFF link carries no release filter — it is the authenticated view under a
 * token and sees the trip's whole file set. Every other audience sees only what
 * a planner explicitly ticked for them.
 */
export function shareDocumentWhere(link: {
  tripId: string;
  audience: ShareAudience;
  locationId: string | null;
}): Prisma.DocumentWhereInput {
  const scope = shareableDocumentWhere(
    link.tripId,
    link.audience,
    link.locationId,
  );
  if (link.audience === "STAFF") return scope;
  return { AND: [scope, { shareAudiences: { has: link.audience } }] };
}
