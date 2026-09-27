import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildDashboardRows } from "@/lib/booking-dashboard";
import { DOCUMENT_SELECT, serializeDocument } from "@/lib/documents";
import { BookingDashboard } from "../../booking-dashboard";

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
      startDate: true,
      days: {
        orderBy: { dayIndex: "asc" },
        select: {
          dayIndex: true,
          date: true,
          scheduleItems: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              startTime: true,
              endTime: true,
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
                  status: true,
                  confirmationRef: true,
                  bookedContact: { select: { name: true } },
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
          status: true,
          confirmationRef: true,
          notes: true,
          bookedContactId: true,
          bookedContact: {
            select: { id: true, name: true, phone: true, email: true },
          },
          bookedOn: true,
          createdAt: true,
          agreedAmount: true,
          agreedCurrency: true,
          agreedUnit: true,
          payments: { orderBy: { paidOn: "asc" } },
          paymentSchedule: true,
        },
      },
      stays: {
        select: {
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
      ...trip.stays.map((s) => s.locationId),
      ...trip.bookings.flatMap((b) => (b.locationId ? [b.locationId] : [])),
    ]),
  ];
  const locations = locationIds.length
    ? await prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: {
          id: true,
          name: true,
          bookable: true,
          bookingOpensLeadDays: true,
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
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Booking dashboard</h1>
          <p className="text-sm text-muted-foreground">{trip.name}</p>
        </div>
        <Link
          href={`/trips/${trip.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Overview
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          <BookingDashboard
            tripId={trip.id}
            canEdit={canEdit}
            venueRows={venueRows}
            itemRows={itemRows}
            contacts={contacts}
            currencies={trip.currencies}
            documentsByBooking={documentsByBooking}
            focusLocationId={venue ?? null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
