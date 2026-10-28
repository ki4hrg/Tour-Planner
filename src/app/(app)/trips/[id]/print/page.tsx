import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import {
  PLANNED_LOCATIONS_INCLUDE,
  serializeDay,
  summarizeDayLodging,
  TRAVEL_LEG_INCLUDE,
  type SerializedDay,
} from "@/lib/trips";
import { lodgingForDays } from "@/lib/stays";
import { TimelineGroups } from "../../itinerary-timeline";
import { PrintActions } from "./print-actions";

export const dynamic = "force-dynamic";

// Rough-plan locations (GH #9) not already visited by a timed item — a day may
// carry these instead of, or alongside, its timed schedule. Mirrors the
// itinerary overview's "Planned:" line so the printout doesn't silently drop
// a day whose plan is still just a loose location cluster.
function unscheduledLocations(day: SerializedDay): string[] {
  const visited = new Set(
    day.items.flatMap((item) => item.sites.map((s) => s.location.name)),
  );
  return (day.plannedLocations ?? [])
    .filter((p) => !visited.has(p.name))
    .map((p) => (p.note ? `${p.name} (${p.note})` : p.name));
}

// The day's venue contacts for the paper fallback: each visited venue's
// primary contact plus the overnight venue's, deduped by venue, in visit
// order. Name alone is kept (a name to ask for at the desk) when the contact
// has no phone.
type DayContact = { venue: string; name: string; phone: string | null };
function dayContacts(
  day: SerializedDay,
  overnight: {
    id: string;
    name: string;
    primaryContact: { name: string; phone: string | null } | null;
  } | null,
): DayContact[] {
  const seen = new Set<string>();
  const out: DayContact[] = [];
  for (const item of day.items) {
    for (const s of item.sites) {
      const c = s.location.primaryContact;
      if (!c || seen.has(s.location.id)) continue;
      seen.add(s.location.id);
      out.push({ venue: s.location.name, name: c.name, phone: c.phone });
    }
  }
  // A day spent at the overnight venue already lists its contact above.
  if (overnight?.primaryContact && !seen.has(overnight.id)) {
    out.push({
      venue: `${overnight.name} (overnight)`,
      name: overnight.primaryContact.name,
      phone: overnight.primaryContact.phone,
    });
  }
  return out;
}

// A print-friendly, fully-expanded itinerary. The app nav (print:hidden) and the
// on-screen controls drop out of the printout. Days flow across pages instead of
// each forcing a fresh one — short days share a page, long ones spill over — while
// break-inside-avoid on headings/runs/rows keeps individual pieces from splitting.
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
                include: {
                  location: {
                    select: {
                      id: true,
                      name: true,
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
          plannedLocations: PLANNED_LOCATIONS_INCLUDE,
        },
      },
    },
  });
  if (!trip) notFound();

  const stays = await prisma.stay.findMany({
    where: { tripId: id },
    orderBy: [{ priority: "desc" }, { checkIn: "asc" }],
    include: {
      location: {
        select: {
          id: true,
          name: true,
          primaryContact: { select: { name: true, phone: true } },
        },
      },
    },
  });
  const lodgingByDay = summarizeDayLodging(trip.days, stays);
  const overnightByDay = lodgingForDays(trip.days, stays);
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
        <p className="text-sm text-muted-foreground">No days.</p>
      ) : (
        days.map((day, i) => {
          const planned = unscheduledLocations(day);
          const contacts = dayContacts(
            day,
            overnightByDay.get(day.id)?.location ?? null,
          );
          return (
            <section
              key={day.id}
              className={i > 0 ? "border-t pt-4" : ""}
            >
              <h2 className="mb-1 break-after-avoid-page text-xl font-semibold">
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
                <p className="mb-2 break-inside-avoid-page whitespace-pre-wrap text-sm text-muted-foreground">
                  {day.logisticalNotes}
                </p>
              ) : null}
              {day.participantNotes ? (
                <p className="mb-2 break-inside-avoid-page whitespace-pre-wrap text-sm italic text-muted-foreground">
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
              {planned.length > 0 ? (
                <p className="mt-2 break-inside-avoid-page text-xs text-muted-foreground">
                  <span className="font-medium">Planned:</span>{" "}
                  {planned.join(" · ")}
                </p>
              ) : null}
              {contacts.length > 0 ? (
                <p className="mt-2 break-inside-avoid-page text-xs text-muted-foreground">
                  <span className="font-medium">Contacts:</span>{" "}
                  {contacts.map((c, ci) => (
                    <span key={`${c.venue}-${ci}`}>
                      {ci > 0 ? " · " : ""}
                      {c.venue} — {c.name}
                      {c.phone ? (
                        <span className="tabular-nums"> {c.phone}</span>
                      ) : null}
                    </span>
                  ))}
                </p>
              ) : null}
            </section>
          );
        })
      )}
    </div>
  );
}
