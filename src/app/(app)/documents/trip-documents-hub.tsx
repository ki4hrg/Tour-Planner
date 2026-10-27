import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { scheduleItemPrimaryLabel } from "@/lib/trips";
import {
  bookingDashboardHref,
  DOCUMENT_SELECT,
  serializeDocument,
  stayHref,
} from "@/lib/documents";
import {
  TripDocumentsHubView,
  type HubAttachOption,
  type HubGroup,
  type HubLibraryVenue,
} from "./trip-documents-hub-view";

const DOCS = {
  orderBy: { createdAt: "desc" },
  select: DOCUMENT_SELECT,
} as const;

const VENUE_SELECT = {
  select: {
    id: true,
    name: true,
    bookable: true,
    // A site booked via a parent files its booking paperwork on the parent's
    // engagement.
    bookedVia: { select: { id: true, name: true, bookable: true } },
  },
} as const;

type Venue = {
  id: string;
  name: string;
  bookable: boolean;
  bookedVia?: { id: string; name: string; bookable: boolean } | null;
};

// "6 Jul – 9 Jul 2026" on a dated trip, "Days 2–4" on a date-less template.
function stayRange(stay: {
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDayIndex: number | null;
  checkOutDayIndex: number | null;
}): string {
  if (stay.checkIn && stay.checkOut) {
    return `${formatDate(stay.checkIn)} → ${formatDate(stay.checkOut)}`;
  }
  if (stay.checkInDayIndex != null && stay.checkOutDayIndex != null) {
    return `Days ${stay.checkInDayIndex}–${stay.checkOutDayIndex}`;
  }
  return "";
}

/**
 * Every file a trip has, in one place, grouped by what it's filed against —
 * the trip itself, each venue engagement, each site-less item booking, each
 * stay — plus a read-only view of the engaged venues' own libraries. A single
 * "Upload" with an "Attach to…" picker files new paperwork where it belongs,
 * including against a venue the trip has no booking row for yet.
 *
 * Two queries regardless of trip size: the trip with every document-bearing
 * relation nested (never `blob` — see DOCUMENT_SELECT), then the venue-level
 * files for the venues that turns up. Renders no outer Card; the trip page
 * wraps it.
 */
