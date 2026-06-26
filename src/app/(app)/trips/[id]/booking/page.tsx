import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { bookingWindow } from "@/lib/booking";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_CLASSES } from "@/lib/trips";

export const dynamic = "force-dynamic";

export default async function BookingDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const trip = await prisma.trip.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      startDate: true,
      days: {
        orderBy: { dayIndex: "asc" },
        select: {
          dayIndex: true,
          date: true,
          scheduleItems: {
            orderBy: { order: "asc" },
            select: {
              title: true,
              bookings: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  label: true,
                  status: true,
                  confirmationRef: true,
                  location: {
                    select: { name: true, bookingOpensLeadDays: true },
                  },
                  bookedContact: { select: { name: true } },
                },
              },
            },
          },
        },
      },
      stays: {
        orderBy: { checkIn: "asc" },
        select: {
          checkIn: true,
          label: true,
          location: { select: { name: true, bookingOpensLeadDays: true } },
          booking: {
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
  });
  if (!trip) notFound();

  // Item bookings — window keyed off the trip start date.
  const itemRows = trip.days.flatMap((day) =>
    day.scheduleItems.flatMap((item) =>
      item.bookings.map((b) => {
        const win = bookingWindow(
          trip.startDate,
          b.location?.bookingOpensLeadDays ?? null,
        );
        return {
          id: b.id,
          whenLabel: `Day ${day.dayIndex}`,
          whenDate: day.date,
          order: day.dayIndex,
          label: b.label ?? b.location?.name ?? item.title ?? "Untitled item",
          status: b.status,
          confirmationRef: b.confirmationRef,
          contactName: b.bookedContact?.name ?? null,
          ...win,
          actionable:
            win.open && (b.status === "NOT_BOOKED" || b.status === "REQUESTED"),
        };
      }),
    ),
  );

  // Stay (lodging) bookings — window keyed off the stay's check-in date.
  const stayRows = trip.stays
    .filter((s) => s.booking)
    .map((s) => {
      const b = s.booking!;
      const win = bookingWindow(
        s.checkIn,
        s.location.bookingOpensLeadDays ?? null,
      );
      return {
        id: b.id,
        whenLabel: "Lodging",
        whenDate: s.checkIn,
        order: Number.MAX_SAFE_INTEGER,
        label: b.label ?? s.label ?? `Lodging — ${s.location.name}`,
        status: b.status,
        confirmationRef: b.confirmationRef,
        contactName: b.bookedContact?.name ?? null,
        ...win,
        actionable:
          win.open && (b.status === "NOT_BOOKED" || b.status === "REQUESTED"),
      };
    });

  // Sort: earliest-bookable ascending, bookings with no window last.
  const rows = [...itemRows, ...stayRows].sort((a, b) => {
    if (a.earliest && b.earliest)
      return a.earliest.getTime() - b.earliest.getTime();
    if (a.earliest) return -1;
    if (b.earliest) return 1;
    return a.order - b.order;
  });

  const actionCount = rows.filter((r) => r.actionable).length;

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
          <CardTitle className="text-base">
            {actionCount > 0 ? (
              <span>
                {actionCount} booking
                {actionCount === 1 ? "" : "s"} need attention
                <span className="text-muted-foreground">
                  {" "}
                  — window open, not yet booked
                </span>
              </span>
            ) : (
              "Nothing needs booking right now"
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bookings yet. Add a booking to a schedule item in the itinerary
              to track it here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Booked with</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className={cn(r.actionable && "bg-amber-50 dark:bg-amber-950/40")}
                  >
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.whenLabel}
                      {r.whenDate ? (
                        <span className="block text-xs">
                          {formatDate(r.whenDate)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          BOOKING_STATUS_CLASSES[r.status],
                        )}
                      >
                        {BOOKING_STATUS_LABELS[r.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.status === "CONFIRMED" ? (
                        <span className="text-muted-foreground">Booked</span>
                      ) : r.earliest == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : r.open ? (
                        <span className="font-medium text-amber-700 dark:text-amber-300">
                          Open now
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Opens {formatDate(r.earliest)}
                          {r.daysUntilOpen != null
                            ? ` (${r.daysUntilOpen}d)`
                            : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.contactName ?? "—"}
                      {r.confirmationRef ? (
                        <span className="block text-xs">
                          ref {r.confirmationRef}
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
