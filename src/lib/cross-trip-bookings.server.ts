import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { toDateInput, todayUtc } from "./dates";
import { tripStillInPlayWhere } from "./trips";
import { regionPath, type RegionNode } from "./regions";
import { buildDashboardRows } from "./booking-dashboard";
import { tripHeadcount } from "./costs";
import {
  groupRowsByVenue,
  type TripItemBookings,
  type TripRef,
  type VenueGroup,
  type VenueMeta,
} from "./cross-trip-bookings";
import { BOOKING_PROGRESS_SELECT } from "@/lib/booking-workflow";

export type { TripItemBookings };

// Server-side loader for the cross-trip booking view — shared by /bookings and
// the home dashboard. Plain module (not "use server", no revalidatePath), a
// FIXED number of queries regardless of trip count: trips (with everything
// buildDashboardRows needs), regions, then the locations they touch.

export type CrossTripBookings = {
  trips: TripRef[];
  groups: VenueGroup[];
  itemBookings: TripItemBookings[];
};

/**
 * In scope: real (non-template) ACTIVE trips that haven't ended — or, with
 * `includePast`, every ACTIVE trip (an unpaid installment outlives the trip).
 */
export function crossTripScope(
  includePast: boolean,
  today: Date = todayUtc(),
): Prisma.TripWhereInput {
  return {
    isTemplate: false,
    ...(includePast ? { status: "ACTIVE" } : tripStillInPlayWhere(today)),
  };
}

// The same shape the single-trip booking page selects.
const TRIP_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  participantCount: true,
  capacity: true,
  tripType: { select: { name: true } },
  days: {
    orderBy: { dayIndex: "asc" },
    select: {
      dayIndex: true,
      date: true,
      plannedLocations: { select: { locationId: true } },
      scheduleItems: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          category: { select: { name: true } },
          presentation: { select: { title: true } },
          travel: {
            select: {
              method: true,
              toLabel: true,
              toLocation: { select: { name: true } },
            },
          },
          sites: { select: { locationId: true } },
          bookings: {
            orderBy: { createdAt: "asc" },
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
      bookedContact: {
        select: { id: true, name: true, phone: true, email: true },
      },
      bookedOn: true,
      createdAt: true,
      agreedAmount: true,
      agreedCurrency: true,
      agreedUnit: true,
      payments: { orderBy: { paidOn: "asc" } },
      paymentSchedule: true,
    },
  },
  stays: {
    select: {
      locationId: true,
      checkIn: true,
      checkOut: true,
      checkInDayIndex: true,
      checkOutDayIndex: true,
    },
  },
} satisfies Prisma.TripSelect;

export async function loadCrossTripBookings({
  tripTypeId,
  includePast = false,
}: {
  tripTypeId?: string;
  includePast?: boolean;
} = {}): Promise<CrossTripBookings> {
  const [trips, regions] = await Promise.all([
    prisma.trip.findMany({
      where: {
        ...crossTripScope(includePast),
        ...(tripTypeId ? { tripTypeId } : {}),
      },
      orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
      select: TRIP_SELECT,
    }),
    prisma.region.findMany({
      select: { id: true, name: true, parentId: true },
    }),
  ]);

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
        where: { id: { in: locationIds } },
        select: {
          id: true,
          name: true,
          bookable: true,
          bookingOpensLeadDays: true,
          defaultWorkflowId: true,
          costs: true,
          regionId: true,
          primaryContact: {
            select: {
              id: true,
              name: true,
              role: true,
              email: true,
              phone: true,
            },
          },
        },
      })
    : [];

  const regionById = new Map<string, RegionNode>(regions.map((r) => [r.id, r]));
  const venueMeta = new Map<string, VenueMeta>(
    locations.map((l) => {
      const region = l.regionId ? regionById.get(l.regionId) : undefined;
      return [
        l.id,
        {
          id: l.id,
          name: l.name,
          regionPath: region ? regionPath(region, regionById) : null,
          primaryContact: l.primaryContact,
        },
      ];
    }),
  );

  const perTrip = trips.map((t) => {
    const trip: TripRef = {
      id: t.id,
      name: t.name,
      tripTypeName: t.tripType.name,
      startDate: t.startDate ? toDateInput(t.startDate) : null,
      endDate: t.endDate ? toDateInput(t.endDate) : null,
    };
    const { venueRows, itemRows } = buildDashboardRows({
      days: t.days,
      engagements: t.bookings,
      stays: t.stays,
      locations,
      tripStartDate: t.startDate,
      headcount: tripHeadcount(t),
    });
    return { trip, venueRows, itemRows };
  });

  return {
    trips: perTrip.map((p) => p.trip),
    groups: groupRowsByVenue(perTrip, venueMeta),
    itemBookings: perTrip
      .filter((p) => p.itemRows.length > 0)
      .map(({ trip, itemRows }) => ({ trip, itemRows })),
  };
}
