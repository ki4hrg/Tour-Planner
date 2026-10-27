import { prisma } from "./db";
import {
  BOOKING_PROGRESS_SELECT,
  progressView,
  type BookingProgressView,
} from "./booking-workflow";

/**
 * Workflow progress of a trip's venue engagements, keyed by location id — the
 * itinerary surfaces show it beside each venue. Bookable venues only; a venue
 * with no engagement yet gets a not-yet-created view (its first touch seeds
 * the venue's default workflow). Date-free, so it can cross to the client.
 */
export async function loadVenueEngagements(
  tripId: string,
  locationIds: Iterable<string>,
): Promise<Record<string, BookingProgressView>> {
  const ids = [...new Set(locationIds)];
  if (ids.length === 0) return {};
  const [locations, bookings] = await Promise.all([
    prisma.location.findMany({
      where: { id: { in: ids }, bookable: true },
      select: { id: true, defaultWorkflowId: true },
    }),
    prisma.booking.findMany({
      where: { tripId, locationId: { in: ids } },
      select: { locationId: true, ...BOOKING_PROGRESS_SELECT },
    }),
  ]);
  const byLocation = new Map(bookings.map((b) => [b.locationId, b]));
  return Object.fromEntries(
    locations.map((l) => [
      l.id,
      progressView(byLocation.get(l.id) ?? null, l.defaultWorkflowId),
    ]),
  );
}
