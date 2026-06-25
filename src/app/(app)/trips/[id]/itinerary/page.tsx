import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { TRIP_STATUS_LABELS, serializeDay } from "@/lib/trips";
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
          stops: {
            orderBy: { order: "asc" },
            include: {
              site: { select: { id: true, name: true } },
              bookedContact: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!trip) notFound();

  // Site picker defaults to sites tagged with this trip's type; `tagged`
  // drives the "show all" toggle in the editor.
  const sites = await prisma.site.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      region: true,
      tripTypes: { where: { id: trip.tripType.id }, select: { id: true } },
    },
  });
  const contacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {trip.name}
            <Badge variant="secondary">{TRIP_STATUS_LABELS[trip.status]}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {trip.tripType.name}
            {trip.startDate ? ` · starts ${formatDate(trip.startDate)}` : ""}
          </p>
        </div>
        <Link
          href={`/trips/${trip.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Overview
        </Link>
      </div>

      <ItineraryEditor
        tripId={trip.id}
        canEdit={canEdit}
        hasStartDate={trip.startDate != null}
        days={trip.days.map(serializeDay)}
        sites={sites.map((s) => ({
          id: s.id,
          name: s.name,
          region: s.region,
          tagged: s.tripTypes.length > 0,
        }))}
        contacts={contacts}
      />
    </div>
  );
}
