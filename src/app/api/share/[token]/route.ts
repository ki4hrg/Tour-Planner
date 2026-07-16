import { prisma } from "@/lib/db";
import { toDateInput, todayUtc } from "@/lib/dates";
import { serializeDay, TRAVEL_LEG_INCLUDE } from "@/lib/trips";
import { isShareLinkActive } from "@/lib/share";
import { buildShareFeedEvents, type ShareFeedStay } from "@/lib/share-feed";
import { buildIcsCalendar, formatIcsUtcStamp } from "@/lib/ics";

// Reads the DB per request; never prerender (no DATABASE_URL at build time).
export const dynamic = "force-dynamic";

// The item include tree serializeDay expects (mirrors the HTML share page query).
const SCHEDULE_ITEM_INCLUDE = {
  orderBy: { order: "asc" as const },
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
      orderBy: { order: "asc" as const },
      include: { location: { select: { id: true, name: true } } },
    },
    bookings: {
      orderBy: { createdAt: "asc" as const },
      include: { bookedContact: { select: { id: true, name: true } } },
    },
  },
} as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");

  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      trip: {
        include: {
          days: {
            orderBy: { dayIndex: "asc" },
            include: { scheduleItems: SCHEDULE_ITEM_INCLUDE },
          },
        },
      },
    },
  });

  // Same gate as the share page + staff feed: unknown/disabled/expired → 404. The
  // token is the only capability, so never distinguish "wrong" from "disabled".
  if (!link || !isShareLinkActive(link, todayUtc())) {
    return new Response("Not found", { status: 404 });
  }

  const trip = link.trip;

  // All stays for the trip; the share-feed builder scopes them to the host site
  // (HOST_SITE) and strips their notes for non-staff audiences.
  const stayRows = await prisma.stay.findMany({
    where: { tripId: trip.id },
    orderBy: [{ priority: "desc" }, { checkIn: "asc" }],
    include: { location: { select: { id: true, name: true } } },
  });
  const stays: ShareFeedStay[] = stayRows.map((s) => ({
    id: s.id,
    locationId: s.locationId,
    locationName: s.location.name,
    checkIn: s.checkIn ? toDateInput(s.checkIn) : null,
    checkOut: s.checkOut ? toDateInput(s.checkOut) : null,
    notes: s.notes,
  }));

  const events = buildShareFeedEvents(
    link.audience,
    {
      id: trip.id,
      name: trip.name,
      notes: trip.notes,
      startDate: trip.startDate ? toDateInput(trip.startDate) : null,
      endDate: trip.endDate ? toDateInput(trip.endDate) : null,
      days: trip.days.map(serializeDay),
      stays,
    },
    link.locationId,
  );

  const name = link.label?.trim() || trip.name;
  const ics = buildIcsCalendar({
    name,
    events,
    dtstamp: formatIcsUtcStamp(new Date().toISOString()),
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="tour-planner-${link.audience.toLowerCase()}.ics"`,
      // Subscribers poll periodically; a short cache smooths bursts.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