export async function TripDocumentsHub({
  tripId,
  canEdit,
}: {
  tripId: string;
  canEdit: boolean;
}) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      documents: DOCS,
      days: {
        orderBy: { dayIndex: "asc" },
        select: {
          dayIndex: true,
          scheduleItems: {
            orderBy: { order: "asc" },
            select: {
              title: true,
              presentation: { select: { title: true } },
              category: { select: { name: true } },
              travel: {
                select: {
                  method: true,
                  toLabel: true,
                  toLocation: { select: { name: true } },
                },
              },
              sites: {
                orderBy: { order: "asc" },
                select: { location: VENUE_SELECT },
              },
              // Site-less item bookings; venue work is on the engagement.
              bookings: {
                orderBy: { createdAt: "asc" },
                select: { id: true, label: true, documents: DOCS },
              },
            },
          },
          plannedLocations: {
            orderBy: { order: "asc" },
            select: { location: VENUE_SELECT },
          },
        },
      },
      bookings: {
        select: { id: true, location: VENUE_SELECT, documents: DOCS },
      },
      stays: {
        orderBy: [
          { checkIn: "asc" },
          { checkInDayIndex: "asc" },
          { createdAt: "asc" },
        ],
        select: {
          id: true,
          checkIn: true,
          checkOut: true,
          checkInDayIndex: true,
          checkOutDayIndex: true,
          location: VENUE_SELECT,
          documents: DOCS,
        },
      },
    },
  });
  if (!trip) return null;

  // Every venue the trip touches, in itinerary order: scheduled visits, then
  // rough-plan assignments, then lodging, then any engagement not otherwise
  // reached (a venue booked but since dropped from the schedule).
  const venues = new Map<string, Venue>();
  const addVenue = (v: Venue | null | undefined) => {
    if (v && !venues.has(v.id)) venues.set(v.id, v);
  };
  for (const day of trip.days) {
    for (const item of day.scheduleItems) {
      for (const s of item.sites) addVenue(s.location);
    }
    for (const p of day.plannedLocations) addVenue(p.location);
  }
  for (const stay of trip.stays) addVenue(stay.location);
  for (const b of trip.bookings) addVenue(b.location);

  // One booking group per ENGAGED venue: a child site's group is its parent's.
  const engagedVenues = new Map<string, Venue>();
  for (const v of venues.values()) {
    const e = v.bookedVia ?? v;
    if (!engagedVenues.has(e.id)) engagedVenues.set(e.id, e);
  }

  const engagementByVenue = new Map(
    trip.bookings
      .filter((b) => b.location)
      .map((b) => [b.location!.id, b] as const),
  );

  const groups: HubGroup[] = [];
  const attach: HubAttachOption[] = [];

  groups.push({
    key: "trip",
    heading: "Trip",
    sublabel: "",
    href: null,
    shareContext: { target: "trip" },
    documents: trip.documents.map(serializeDocument),
    attachValue: "trip",
  });
  attach.push({
    value: "trip",
    label: "This trip",
    section: "Trip",
    shareContext: { target: "trip" },
    upload: { kind: "document", target: "trip", targetId: trip.id },
  });

  for (const venue of engagedVenues.values()) {
    const booking = engagementByVenue.get(venue.id);
    // A never-bookable walk-by stop can't hold an engagement, so it gets no
    // group and no upload target unless one somehow exists already.
    if (!booking && !venue.bookable) continue;
    const value = `venue:${venue.id}`;
    const shareContext = { target: "booking", venueName: venue.name } as const;
    groups.push({
      key: value,
      heading: `${venue.name} booking`,
      sublabel: booking ? "" : "No booking",
      href: bookingDashboardHref(trip.id, venue.id),
      shareContext,
      documents: (booking?.documents ?? []).map(serializeDocument),
      attachValue: value,
    });
    attach.push({
      value,
      label: `${venue.name} booking`,
      section: "Venue bookings",
      shareContext,
      upload: booking
        ? { kind: "document", target: "booking", targetId: booking.id }
        : { kind: "venue", tripId: trip.id, locationId: venue.id },
      note: booking
        ? undefined
        : "Uploading here creates a booking.",
    });
  }

  for (const day of trip.days) {
    for (const item of day.scheduleItems) {
      for (const b of item.bookings) {
        const what = b.label ?? scheduleItemPrimaryLabel(item).primary;
        const value = `booking:${b.id}`;
        const shareContext = { target: "booking", venueName: null } as const;
        groups.push({
          key: value,
          heading: `${what} booking`,
          sublabel: `Day ${day.dayIndex}`,
          href: bookingDashboardHref(trip.id),
          shareContext,
          documents: b.documents.map(serializeDocument),
          attachValue: value,
        });
        attach.push({
          value,
          label: `${what} booking (Day ${day.dayIndex})`,
          section: "Item bookings",
          shareContext,
          upload: { kind: "document", target: "booking", targetId: b.id },
        });
      }
    }
  }

  for (const stay of trip.stays) {
    const range = stayRange(stay);
    const value = `stay:${stay.id}`;
    const shareContext = { target: "stay", venueName: stay.location.name } as const;
    groups.push({
      key: value,
      heading: `Stay at ${stay.location.name}`,
      sublabel: range,
      href: stayHref(trip.id, stay.id),
      shareContext,
      documents: stay.documents.map(serializeDocument),
      attachValue: value,
    });
    attach.push({
      value,
      label: range
        ? `Stay at ${stay.location.name}, ${range}`
        : `Stay at ${stay.location.name}`,
      section: "Stays",
      shareContext,
      upload: { kind: "document", target: "stay", targetId: stay.id },
    });
  }

  // Venue-level files for every venue the trip touches (walk-by stops too —
  // a floor plan is useful whether or not the stop is booked).
  const venueDocs = venues.size
    ? await prisma.document.findMany({
        where: { locationId: { in: [...venues.keys()] } },
        orderBy: { createdAt: "desc" },
        select: { ...DOCUMENT_SELECT, locationId: true },
      })
    : [];
  const docsByVenue = new Map<string, ReturnType<typeof serializeDocument>[]>();
  for (const doc of venueDocs) {
    if (!doc.locationId) continue;
    const arr = docsByVenue.get(doc.locationId) ?? [];
    arr.push(serializeDocument(doc));
    docsByVenue.set(doc.locationId, arr);
  }
  const library: HubLibraryVenue[] = [...venues.values()]
    .filter((v) => docsByVenue.has(v.id))
    .map((v) => ({
      locationId: v.id,
      name: v.name,
      href: `/locations/${v.id}`,
      documents: docsByVenue.get(v.id)!,
    }));

  return (
    <TripDocumentsHubView
      groups={groups}
      attachOptions={attach}
      library={library}
      canEdit={canEdit}
    />
  );
}
