import Link from "next/link";
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
import { formatDate, isOngoing } from "@/lib/dates";
import { bookingWindow } from "@/lib/booking";
import { TRIP_STATUS_LABELS } from "@/lib/trips";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireUser();

  const [activeTrips, itemBookings, stayBookings] = await Promise.all([
    // Trips still in play, soonest first (Postgres sorts NULL start dates last).
    prisma.trip.findMany({
      where: {
        isTemplate: false,
        status: { in: ["PLANNING", "CONFIRMED", "IN_PROGRESS"] },
      },
      orderBy: { startDate: "asc" },
      take: 8,
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
    // Unbooked/requested ITEM bookings — window keyed off the trip start date.
    prisma.booking.findMany({
      where: {
        status: { in: ["NOT_BOOKED", "REQUESTED"] },
        location: { is: { bookingOpensLeadDays: { not: null } } },
        scheduleItem: {
          is: {
            day: {
              is: { trip: { is: { isTemplate: false, startDate: { not: null } } } },
            },
          },
        },
      },
      select: {
        id: true,
        label: true,
        location: { select: { name: true, bookingOpensLeadDays: true } },
        scheduleItem: {
          select: {
            title: true,
            day: {
              select: {
                trip: { select: { id: true, name: true, startDate: true } },
              },
            },
          },
        },
      },
    }),
    // Unbooked/requested STAY bookings — window keyed off the stay's check-in.
    prisma.booking.findMany({
      where: {
        status: { in: ["NOT_BOOKED", "REQUESTED"] },
        stay: {
          is: {
            location: { is: { bookingOpensLeadDays: { not: null } } },
            trip: { is: { isTemplate: false } },
          },
        },
      },
      select: {
        id: true,
        label: true,
        stay: {
          select: {
            checkIn: true,
            label: true,
            location: { select: { name: true, bookingOpensLeadDays: true } },
            trip: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  // Union item + stay bookings into one "windows open" feed.
  const itemAlerts = itemBookings.map((b) => {
    const trip = b.scheduleItem!.day.trip;
    const win = bookingWindow(
      trip.startDate,
      b.location?.bookingOpensLeadDays ?? null,
    );
    return {
      id: b.id,
      locationName:
        b.label ?? b.location?.name ?? b.scheduleItem!.title ?? "Booking",
      tripId: trip.id,
      tripName: trip.name,
      earliest: win.earliest,
      open: win.open,
    };
  });

  const stayAlerts = stayBookings.map((b) => {
    const stay = b.stay!;
    const win = bookingWindow(
      stay.checkIn,
      stay.location.bookingOpensLeadDays ?? null,
    );
    return {
      id: b.id,
      locationName: b.label ?? stay.label ?? `Lodging — ${stay.location.name}`,
      tripId: stay.trip.id,
      tripName: stay.trip.name,
      earliest: win.earliest,
      open: win.open,
    };
  });

  const alerts = [...itemAlerts, ...stayAlerts]
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
          <CardTitle className="text-base">Active trips</CardTitle>
          <Button asChild size="sm" variant="outline">
            <Link href="/trips">All trips</Link>
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          {activeTrips.length === 0 ? (
            <p className="text-muted-foreground">
              No active trips.{" "}
              <Link href="/trips/new" className="underline">
                Create one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y">
              {activeTrips.map((t) => {
                const now = isOngoing(t.startDate, t.endDate);
                return (
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
                      {now ? (
                        <Badge className="ml-2 align-middle">Happening now</Badge>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">
                        {t.tripType.name} ·{" "}
                        {t.startDate ? formatDate(t.startDate) : "no dates"} ·{" "}
                        {TRIP_STATUS_LABELS[t.status]}
                      </span>
                    </span>
                    {now ? (
                      <Link
                        href={`/trips/${t.id}/itinerary`}
                        className="shrink-0 text-sm text-muted-foreground hover:underline"
                      >
                        Today →
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
