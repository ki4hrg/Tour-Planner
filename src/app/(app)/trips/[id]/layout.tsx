import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { todayUtc } from "@/lib/dates";
import { deriveTripLifecycle, TRIP_LIFECYCLE_LABELS } from "@/lib/trips";
import { TripHeader } from "./trip-header";

export const dynamic = "force-dynamic";

// Shared chrome for a trip's working pages (overview, itinerary, bookings): the
// trip name + status and a tab bar, so bookings are one tap from anywhere on
// the trip. Field and print views (today, single day, print) hide it — see
// TripHeader.
export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trip = await prisma.trip.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      isTemplate: true,
      status: true,
      startDate: true,
      endDate: true,
      tripTypeId: true,
      tripType: { select: { name: true } },
    },
  });
  if (!trip) notFound();

  return (
    <div className="space-y-6">
      <TripHeader
        tripId={trip.id}
        name={trip.name}
        isTemplate={trip.isTemplate}
        lifecycleLabel={
          TRIP_LIFECYCLE_LABELS[deriveTripLifecycle(trip, todayUtc())]
        }
        tripTypeId={trip.tripTypeId}
        tripTypeName={trip.tripType.name}
        dateRange={formatRange(trip.startDate, trip.endDate)}
      />
      {children}
    </div>
  );
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// "1 Jun – 6 Jun 2027" (year once when both ends share it).
function formatRange(start: Date | null, end: Date | null): string | null {
  if (!start) return null;
  if (!end) return DAY_MONTH_YEAR.format(start);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  return `${(sameYear ? DAY_MONTH : DAY_MONTH_YEAR).format(start)} – ${DAY_MONTH_YEAR.format(end)}`;
}
