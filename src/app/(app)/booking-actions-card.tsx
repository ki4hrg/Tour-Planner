import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { addDays, formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { actionItems, type TripRef } from "@/lib/cross-trip-bookings";
import { loadCrossTripBookings } from "@/lib/cross-trip-bookings.server";

// How far ahead a scheduled installment counts as "due soon".
const DUE_SOON_DAYS = 60;
// Per-section cap; the Bookings page has the rest.
const SECTION_MAX = 5;

type Line = {
  key: string;
  venue: string;
  trip: TripRef;
  detail: string;
  href: string;
  tone: "red" | "amber" | "muted";
};

// The home dashboard's single booking card (replacing the separate "Booking
// windows open" and "Payments due" cards): what needs doing across every trip
// in play — overdue payments, bookings where it's our move, open booking
// windows, installments coming due —
// from the same rows the booking dashboards use, so a venue with no booking
// record yet still surfaces once its window opens.
export async function BookingActionsCard({ today }: { today: Date }) {
  // Include past ACTIVE trips: an unpaid installment stays owed after the trip
  // runs. Booking windows and prices only matter for trips still ahead.
  const { groups } = await loadCrossTripBookings({ includePast: true });
  const todayKey = toDateInput(today);
  const ahead = (t: TripRef) => t.endDate == null || t.endDate >= todayKey;

  const items = actionItems(groups);
  const overdue: Line[] = [];
  const yourMove: Line[] = [];
  const bookNow: Line[] = [];
  let missingPrice = 0;
  for (const i of items) {
    if (i.reason === "paymentOverdue") {
      overdue.push({
        key: i.key,
        venue: i.locationName,
        trip: i.trip,
        detail: i.text,
        href: i.href,
        tone: "red",
      });
    } else if (!ahead(i.trip)) {
      continue;
    } else if (i.reason === "yourMove") {
      yourMove.push({
        key: i.key,
        venue: i.locationName,
        trip: i.trip,
        detail: i.text,
        href: i.href,
        tone: "amber",
      });
    } else if (i.reason === "windowOpen") {
      bookNow.push({
        key: i.key,
        venue: i.locationName,
        trip: i.trip,
        detail: i.text,
        href: i.href,
        tone: "amber",
      });
    } else {
      missingPrice++;
    }
  }

  const horizon = toDateInput(addDays(today, DUE_SOON_DAYS));
  const dueSoon: Line[] = groups
    .flatMap((g) =>
      g.rows.flatMap(({ trip, row }) => {
        // The first not-yet-due installment inside the horizon — looked up in
        // the whole schedule, since an overdue one (listed above) may sit
        // ahead of it.
        const next = row.schedule.find(
          (i) => i.state === "upcoming" && i.dueDate != null && i.dueDate <= horizon,
        );
        if (!next?.dueDate) return [];
        return [
          {
            key: `${trip.id}:${row.locationId}:due`,
            venue: g.locationName,
            trip,
            detail: `${next.outstanding != null ? formatMoney(next.outstanding, row.agreedCurrency) : "Payment"} due ${formatDate(next.dueDate)}${next.label ? ` · ${next.label}` : ""}`,
            href: `/trips/${trip.id}/booking?venue=${row.locationId}`,
            tone: "muted" as const,
            dueDate: next.dueDate,
          },
        ];
      }),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const total =
    overdue.length + yourMove.length + bookNow.length + dueSoon.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>
          Bookings needing action
          {total ? (
            <Badge
              variant={overdue.length ? "overdue" : "secondary"}
              className="ml-2 align-middle"
            >
              {total}
            </Badge>
          ) : null}
        </CardTitle>
        <Link
          href="/bookings"
          className="text-sm text-muted-foreground link-quiet"
        >
          All bookings
        </Link>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {total === 0 ? (
          <p className="text-muted-foreground">Nothing due.</p>
        ) : (
          <>
            <Section title="Overdue payments" lines={overdue} />
            <Section title="Your move" lines={yourMove} />
            <Section title="Window open" lines={bookNow} />
            <Section
              title={`Due in ${DUE_SOON_DAYS} days`}
              lines={dueSoon}
            />
          </>
        )}
        {missingPrice > 0 ? (
          <p className="text-xs text-muted-foreground">
            <Link href="/bookings" className="link-quiet">
              {missingPrice} without agreed price
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Section({ title, lines }: { title: string; lines: Line[] }) {
  if (lines.length === 0) return null;
  const shown = lines.slice(0, SECTION_MAX);
  const more = lines.length - shown.length;
  return (
    <section>
      <h4 className="mb-1 text-sm font-medium">
        {title}
        <span className="ml-1 font-normal text-muted-foreground">({lines.length})</span>
      </h4>
      <ul className="divide-y">
        {shown.map((l) => (
          <li
            key={l.key}
            className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <Link href={l.href} className="min-w-0 link-quiet">
              <span className="font-medium">{l.venue}</span>
              <span className="text-muted-foreground"> — {l.trip.name}</span>
            </Link>
            <span
              className={cn(
                "shrink-0 text-xs",
                l.tone === "red" && "font-medium text-destructive",
                l.tone === "amber" &&
                  "font-medium text-amber-700 dark:text-amber-300",
                l.tone === "muted" && "text-muted-foreground",
              )}
            >
              {l.detail}
            </span>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <Link
          href="/bookings"
          className="mt-1 inline-block text-xs text-muted-foreground link-quiet"
        >
          +{more} more
        </Link>
      ) : null}
    </section>
  );
}
