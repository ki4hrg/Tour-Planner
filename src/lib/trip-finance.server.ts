import { prisma } from "./db";
import { todayUtc } from "./dates";
import { withBookedViaParentsWhere } from "./booked-via";
import { PRICE_LINES_SELECT, serializePriceLines, tripHeadcount } from "./costs";
import { effectiveCosts } from "./costs";
import { serializeInstallment } from "./payment-schedule";
import { buildTripFinance, type TripFinance } from "./trip-finance";

// Server-side loader for a trip's finances (overview Finance card + Finance
// tab). A fixed handful of queries, then the pure `buildTripFinance`.

export type FinanceTrip = {
  id: string;
  startDate: Date | null;
  participantCount: number | null;
  capacity: number | null;
};

export async function loadTripFinance(trip: FinanceTrip): Promise<TripFinance> {
  const today = todayUtc();
  const [sites, planned, stays, bookings] = await Promise.all([
    prisma.scheduleItemSite.findMany({
      where: { scheduleItem: { day: { tripId: trip.id } } },
      select: { locationId: true },
    }),
    prisma.itineraryDayLocation.findMany({
      where: { day: { tripId: trip.id } },
      select: { locationId: true },
    }),
    prisma.stay.findMany({
      where: { tripId: trip.id },
      select: {
        id: true,
        locationId: true,
        checkIn: true,
        checkOut: true,
        checkInDayIndex: true,
        checkOutDayIndex: true,
        headcount: true,
        costPerPersonPerNight: true,
        currency: true,
      },
    }),
    // Venue engagements AND site-less item bookings (a coach hire is a cost
    // and a commitment like any other).
    prisma.booking.findMany({
      where: {
        OR: [{ tripId: trip.id }, { scheduleItem: { day: { tripId: trip.id } } }],
      },
      select: {
        id: true,
        locationId: true,
        label: true,
        status: true,
        stageLabel: true,
        agreedCurrency: true,
        bookedOn: true,
        createdAt: true,
        priceLines: PRICE_LINES_SELECT,
        payments: { select: { amount: true } },
        paymentSchedule: true,
        scheduleItem: {
          select: { id: true, dayId: true, day: { select: { dayIndex: true } } },
        },
      },
    }),
  ]);
  const visitedLocationIds = [
    ...new Set([
      ...sites.map((s) => s.locationId),
      ...planned.map((p) => p.locationId),
    ]),
  ];
  const touched = [
    ...new Set([
      ...visitedLocationIds,
      ...stays.map((s) => s.locationId),
      ...bookings.flatMap((b) => (b.locationId ? [b.locationId] : [])),
    ]),
  ];
  const locations = touched.length
    ? await prisma.location.findMany({
        where: withBookedViaParentsWhere(touched),
        select: {
          id: true,
          name: true,
          bookable: true,
          bookedViaId: true,
          costs: true,
        },
      })
    : [];
  // List prices in force for this trip: the lines valid on its start date
  // (today for a date-less trip).
  const priceDate = trip.startDate ?? today;

  return buildTripFinance({
    tripId: trip.id,
    headcount: tripHeadcount(trip),
    tripStartDate: trip.startDate,
    today,
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      bookable: l.bookable,
      bookedViaId: l.bookedViaId,
      costs: effectiveCosts(l.costs, priceDate).map((c) => ({
        label: c.label,
        amount: Number(c.amount),
        currency: c.currency,
        unit: c.unit,
        confirmedAt: c.confirmedAt,
      })),
    })),
    visitedLocationIds,
    stays: stays.map((s) => ({
      ...s,
      costPerPersonPerNight:
        s.costPerPersonPerNight == null ? null : Number(s.costPerPersonPerNight),
    })),
    bookings: bookings.map((b) => ({
      id: b.id,
      locationId: b.locationId,
      label: b.label,
      status: b.status,
      stageLabel: b.stageLabel,
      agreedCurrency: b.agreedCurrency,
      priceLines: serializePriceLines(b.priceLines),
      payments: b.payments.map((p) => Number(p.amount)),
      paymentSchedule: b.paymentSchedule.map(serializeInstallment),
      bookedOn: b.bookedOn,
      createdAt: b.createdAt,
      item: b.scheduleItem
        ? {
            dayId: b.scheduleItem.dayId,
            itemId: b.scheduleItem.id,
            dayIndex: b.scheduleItem.day.dayIndex,
          }
        : null,
    })),
  });
}
