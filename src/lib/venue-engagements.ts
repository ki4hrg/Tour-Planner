import { prisma } from "./db";
import {
  BOOKING_PROGRESS_SELECT,
  progressView,
  type BookingProgressView,
} from "./booking-workflow";
import { bookedViaMap, engagementLocationId } from "./booked-via";

// One venue's engagement as the itinerary shows it. `via` names the parent
// venue whose engagement covers a site booked via one (null = its own).
export type VenueEngagementView = {
  progress: BookingProgressView;
  via: { id: string; name: string } | null;
};

/**
 * Workflow progress of a trip's venue engagements, keyed by location id — the
 * itinerary surfaces show it beside each venue. Bookable venues only; a venue
 * with no engagement yet gets a not-yet-created view (its first touch seeds
 * the venue's default workflow). A site booked via a parent shows the
 * PARENT's engagement (`via`). Date-free, so it can cross to the client.
 */
export async function loadVenueEngagements(
  tripId: string,
  locationIds: Iterable<string>,
): Promise<Record<string, VenueEngagementView>> {
  const ids = [...new Set(locationIds)];
  if (ids.length === 0) return {};
  const locations = await prisma.location.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      bookable: true,
      defaultWorkflowId: true,
      bookedViaId: true,
      bookedVia: {
        select: { id: true, name: true, bookable: true, defaultWorkflowId: true },
      },
    },
  });
  const viaMap = bookedViaMap(locations);
  const venueIds = [...new Set(ids.map((id) => engagementLocationId(id, viaMap)))];
  const bookings = await prisma.booking.findMany({
    where: { tripId, locationId: { in: venueIds } },
    select: { locationId: true, ...BOOKING_PROGRESS_SELECT },
  });
  const byLocation = new Map(bookings.map((b) => [b.locationId, b]));
  const out: Record<string, VenueEngagementView> = {};
  for (const l of locations) {
    const parent = l.bookedVia;
    // The engaged venue (the parent, when booked via one) must be bookable.
    if (!(parent ? parent.bookable : l.bookable)) continue;
    const venueId = parent?.id ?? l.id;
    out[l.id] = {
      progress: progressView(
        byLocation.get(venueId) ?? null,
        parent ? parent.defaultWorkflowId : l.defaultWorkflowId,
      ),
      via: parent ? { id: parent.id, name: parent.name } : null,
    };
  }
  return out;
}
