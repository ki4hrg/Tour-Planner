import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { formatDate, todayUtc } from "@/lib/dates";
import { serializeDay, summarizeDayLodging, TRAVEL_LEG_INCLUDE } from "@/lib/trips";
import {
  audienceView,
  isShareLinkActive,
  redactDaysForShare,
  scopeDaysToLocation,
  SHARE_AUDIENCE_LABELS,
} from "@/lib/share";
import { TimelineGroups } from "../../(app)/trips/itinerary-timeline";

export const dynamic = "force-dynamic";

// Shared itineraries shouldn't be indexed — the token is the only gate.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const SCHEDULE_ITEM_INCLUDE = {
  orderBy: { order: "asc" },
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
      orderBy: { order: "asc" },
      include: { location: { select: { id: true, name: true } } },
    },
    bookings: {
      orderBy: { createdAt: "asc" },
      include: { bookedContact: { select: { id: true, name: true } } },
    },
  },
} as const;

function Unavailable({ message }: { message: string }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Itinerary unavailable</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      location: { select: { id: true, name: true } },
      trip: {
        include: {
          tripType: { select: { name: true } },
          days: {
            orderBy: { dayIndex: "asc" },
            include: { scheduleItems: SCHEDULE_ITEM_INCLUDE },
          },
        },
      },
    },
  });

  if (!link) {
    return <Unavailable message="This link doesn't exist." />;
  }
  if (!isShareLinkActive(link, todayUtc())) {
    return (
      <Unavailable message="This link has been disabled or has expired. Ask the trip organiser for a current link." />
    );
  }

  const view = audienceView(link.audience);
  const trip = link.trip;

  // Lodging: scope a host-site link to stays at that site; others see all stays.
  const stays = view.showLodging
    ? await prisma.stay.findMany({
        where: {
          tripId: trip.id,
          ...(view.scopeToLocation && link.locationId
            ? { locationId: link.locationId }
            : {}),
        },
        orderBy: [{ priority: "desc" }, { checkIn: "asc" }],
        include: { location: { select: { id: true, name: true } } },
      })
    : [];
  const lodgingByDay = summarizeDayLodging(trip.days, stays);

  let days = trip.days.map(serializeDay);
  if (view.scopeToLocation && link.locationId) {
    days = scopeDaysToLocation(days, link.locationId);
  }
  // Strip bookings the audience can't see BEFORE they ride along in the RSC
  // payload — hiding them only at render would still leak them to view-source.
  days = redactDaysForShare(days, view, link.locationId);

  const scopeName =
    view.scopeToLocation && link.location ? link.location.name : null;

  return (
    <div className="space-y-6">
      <header className="space-y-2 border-b pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {SHARE_AUDIENCE_LABELS[link.audience]}
          </Badge>
          {scopeName ? <Badge variant="outline">{scopeName}</Badge> : null}
        </div>
        <h1 className="text-3xl font-semibold">{trip.name}</h1>
        <p className="text-sm text-muted-foreground">
          {trip.tripType.name}
          {trip.startDate
            ? ` · ${formatDate(trip.startDate)}${
                trip.endDate ? ` – ${formatDate(trip.endDate)}` : ""
              }`
            : ""}
        </p>
        {scopeName ? (
          <p className="text-sm text-muted-foreground">
            Showing only the schedule items at {scopeName}.
          </p>
        ) : null}
      </header>

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing scheduled here yet.
        </p>
      ) : (
        days.map((day, i) => (
          <section
            key={day.id}
            className={i > 0 ? "border-t pt-5" : ""}
          >
            <h2 className="mb-1 text-xl font-semibold">
              Day {day.dayIndex}
              {day.title ? ` — ${day.title}` : ""}
              {day.date ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {formatDate(day.date)}
                </span>
              ) : null}
            </h2>
            {view.showLogisticalNotes && day.logisticalNotes ? (
              <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {day.logisticalNotes}
              </p>
            ) : null}
            {day.participantNotes ? (
              <p className="mb-2 whitespace-pre-wrap text-sm italic text-muted-foreground">
                {day.participantNotes}
              </p>
            ) : null}
            <TimelineGroups
              items={day.items}
              lodging={lodgingByDay[day.id] ?? null}
              showBookings={view.showBookings}
            />
          </section>
        ))
      )}
    </div>
  );
}
