import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, todayUtc } from "@/lib/dates";
import {
  TRIP_LIFECYCLE_LABELS,
  deriveTripLifecycle,
  serializeDay,
  summarizeDayLodging,
  TRAVEL_LEG_INCLUDE,
  PLANNED_LOCATIONS_INCLUDE,
} from "@/lib/trips";
import { lodgingForDays } from "@/lib/stays";
import { DayTimeline } from "./day-timeline";
import { VenueEngagementsProvider } from "../../../venue-engagements";
import { loadVenueEngagements } from "@/lib/venue-engagements";

export const dynamic = "force-dynamic";

// A focused, mobile-first single-day view — the on-the-ground "what's happening
// today" screen. Reuses the venue-grouped timeline; adds day nav + lodging.
export default async function TripDayPage({
  params,
}: {
  params: Promise<{ id: string; dayId: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { id, dayId } = await params;

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      tripType: { select: { name: true } },
      days: {
        orderBy: { dayIndex: "asc" },
        include: {
          scheduleItems: {
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
                include: {
                  location: {
                    select: {
                      id: true,
                      name: true,
                      // Staff-only on-site affordances (maps link, one-tap call).
                      // Never load these on share-page queries — and
                      // redactDaysForShare strips them defensively regardless.
                      mapUrl: true,
                      googlePlaceId: true,
                      lat: true,
                      lng: true,
                      // Who to ring: name/role + every channel. This page is
                      // behind requireUser, so staff-only data is fine here.
                      primaryContact: {
                        select: {
                          name: true,
                          role: true,
                          phone: true,
                          email: true,
                        },
                      },
                    },
                  },
                },
              },
              bookings: {
                orderBy: { createdAt: "asc" },
                include: { bookedContact: { select: { id: true, name: true } } },
              },
            },
          },
          plannedLocations: PLANNED_LOCATIONS_INCLUDE,
        },
      },
    },
  });
  if (!trip) notFound();
  const lifecycle = deriveTripLifecycle(trip, todayUtc());

  const index = trip.days.findIndex((d) => d.id === dayId);
  if (index === -1) notFound();
  const day = trip.days[index];
  const prev = index > 0 ? trip.days[index - 1] : null;
  const next = index < trip.days.length - 1 ? trip.days[index + 1] : null;

  const stays = await prisma.stay.findMany({
    where: { tripId: id },
    orderBy: [{ priority: "desc" }, { checkIn: "asc" }],
    include: { location: { select: { id: true, name: true } } },
  });
  const lodgingSummary = summarizeDayLodging(trip.days, stays)[day.id] ?? null;
  // The summary carries only the name; resolve the stay again for the venue id
  // so the Overnight line can link through to the location page.
  const overnightStay = lodgingForDays(trip.days, stays).get(day.id) ?? null;
  const lodging = lodgingSummary
    ? { ...lodgingSummary, locationId: overnightStay?.location.id ?? null }
    : null;

  const serialized = serializeDay(day);

  // Venues for the quick-add's picker (planners only): every live location,
  // with the ones catalogued under this trip's type flagged so they list first.
  const locations = canEdit
    ? await prisma.location.findMany({
        where: { archivedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          tripTypes: { where: { id: trip.tripTypeId }, select: { id: true } },
        },
      })
    : [];

  // Each venue's (trip, location) engagement, shown beside the venue subheader.
  const engagements = await loadVenueEngagements(
    trip.id,
    serialized.items.flatMap((it) => it.sites.map((s) => s.locationId)),
  );

  // Rough-plan locations (GH #9) not already realised as a timed stop — a loose
  // "planned" line distinct from the day's timeline below.
  const visitedNames = new Set(
    serialized.items.flatMap((it) => it.sites.map((s) => s.location.name)),
  );
  const planned = (serialized.plannedLocations ?? []).filter(
    (p) => !visitedNames.has(p.name),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/trips/${trip.id}`}
          className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:underline"
        >
          <ChevronLeft className="size-4" />
          {trip.name}
        </Link>
        <Badge variant="secondary">{TRIP_LIFECYCLE_LABELS[lifecycle]}</Badge>
      </div>

      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Day {day.dayIndex}
          {day.date ? ` · ${formatDate(day.date)}` : ""}
        </p>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold">
            {day.title ?? `Day ${day.dayIndex}`}
          </h1>
          {canEdit ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="min-h-10 shrink-0"
            >
              <Link href={`/trips/${trip.id}/itinerary#day-${day.id}`}>
                <Pencil aria-hidden />
                Edit day
              </Link>
            </Button>
          ) : null}
        </div>
        {day.logisticalNotes ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {day.logisticalNotes}
          </p>
        ) : null}
        {day.participantNotes ? (
          <p className="whitespace-pre-wrap text-sm italic text-muted-foreground">
            {day.participantNotes}
          </p>
        ) : null}
        {planned.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">Planned:</span>{" "}
            {planned.map((p, i) => (
              <span key={p.id}>
                {i > 0 ? " · " : ""}
                <Link href={`/locations/${p.locationId}`} className="link-quiet">
                  {p.name}
                </Link>
                {p.note ? ` (${p.note})` : ""}
              </span>
            ))}
          </p>
        ) : null}
      </header>

      <div className="rounded-lg border bg-card p-4">
        {/* A planner always gets the timeline shell: an empty day still
            carries the quick-add. */}
        {serialized.items.length === 0 && !canEdit ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
        ) : (
          <VenueEngagementsProvider
            tripId={trip.id}
            canEdit={canEdit}
            engagements={engagements}
          >
            <DayTimeline
              tripId={trip.id}
              dayId={day.id}
              items={serialized.items}
              lodging={lodging}
              canEdit={canEdit}
              locations={locations.map((l) => ({
                id: l.id,
                name: l.name,
                tagged: l.tripTypes.length > 0,
              }))}
            />
          </VenueEngagementsProvider>
        )}
      </div>

      <nav className="flex items-center justify-between gap-2">
        {prev ? (
          <Button asChild variant="outline" size="lg" className="min-h-10">
            <Link href={`/trips/${trip.id}/days/${prev.id}`}>
              <ChevronLeft className="size-4" /> Day {prev.dayIndex}
            </Link>
          </Button>
        ) : (
          <span />
        )}
        <Button asChild variant="ghost" size="lg" className="min-h-10">
          <Link href={`/trips/${trip.id}/itinerary`}>Full itinerary</Link>
        </Button>
        {next ? (
          <Button asChild variant="outline" size="lg" className="min-h-10">
            <Link href={`/trips/${trip.id}/days/${next.id}`}>
              Day {next.dayIndex} <ChevronRight className="size-4" />
            </Link>
          </Button>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
