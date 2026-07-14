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
import { formatDate, isOngoing, todayUtc } from "@/lib/dates";
import { bookingWindow } from "@/lib/booking";
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

  const [ongoingCandidates, activeTrips, engagementBookings, followUpNotes] = await Promise.all([
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
    // Unbooked/requested venue-engagement bookings. The window is keyed off the
    // trip start date here (a coarse heads-up); the booking dashboard refines it to
    // the earliest covered date per venue.
    prisma.booking.findMany({
      where: {
        status: { in: ["NOT_BOOKED", "REQUESTED", "TENTATIVELY_CONFIRMED"] },
        tripId: { not: null },
        location: { is: { bookingOpensLeadDays: { not: null } } },
        trip: {
          is: { isTemplate: false, status: "ACTIVE", startDate: { not: null } },
        },
      },
      select: {
        id: true,
        label: true,
        location: { select: { name: true, bookingOpensLeadDays: true } },
        trip: { select: { id: true, name: true, startDate: true } },
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

  const alerts = engagementBookings
    .map((b) => {
      const trip = b.trip!;
      const win = bookingWindow(
        trip.startDate,
        b.location?.bookingOpensLeadDays ?? null,
      );
      return {
        id: b.id,
        locationName: b.label ?? b.location?.name ?? "Booking",
        tripId: trip.id,
        tripName: trip.name,
        earliest: win.earliest,
        open: win.open,
      };
    })
    .filter((a) => a.open)
    .sort((a, b) => (a.earliest?.getTime() ?? 0) - (b.earliest?.getTime() ?? 0))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Upcoming trips and bookings that need attention.
        </p>
      </div>

      {ongoing.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
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
                      className="font-medium hover:underline"
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
                    Nothing scheduled for today.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Follow-ups due
            {followUps.length ? (
              <Badge variant="secondary" className="ml-2 align-middle">
                {followUps.length}
              </Badge>
            ) : null}
          </CardTitle>
          <div className="flex gap-1 text-xs">
            <Link
              href="/"
              className={cn(
                "rounded-full border px-2.5 py-0.5",
                !onlyMine ? "bg-muted font-medium" : "text-muted-foreground",
              )}
            >
              Everyone
            </Link>
            <Link
              href="/?followups=mine"
              className={cn(
                "rounded-full border px-2.5 py-0.5",
                onlyMine ? "bg-muted font-medium" : "text-muted-foreground",
              )}
            >
              Only mine
            </Link>
          </div>
        </CardHeader>
        <CardContent className="text-sm">
          {followUps.length === 0 ? (
            <p className="text-muted-foreground">
              {onlyMine
                ? "No open follow-ups of yours."
                : "No open follow-ups — log one from a note."}
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
                      className="font-medium hover:underline"
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
                        ? "font-medium text-red-600 dark:text-red-400"
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
          <CardTitle className="text-base">
            Booking windows open
            {alerts.length ? (
              <Badge variant="secondary" className="ml-2 align-middle">
                {alerts.length}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {alerts.length === 0 ? (
            <p className="text-muted-foreground">
              Nothing to book right now — no open windows on unbooked items.
            </p>
          ) : (
            <ul className="divide-y">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span>
                    <span className="font-medium">{a.locationName}</span>
                    <span className="text-muted-foreground"> — {a.tripName}</span>
                  </span>
                  <Link
                    href={`/trips/${a.tripId}/booking`}
                    className="text-sm text-muted-foreground hover:underline"
                  >
                    Book →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Upcoming trips</CardTitle>
          <Button asChild size="sm" variant="outline">
            <Link href="/trips">All trips</Link>
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          {upcomingTrips.length === 0 ? (
            <p className="text-muted-foreground">
              {ongoing.length > 0 ? (
                "No upcoming trips beyond what's happening now."
              ) : (
                <>
                  No upcoming trips.{" "}
                  <Link href="/trips/new" className="underline">
                    Create one
                  </Link>
                  .
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
                      className="font-medium hover:underline"
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
