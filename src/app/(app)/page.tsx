import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/filter-chip";
import { formatDate, isOngoing, todayUtc } from "@/lib/dates";
import { noteTarget } from "@/lib/notes";
import { reconcileTodoistFollowUps } from "@/lib/todoist-sync";
import { cn } from "@/lib/utils";
import {
  TRIP_LIFECYCLE_LABELS,
  deriveTripLifecycle,
  serializeDay,
  tripStillInPlayWhere,
  TRAVEL_LEG_INCLUDE,
} from "@/lib/trips";
import { TimelineGroups } from "./trips/itinerary-timeline";
import { BookingActionsCard } from "./booking-actions-card";

export const dynamic = "force-dynamic";

// The full item tree a single day needs to render its timeline (matches the
// trip/day pages so serializeDay can consume it directly).
const DAY_ITEMS_INCLUDE = {
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
              mealProvider: { select: { id: true, name: true } },
    sites: {
      orderBy: { order: "asc" },
      include: { location: { select: { id: true, name: true } } },
    },
    bookings: {
      orderBy: { createdAt: "asc" },
      include: { bookedContact: { select: { id: true, name: true } } },
    },
  },
} satisfies Prisma.ItineraryDay$scheduleItemsArgs;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ followups?: string }>;
}) {
  const user = await requireUser();
  const { followups } = await searchParams;
  const onlyMine = followups === "mine";
  const today = todayUtc();

  // Lazy Todoist completion pull before the follow-ups card renders. Throttled
  // (~60s) inside; best-effort — a Todoist outage must not break the dashboard.
  await reconcileTodoistFollowUps(user.id).catch(() => 0);

  const [
    ongoingCandidates,
    activeTrips,
    followUpNotes,
  ] = await Promise.all([
    // Trips underway right now, with just today's day + its schedule loaded so we
    // can surface "what's happening today" front and center. The date bounds keep
    // this cheap; isOngoing() below is the exact filter.
    prisma.trip.findMany({
      where: {
        isTemplate: false,
        status: "ACTIVE",
        startDate: { lte: today },
        OR: [{ endDate: { gte: today } }, { endDate: null, startDate: today }],
      },
      orderBy: { startDate: "asc" },
      select: {
        id: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        tripType: { select: { name: true } },
        days: {
          where: { date: today },
          orderBy: { dayIndex: "asc" },
          include: { scheduleItems: DAY_ITEMS_INCLUDE },
        },
      },
    }),
    // Trips still in play, soonest first (Postgres sorts NULL start dates last).
    // Over-fetch a little: ongoing trips are filtered out below (they render in
    // "Happening now" instead — one trip, one card; GH #43) before slicing to 8.
    prisma.trip.findMany({
      where: { isTemplate: false, ...tripStillInPlayWhere(today) },
      orderBy: { startDate: "asc" },
      take: 12,
      select: {
        id: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        tripType: { select: { name: true } },
        _count: { select: { days: true } },
      },
    }),
    // Open follow-ups (everyone's by default; ?followups=mine narrows). Due-dated
    // ones first, soonest first; undated ones trail.
    prisma.note.findMany({
      where: {
        followUp: true,
        ...(onlyMine ? { createdById: user.id } : {}),
      },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { contactedOn: "asc" }],
      take: 20,
      select: {
        id: true,
        body: true,
        dueDate: true,
        createdBy: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        booking: {
          select: {
            tripId: true,
            label: true,
            location: { select: { name: true } },
            trip: { select: { id: true, name: true } },
            scheduleItem: {
              select: {
                day: { select: { trip: { select: { id: true, name: true } } } },
              },
            },
          },
        },
        trip: { select: { id: true, name: true } },
        stay: {
          select: {
            trip: { select: { id: true, name: true } },
            location: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const followUps = followUpNotes.map((n) => ({
    id: n.id,
    firstLine: n.body.split("\n")[0],
    dueDate: n.dueDate,
    overdue: n.dueDate != null && n.dueDate.getTime() < today.getTime(),
    author: n.createdBy?.name ?? "Unknown",
    mine: n.createdBy?.id === user.id,
    target: noteTarget(n),
  }));

  // Exact "is today within the trip span" filter, and pull out today's day.
  // The same predicate excludes these trips from "Upcoming trips" below, so an
  // ongoing trip appears in exactly one card.
  const upcomingTrips = activeTrips
    .filter((t) => !isOngoing(t.startDate, t.endDate))
    .slice(0, 8);
  const ongoing = ongoingCandidates
    .filter((t) => isOngoing(t.startDate, t.endDate))
    .map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      startDate: t.startDate,
      endDate: t.endDate,
      tripTypeName: t.tripType.name,
      currentDay: t.days[0] ? serializeDay(t.days[0]) : null,
    }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {ongoing.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Happening now
              <Badge variant="secondary" className="ml-2 align-middle">
                {ongoing.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 text-sm">
            {ongoing.map((t) => (
              <div key={t.id} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/trips/${t.id}`}
                      className="font-medium link-quiet"
                    >
                      {t.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {t.tripTypeName}
                      {t.currentDay
                        ? ` · Day ${t.currentDay.dayIndex}${
                            t.currentDay.title ? ` — ${t.currentDay.title}` : ""
                          }`
                        : ""}{" "}
                      · {formatDate(today)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/trips/${t.id}/today`}>Today</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/trips/${t.id}/booking`}>Booking</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/trips/${t.id}`}>Details</Link>
                    </Button>
                  </div>
                </div>
                {t.currentDay && t.currentDay.items.length > 0 ? (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <TimelineGroups
                      items={t.currentDay.items}
                      linkVenues
                      itemLinkBase={`/trips/${t.id}/days/${t.currentDay.id}`}
                      showGaps
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing scheduled today.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <BookingActionsCard today={today} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            Follow-ups due
            {followUps.length ? (
              <Badge variant="secondary" className="ml-2 align-middle">
                {followUps.length}
              </Badge>
            ) : null}
          </CardTitle>
          <div className="flex gap-1">
            <FilterChip href="/" active={!onlyMine}>
              Everyone
            </FilterChip>
            <FilterChip href="/?followups=mine" active={onlyMine}>
              Mine
            </FilterChip>
          </div>
        </CardHeader>
        <CardContent className="text-sm">
          {followUps.length === 0 ? (
            <p className="text-muted-foreground">
              No open follow-ups.
            </p>
          ) : (
            <ul className="divide-y">
              {followUps.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <Link
                      href={f.target.href}
                      className="font-medium link-quiet"
                    >
                      {f.target.label}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.firstLine}
                      {!onlyMine ? ` · ${f.author}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      f.overdue
                        ? "font-medium text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {f.dueDate
                      ? `${f.overdue ? "Overdue · " : "Due "}${formatDate(f.dueDate)}`
                      : "No due date"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Upcoming trips</CardTitle>
          <Button asChild size="sm" variant="outline">
            <Link href="/trips">All trips</Link>
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          {upcomingTrips.length === 0 ? (
            <p className="text-muted-foreground">
              {ongoing.length > 0 ? (
                "No other upcoming trips."
              ) : (
                <>
                  No upcoming trips.{" "}
                  <Link href="/trips/new" className="link-quiet">
                    New trip
                  </Link>
                </>
              )}
            </p>
          ) : (
            <ul className="divide-y">
              {upcomingTrips.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <Link
                      href={`/trips/${t.id}`}
                      className="font-medium link-quiet"
                    >
                      {t.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {t.tripType.name} ·{" "}
                      {t.startDate ? formatDate(t.startDate) : "no dates"} ·{" "}
                      {TRIP_LIFECYCLE_LABELS[deriveTripLifecycle(t, today)]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
