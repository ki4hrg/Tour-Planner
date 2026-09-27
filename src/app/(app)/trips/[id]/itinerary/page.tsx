import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import {
  serializeDay,
  TRAVEL_LEG_INCLUDE,
  PLANNED_LOCATIONS_INCLUDE,
} from "@/lib/trips";
import { ItineraryEditor } from "../../itinerary-editor";

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

  return (
    <div className="space-y-6">

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
      />
    </div>
  );
}
