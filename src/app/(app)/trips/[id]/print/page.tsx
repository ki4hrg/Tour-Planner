import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { serializeDay, summarizeDayLodging, TRAVEL_LEG_INCLUDE } from "@/lib/trips";
import { TimelineGroups } from "../../itinerary-timeline";
import { PrintActions } from "./print-actions";

export const dynamic = "force-dynamic";

// A print-friendly, fully-expanded itinerary. The app nav (print:hidden) and the
// on-screen controls drop out of the printout; each day starts on a fresh page.
export default async function TripPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      tripType: { select: { name: true } },
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
                include: { location: { select: { id: true, name: true } } },
              },
              bookings: {
                orderBy: { createdAt: "asc" },
                include: { bookedContact: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!trip) notFound();

  const stays = await prisma.stay.findMany({
    where: { tripId: id },
    orderBy: [{ priority: "desc" }, { checkIn: "asc" }],
    include: { location: { select: { id: true, name: true } } },
  });
  const lodgingByDay = summarizeDayLodging(trip.days, stays);
  const days = trip.days.map(serializeDay);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PrintActions tripId={trip.id} />

      <header className="space-y-1 border-b pb-4">
        <h1 className="text-3xl font-semibold">{trip.name}</h1>
        <p className="text-sm text-muted-foreground">
          {trip.tripType.name}
          {trip.startDate
            ? ` · ${formatDate(trip.startDate)}${
                trip.endDate ? ` – ${formatDate(trip.endDate)}` : ""
              }`
            : ""}
        </p>
      </header>

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No days scheduled.</p>
      ) : (
        days.map((day, i) => (
          <section
            key={day.id}
            className={i > 0 ? "break-before-page pt-2" : ""}
          >
            <h2 className="mb-1 text-xl font-semibold">
              Day {day.dayIndex}
              {day.title ? ` — ${day.title}` : ""}
              {day.date ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {formatDate(day.date)}
                </span>
              ) : null}
            </h2>
            {day.logisticalNotes ? (
              <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {day.logisticalNotes}
              </p>
            ) : null}
            {day.participantNotes ? (
              <p className="mb-2 whitespace-pre-wrap text-sm italic text-muted-foreground">
                {day.participantNotes}
              </p>
            ) : null}
            {day.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              <TimelineGroups
                items={day.items}
                lodging={lodgingByDay[day.id] ?? null}
              />
            )}
          </section>
        ))
      )}
    </div>
  );
}
