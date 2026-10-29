import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildDashboardRows } from "@/lib/booking-dashboard";
import { withBookedViaParentsWhere } from "@/lib/booked-via";
import { PRICE_LINES_SELECT, tripHeadcount } from "@/lib/costs";
import { DOCUMENT_SELECT, serializeDocument } from "@/lib/documents";
import { BookingDashboard } from "../../booking-dashboard";
import { BOOKING_PROGRESS_SELECT } from "@/lib/booking-workflow";
import { loadWorkflowCatalog } from "@/lib/booking-workflow-sync";

export const dynamic = "force-dynamic";

export default async function BookingDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ venue?: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { id } = await params;
  const { venue } = await searchParams;

  const trip = await prisma.trip.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      currencies: true,
      defaultCurrency: true,
      startDate: true,
      participantCount: true,
      capacity: true,
      days: {
        orderBy: { dayIndex: "asc" },
        select: {
          id: true,
          dayIndex: true,
          date: true,
          plannedLocations: { select: { locationId: true } },
          scheduleItems: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              startTime: true,
              endTime: true,
              mealKind: true,
              mealProvision: true,
              mealProviderId: true,
              confirmation: true,
              confirmedOn: true,
              category: { select: { name: true } },
              presentation: { select: { title: true } },
              // Label derivation for a travel item's site-less booking row.
              travel: {
                select: {
                  method: true,
                  toLabel: true,
                  toLocation: { select: { name: true } },
                },
              },
              sites: { select: { locationId: true } },
              bookings: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  label: true,
                  ...BOOKING_PROGRESS_SELECT,
                  confirmationRef: true,
                  bookedContact: { select: { name: true } },
                  agreedCurrency: true,
                  priceLines: PRICE_LINES_SELECT,
                },
              },
            },
          },
        },
      },
      // Venue-engagement bookings for this trip.
      bookings: {
        select: {
          id: true,
          locationId: true,
          label: true,
          ...BOOKING_PROGRESS_SELECT,
          confirmationRef: true,
          notes: true,
          bookedContactId: true,
          bookedContact: {
            select: { id: true, name: true, phone: true, email: true },
          },
          bookedOn: true,
          createdAt: true,
          agreedCurrency: true,
          priceLines: PRICE_LINES_SELECT,
          payments: { orderBy: { paidOn: "asc" } },
          paymentSchedule: true,
        },
      },
      stays: {
        select: {
          id: true,
          locationId: true,
          checkIn: true,
          checkOut: true,
          checkInDayIndex: true,
          checkOutDayIndex: true,
        },
      },
    },
  });
  if (!trip) notFound();

  // Pull cost/lead-day detail for every location the trip engages (via sessions,
  // lodging, or an existing engagement) in one query.
  const locationIds = [
    ...new Set([
      ...trip.days.flatMap((d) =>
        d.scheduleItems.flatMap((i) => i.sites.map((s) => s.locationId)),
      ),
      ...trip.days.flatMap((d) => d.plannedLocations.map((p) => p.locationId)),
      ...trip.stays.map((s) => s.locationId),
      ...trip.bookings.flatMap((b) => (b.locationId ? [b.locationId] : [])),
    ]),
  ];
  const locations = locationIds.length
    ? await prisma.location.findMany({
        // + the parents child sites are booked via (their rows' heading).
        where: withBookedViaParentsWhere(locationIds),
        select: {
          id: true,
          name: true,
          bookedViaId: true,
          bookable: true,
          bookingOpensLeadDays: true,
          bookingNotes: true,
          scheduleLimitations: true,
          defaultWorkflowId: true,
          region: { select: { name: true } },
          costs: true,
        },
      })
    : [];

  // Paperwork filed against this trip's bookings, indexed by booking so each row
  // can show its own contracts and invoices without a query per row.
  const bookingDocuments = await prisma.document.findMany({
    where: {
      booking: {
        OR: [{ tripId: trip.id }, { scheduleItem: { day: { tripId: trip.id } } }],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { ...DOCUMENT_SELECT, bookingId: true },
  });
  const documentsByBooking: Record<string, ReturnType<typeof serializeDocument>[]> =
    {};
  for (const doc of bookingDocuments) {
    if (!doc.bookingId) continue;
    (documentsByBooking[doc.bookingId] ??= []).push(serializeDocument(doc));
  }

  const contacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const { venueRows, itemRows } = buildDashboardRows({
    days: trip.days,
    engagements: trip.bookings,
    stays: trip.stays,
    locations,
    tripStartDate: trip.startDate,
    headcount: tripHeadcount(trip),
    defaultCurrency: trip.defaultCurrency,
    workflows: await loadWorkflowCatalog(),
  });
  // A deep link to a site booked via a parent opens the parent's row.
  const focusVenue = venue
    ? (locations.find((l) => l.id === venue)?.bookedViaId ?? venue)
    : null;

  return (
    <div className="space-y-6">

      <Card>
        <CardHeader>
          <CardTitle>Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          <BookingDashboard
            // Remount per deep-linked venue: the expanded row and cleared
            // filters are initial state, set only on mount.
            key={venue ?? ""}
            tripId={trip.id}
            canEdit={canEdit}
            venueRows={venueRows}
            itemRows={itemRows}
            contacts={contacts}
            currencies={trip.currencies}
            documentsByBooking={documentsByBooking}
            focusLocationId={focusVenue}
          />
        </CardContent>
      </Card>
    </div>
  );
}
