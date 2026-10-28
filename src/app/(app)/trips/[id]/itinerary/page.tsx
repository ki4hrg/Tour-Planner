import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import {
  serializeDay,
  summarizeDayLodging,
  TRAVEL_LEG_INCLUDE,
  PLANNED_LOCATIONS_INCLUDE,
} from "@/lib/trips";
import { regionOptions } from "@/lib/regions";
import { PRICE_LINES_SELECT, tripHeadcount } from "@/lib/costs";
import { ItineraryEditor } from "../../itinerary-editor";
import { VenueEngagementsProvider } from "../../venue-engagements";
import { loadVenueEngagements } from "@/lib/venue-engagements";

export const dynamic = "force-dynamic";

export default async function ItineraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { id } = await params;

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      tripType: { select: { id: true, name: true } },
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
                  location: { select: { id: true, name: true } },
                },
              },
              bookings: {
                orderBy: { createdAt: "asc" },
                include: {
                  bookedContact: { select: { id: true, name: true } },
                  priceLines: PRICE_LINES_SELECT,
                  // Deleting an item cascades its bookings + their payments;
                  // the confirm names how many.
                  _count: { select: { payments: true } },
                },
              },
            },
          },
          plannedLocations: PLANNED_LOCATIONS_INCLUDE,
        },
      },
    },
  });
  if (!trip) notFound();

  const categories = await prisma.scheduleItemCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, color: true, system: true },
  });

  // Location picker defaults to locations tagged with this trip's type;
  // `tagged` drives the "show all" toggle in the editor. The staff-only
  // planning facts (schedule limitations, host-site logistics, the go-to
  // contact) ride along so the editor can show them beside a chosen venue.
  const locations = await prisma.location.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      scheduleLimitations: true,
      region: { select: { name: true } },
      hostSite: { select: { logisticsNotes: true } },
      primaryContact: { select: { name: true, phone: true, email: true } },
      tripTypes: { where: { id: trip.tripType.id }, select: { id: true } },
      // Standing events here — the item form adds one in a click.
      events: {
        orderBy: [{ startTime: "asc" }, { title: "asc" }],
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          categoryId: true,
        },
      },
    },
  });
  // Rooms used at each venue on any trip — the item form's room suggestions.
  const roomRows = await prisma.scheduleItemSite.findMany({
    where: { scheduleItem: { room: { not: null } } },
    select: { locationId: true, scheduleItem: { select: { room: true } } },
  });
  const roomsByLocation = new Map<string, Set<string>>();
  for (const r of roomRows) {
    const set = roomsByLocation.get(r.locationId) ?? new Set<string>();
    set.add(r.scheduleItem.room!);
    roomsByLocation.set(r.locationId, set);
  }
  // Payments per item booking (site-less items only carry bookings).
  const paymentCounts: Record<string, number> = {};
  for (const d of trip.days)
    for (const it of d.scheduleItems)
      for (const b of it.bookings) paymentCounts[b.id] = b._count.payments;
  const contacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  // Catalogued talks for the item "talk" picker.
  const presentations = await prisma.presentation.findMany({
    where: { archivedAt: null },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      defaultPresenters: { select: { id: true, name: true } },
    },
  });

  // City picker for each day (the WP export's day header).
  const regions = await prisma.region.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const regionName = new Map(regions.map((r) => [r.id, r.name]));
  const cities = regionOptions(regions).map((o) => ({
    ...o,
    name: regionName.get(o.id) ?? o.label,
  }));

  // Where the group sleeps each night — the day cards' Overnight line.
  const stays = await prisma.stay.findMany({
    where: { tripId: id },
    orderBy: [{ priority: "desc" }, { checkIn: "asc" }],
    include: { location: { select: { id: true, name: true } } },
  });
  const lodgingByDay = summarizeDayLodging(trip.days, stays);

  // Each venue's (trip, location) engagement, shown beside the venue.
  const engagements = await loadVenueEngagements(
    trip.id,
    trip.days.flatMap((d) =>
      d.scheduleItems.flatMap((it) => it.sites.map((s) => s.locationId)),
    ),
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button asChild size="sm" variant="outline">
          <Link href={`/trips/${trip.id}/print`}>
            <Printer />
            Print
          </Link>
        </Button>
      </div>
      <VenueEngagementsProvider
        tripId={trip.id}
        canEdit={canEdit}
        engagements={engagements}
      >
        <ItineraryEditor
          tripId={trip.id}
          canEdit={canEdit}
          hasStartDate={trip.startDate != null}
          isTemplate={trip.isTemplate}
          days={trip.days.map(serializeDay)}
          categories={categories}
          locations={locations.map((l) => ({
            id: l.id,
            name: l.name,
            region: l.region?.name ?? null,
            tagged: l.tripTypes.length > 0,
            events: l.events,
            rooms: [...(roomsByLocation.get(l.id) ?? [])],
            scheduleLimitations: l.scheduleLimitations,
            logisticsNotes: l.hostSite?.logisticsNotes ?? null,
            primaryContact: l.primaryContact,
          }))}
          paymentCounts={paymentCounts}
          contacts={contacts}
          presentations={presentations}
          headcount={tripHeadcount(trip)}
          currencies={trip.currencies}
          defaultCurrency={trip.defaultCurrency}
          cities={cities}
          lodgingByDay={lodgingByDay}
        />
      </VenueEngagementsProvider>
    </div>
  );
}
