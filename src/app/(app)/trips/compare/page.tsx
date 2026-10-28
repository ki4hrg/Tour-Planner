import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toDateInput } from "@/lib/dates";
import { buildDashboardRows, type VenueBookingRow } from "@/lib/booking-dashboard";
import { withBookedViaParentsWhere } from "@/lib/booked-via";
import { PRICE_LINES_SELECT, tripHeadcount } from "@/lib/costs";
import {
  MultiYearGrid,
  type YearColumn,
  type VenueLine,
} from "../multi-year-grid";
import { BOOKING_PROGRESS_SELECT } from "@/lib/booking-workflow";
import { BackLink } from "@/components/back-link";

export const dynamic = "force-dynamic";

// The nested selection each trip needs to build its venue rows.
const TRIP_SELECT = {
  id: true,
  name: true,
  startDate: true,
  participantCount: true,
  capacity: true,
  defaultCurrency: true,
  days: {
    orderBy: { dayIndex: "asc" as const },
    select: {
      id: true,
      dayIndex: true,
      date: true,
      plannedLocations: { select: { locationId: true } },
      scheduleItems: {
        orderBy: { order: "asc" as const },
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          category: { select: { name: true } },
          presentation: { select: { title: true } },
          sites: { select: { locationId: true } },
          bookings: {
            select: {
              id: true,
              label: true,
              ...BOOKING_PROGRESS_SELECT,
              confirmationRef: true,
              bookedContact: { select: { name: true } },
            },
          },
        },
      },
    },
  },
  bookings: {
    select: {
      id: true,
      locationId: true,
      label: true,
      ...BOOKING_PROGRESS_SELECT,
      confirmationRef: true,
      notes: true,
      bookedContactId: true,
      bookedContact: { select: { id: true, name: true } },
      bookedOn: true,
      createdAt: true,
      agreedCurrency: true,
      priceLines: PRICE_LINES_SELECT,
      payments: true,
      paymentSchedule: true,
    },
  },
  stays: { select: { locationId: true, checkIn: true, checkOut: true } },
};

export default async function CompareYearsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { type } = await searchParams;
  if (!type) notFound();

  const tripType = await prisma.tripType.findUnique({
    where: { id: type },
    select: { id: true, name: true },
  });
  if (!tripType) notFound();

  const trips = await prisma.trip.findMany({
    where: { tripTypeId: type, isTemplate: false },
    orderBy: { startDate: "asc" },
    select: TRIP_SELECT,
  });

  // Pull cost/lead-day detail for every location any of these trips touches.
  const locationIds = [
    ...new Set(
      trips.flatMap((t) => [
        ...t.days.flatMap((d) =>
          d.scheduleItems.flatMap((i) => i.sites.map((s) => s.locationId)),
        ),
        ...t.days.flatMap((d) => d.plannedLocations.map((p) => p.locationId)),
        ...t.stays.map((s) => s.locationId),
        ...t.bookings.flatMap((b) => (b.locationId ? [b.locationId] : [])),
      ]),
    ),
  ];
  const locations = locationIds.length
    ? await prisma.location.findMany({
        // + the parents child sites are booked via (their rows' heading).
        where: withBookedViaParentsWhere(locationIds),
        select: {
          id: true,
          name: true,
          bookedViaId: true,
          bookable: true,
          bookingOpensLeadDays: true,
          defaultWorkflowId: true,
          costs: true,
        },
      })
    : [];

  // Build each year's venue rows, then pivot into venue × year.
  const columns: YearColumn[] = trips.map((t) => ({
    tripId: t.id,
    year: t.startDate ? toDateInput(t.startDate).slice(0, 4) : "—",
    name: t.name,
  }));

  const venueMap = new Map<string, VenueLine>();
  for (const t of trips) {
    const { venueRows } = buildDashboardRows({
      days: t.days,
      engagements: t.bookings,
      stays: t.stays,
      locations,
      tripStartDate: t.startDate,
      headcount: tripHeadcount(t),
      defaultCurrency: t.defaultCurrency,
    });
    for (const row of venueRows) {
      let line = venueMap.get(row.locationId);
      if (!line) {
        line = { locationId: row.locationId, name: row.locationName, byTrip: {} };
        venueMap.set(row.locationId, line);
      }
      line.byTrip[t.id] = row;
    }
  }
  const venues = [...venueMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const totalNeedsInfo = venues.reduce(
    (n, v) =>
      n +
      columns.filter((c) => (v.byTrip[c.tripId] as VenueBookingRow | null)?.needsInfo)
        .length,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink href="/trips" label="All trips" />
        <div>
          <h1 className="text-2xl font-semibold">{tripType.name} — all years</h1>
          <p className="text-sm text-muted-foreground">
            {trips.length} trip{trips.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {totalNeedsInfo > 0
              ? `${totalNeedsInfo} booking${totalNeedsInfo === 1 ? "" : "s"} need attention`
              : "Nothing to book"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {trips.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No trips.
            </p>
          ) : (
            <MultiYearGrid columns={columns} venues={venues} canEdit={canEdit} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
