/**
 * Participant/host-site calendar (.ics) feeds, tied to a ShareLink (GH #81).
 *
 * A ShareLink already carries an audience preset + optional host-site scope; this
 * module renders the SAME itinerary a `/share/[token]` page shows, as iCalendar
 * events. The redaction is applied server-side BEFORE events are built — never by
 * omitting fields at render — so a PARTICIPANT / HOST_SITE feed can never carry
 * bookings, contacts, or internal (logistical) notes even in the raw payload,
 * exactly mirroring `redactDaysForShare` on the HTML share page.
 *
 * Pure: takes serialized data, returns IcsEvents. The route handler supplies the DB
 * reads and the generation stamp.
 */

import type { ShareAudience } from "@prisma/client";
import {
  audienceView,
  isOrphanedScopedLink,
  redactDaysForShare,
  scopeDaysToLocation,
} from "./share";
import { buildTripEvents, type FeedStay } from "./calendar-feed";
import type { SerializedDay } from "./trips";
import type { IcsEvent } from "./ics";

/** A lodging stay for a share feed — a `FeedStay` plus the location it anchors to,
 * so a HOST_SITE feed can keep only stays at its site. */
export interface ShareFeedStay extends FeedStay {
  locationId: string;
}

/** A trip's raw (unredacted) serialized itinerary for a share feed. */
export interface ShareFeedTrip {
  id: string;
  name: string;
  notes: string | null;
  startDate: string | null; // "YYYY-MM-DD"
  endDate: string | null;
  days: SerializedDay[];
  stays: ShareFeedStay[];
}

/**
 * Build the iCalendar events for a ShareLink feed, applying the audience's
 * redaction first:
 *  - HOST_SITE: scope both the itinerary and lodging to the one host site;
 *  - non-STAFF: strip bookings (via `redactDaysForShare`) and every layer of
 *    staff logistics — day logistical notes, trip-level notes, and stay notes.
 *
 * STAFF share feeds are full-detail (same as the staff CalendarFeed). A
 * HOST_SITE link whose venue was deleted (null `locationId`) yields NO events —
 * fail closed rather than widening to the whole trip.
 */
export function buildShareFeedEvents(
  audience: ShareAudience,
  trip: ShareFeedTrip,
  locationId: string | null,
): IcsEvent[] {
  const view = audienceView(audience);
  if (isOrphanedScopedLink(audience, locationId)) return [];

  let days = trip.days;
  if (view.scopeToLocation && locationId) {
    days = scopeDaysToLocation(days, locationId);
  }
  // Strip bookings the audience can't see BEFORE they ride along in the payload.
  days = redactDaysForShare(days, view, locationId);

  const scopeStays = view.scopeToLocation && locationId != null;
  const stays: FeedStay[] = view.showLodging
    ? trip.stays
        .filter((s) => !scopeStays || s.locationId === locationId)
        .map((s) => ({
          id: s.id,
          locationName: s.locationName,
          checkIn: s.checkIn,
          checkOut: s.checkOut,
          // Stay notes are staff logistics — never on a participant/host-site feed.
          notes: view.showLogisticalNotes ? s.notes : null,
        }))
    : [];

  return buildTripEvents(
    {
      id: trip.id,
      name: trip.name,
      // Trip-level notes are staff-facing (the /share HTML never renders them) —
      // strip for any audience that doesn't see logistics.
      notes: view.showLogisticalNotes ? trip.notes : null,
      startDate: trip.startDate,
      endDate: trip.endDate,
      days,
      stays,
    },
    { includeLogisticalNotes: view.showLogisticalNotes },
  );
}
