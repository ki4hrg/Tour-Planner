import { prisma } from "@/lib/db";
import { toDateInput } from "@/lib/dates";
import { serializeDay, TRAVEL_LEG_INCLUDE } from "@/lib/trips";
import {
  buildFeedEvents,
  type FeedTrip,
  type FeedStay,
} from "@/lib/calendar-feed";
import { buildIcsCalendar, formatIcsUtcStamp } from "@/lib/ics";

// Reads the DB per request; never prerender (no DATABASE_URL at build time).
export const dynamic = "force-dynamic";

// The include tree serializeDay expects (mirrors the print page query).
const TRIP_INCLUDE = {
  tripType: { select: { name: true } },
  days: {
    orderBy: { dayIndex: "asc" as const },
    include: {
      scheduleItems: {
        orderBy: { order: "asc" as const },
        include: {
          category: { select: { id: true, name: true, color: true } },
          presentation: {
            select: {
              id: true,
              title: true,
              defaultPresenters: { select: { id: true, name: true } },
            },
          },
          presenters: { select: { id: true, name: true } },
          travel: TRAVEL_LEG_INCLUDE,
          sites: {
            orderBy: { order: "asc" as const },
            include: { location: { select: { id: true, name: true } } },
          },
          bookings: {
            orderBy: { createdAt: "asc" as const },
            include: { bookedContact: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
  stays: {
    orderBy: [{ priority: "desc" as const }, { checkIn: "asc" as const }],
    include: { location: { select: { id: true, name: true } } },
  },
};

type LoadedTrip = Awaited<
  ReturnType<
    typeof prisma.trip.findMany<{ include: typeof TRIP_INCLUDE }>
  >
>[number];

function toFeedTrip(trip: LoadedTrip): FeedTrip {
  const stays: FeedStay[] = trip.stays.map((s) => ({
    id: s.id,
    locationName: s.location.name,
    checkIn: s.checkIn ? toDateInput(s.checkIn) : null,
    checkOut: s.checkOut ? toDateInput(s.checkOut) : null,
    notes: s.notes,
  }));
  return {
    id: trip.id,
    name: trip.name,
    notes: trip.notes,
    startDate: trip.startDate ? toDateInput(trip.startDate) : null,
    endDate: trip.endDate ? toDateInput(trip.endDate) : null,
    days: trip.days.map(serializeDay),
    stays,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");

  const feed = await prisma.calendarFeed.findUnique({ where: { token } });
  if (!feed || !feed.enabled) {
    return new Response("Not found", { status: 404 });
  }

  // Which trips this feed covers. Templates (no calendar dates) are always excluded.
  let where: Record<string, unknown>;
  let defaultName: string;
  if (feed.scope === "TRIP") {
    where = { id: feed.tripId ?? "", isTemplate: false };
    defaultName = "Trip itinerary";
  } else if (feed.scope === "TRIP_TYPE") {
    where = { tripTypeId: feed.tripTypeId ?? "", isTemplate: false };
    defaultName = "Trip itineraries";
  } else {
    where = { isTemplate: false };
    defaultName = "All trips";
  }

  const trips = await prisma.trip.findMany({
    where,
    orderBy: [{ startDate: "asc" }, { name: "asc" }],
    include: TRIP_INCLUDE,
  });

  // Name the calendar: explicit label > the single trip / trip type's name > default.
  let name = feed.label?.trim() || "";
  if (!name) {
    if (feed.scope === "TRIP") name = trips[0]?.name ?? defaultName;
    else if (feed.scope === "TRIP_TYPE")
      name = trips[0]?.tripType.name
        ? `${trips[0].tripType.name} trips`
        : defaultName;
    else name = defaultName;
  }

  const events = buildFeedEvents(trips.map(toFeedTrip), {
    includeLogisticalNotes: true, // staff-detail feed
  });
  const ics = buildIcsCalendar({
    name,
    events,
    dtstamp: formatIcsUtcStamp(new Date().toISOString()),
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="tour-planner-${feed.scope.toLowerCase()}.ics"`,
      // Subscribers poll periodically; a short cache smooths bursts.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
