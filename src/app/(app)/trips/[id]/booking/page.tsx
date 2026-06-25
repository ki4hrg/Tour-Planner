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
          stops: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              bookingStatus: true,
              confirmationRef: true,
              site: {
                select: { name: true, bookingOpensLeadDays: true },
              },
              bookedContact: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!trip) notFound();

  // Flatten to bookable stops (drop NOT_NEEDED), enrich with the booking window.
  const rows = trip.days
    .flatMap((day) =>
      day.stops.map((stop) => {
        const win = bookingWindow(
          trip.startDate,
          stop.site?.bookingOpensLeadDays ?? null,
        );
        return {
          id: stop.id,
          dayIndex: day.dayIndex,
          dayDate: day.date,
          label: stop.site?.name ?? stop.title ?? "Untitled stop",
          status: stop.bookingStatus,
          confirmationRef: stop.confirmationRef,
          contactName: stop.bookedContact?.name ?? null,
          ...win,
          // Action needed = window open and not yet booked.
          actionable:
            win.open &&
            (stop.bookingStatus === "NOT_BOOKED" ||
              stop.bookingStatus === "REQUESTED"),
        };
      }),
    )
    .filter((r) => r.status !== "NOT_NEEDED")
    // Sort: earliest-bookable ascending, stops with no window last.
    .sort((a, b) => {
      if (a.earliest && b.earliest)
        return a.earliest.getTime() - b.earliest.getTime();
      if (a.earliest) return -1;
      if (b.earliest) return 1;
      return a.dayIndex - b.dayIndex;
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
              No bookable stops yet. Add stops to the itinerary and set their
              booking status.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stop</TableHead>
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
                      Day {r.dayIndex}
                      {r.dayDate ? (
                        <span className="block text-xs">
                          {formatDate(r.dayDate)}
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
