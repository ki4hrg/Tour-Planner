import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import {
  serializeDay,
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
  // `tagged` drives the "show all" toggle in the editor.
  const locations = await prisma.location.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      region: { select: { name: true } },
      tripTypes: { where: { id: trip.tripType.id }, select: { id: true } },
    },
  });
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

  // Each venue's (trip, location) engagement, shown beside the venue.
  const engagements = await loadVenueEngagements(
    trip.id,
    trip.days.flatMap((d) =>
      d.scheduleItems.flatMap((it) => it.sites.map((s) => s.locationId)),
    ),
  );

  return (
    <div className="space-y-6">
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
          }))}
          contacts={contacts}
          presentations={presentations}
          headcount={tripHeadcount(trip)}
          currencies={trip.currencies}
          cities={cities}
        />
      </VenueEngagementsProvider>
    </div>
  );
}
