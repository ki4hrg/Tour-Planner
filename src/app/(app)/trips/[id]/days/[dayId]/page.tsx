import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import {
  TRIP_STATUS_LABELS,
  serializeDay,
  summarizeDayLodging,
} from "@/lib/trips";
import { DayTimeline } from "./day-timeline";

export const dynamic = "force-dynamic";

// A focused, mobile-first single-day view — the on-the-ground "what's happening
// today" screen. Reuses the venue-grouped timeline; adds day nav + lodging.
export default async function TripDayPage({
  params,
}: {
  params: Promise<{ id: string; dayId: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { id, dayId } = await params;

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
              sites: {
                orderBy: { order: "asc" },
                include: {
                  location: {
                    select: {
                      id: true,
                      name: true,
                      // Staff-only on-site affordances (maps link, one-tap call).
                      // Never load these on share-page queries — and
                      // redactDaysForShare strips them defensively regardless.
                      mapUrl: true,
                      primaryContact: { select: { name: true, phone: true } },
                    },
                  },
                },
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

  const index = trip.days.findIndex((d) => d.id === dayId);
  if (index === -1) notFound();
  const day = trip.days[index];
  const prev = index > 0 ? trip.days[index - 1] : null;
  const next = index < trip.days.length - 1 ? trip.days[index + 1] : null;

  const stays = await prisma.stay.findMany({
    where: { tripId: id },
    orderBy: [{ priority: "desc" }, { checkIn: "asc" }],
    include: { location: { select: { id: true, name: true } } },
  });
  const lodging = summarizeDayLodging(trip.days, stays)[day.id] ?? null;

  const serialized = serializeDay(day);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/trips/${trip.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {trip.name}
        </Link>
        <Badge variant="secondary">{TRIP_STATUS_LABELS[trip.status]}</Badge>
      </div>

      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Day {day.dayIndex}
          {day.date ? ` · ${formatDate(day.date)}` : ""}
        </p>
        <h1 className="text-2xl font-semibold">
          {day.title ?? `Day ${day.dayIndex}`}
        </h1>
        {day.logisticalNotes ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {day.logisticalNotes}
          </p>
        ) : null}
        {day.participantNotes ? (
          <p className="whitespace-pre-wrap text-sm italic text-muted-foreground">
            {day.participantNotes}
          </p>
        ) : null}
      </header>

      <div className="rounded-lg border bg-card p-4">
        {serialized.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
        ) : (
          <DayTimeline
            tripId={trip.id}
            items={serialized.items}
            lodging={lodging}
            canEdit={canEdit}
          />
        )}
      </div>

      <nav className="flex items-center justify-between gap-2">
        {prev ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/trips/${trip.id}/days/${prev.id}`}>
              <ChevronLeft className="size-4" /> Day {prev.dayIndex}
            </Link>
          </Button>
        ) : (
          <span />
        )}
        <Button asChild variant="ghost" size="sm">
          <Link href={`/trips/${trip.id}/itinerary`}>Full itinerary</Link>
        </Button>
        {next ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/trips/${trip.id}/days/${next.id}`}>
              Day {next.dayIndex} <ChevronRight className="size-4" />
            </Link>
          </Button>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
