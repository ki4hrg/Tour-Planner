"use client";

import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Mail, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ContactChannels } from "@/components/contact-channels";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { isBookingOff, isBookingSecured } from "@/lib/booking";
import type { VenueBookingRow } from "@/lib/booking-dashboard";
import {
  ALL_ATTENTION_FILTERS,
  NO_ATTENTION_FILTERS,
  anyFilterOn,
  buildVenueEmail,
  filterVenueGroups,
  formatTripDates,
  isYourMove,
  rowMatchesFilters,
  rowNeedsAttention,
  type AttentionFilters,
  type TripItemBookings,
  type VenueGroup,
  type VenueTripRow,
} from "@/lib/cross-trip-bookings";
import { WorkflowControl } from "../trips/workflow-control";
import { WaitingNote } from "../trips/waiting-note";
import { PriceCell, WindowCell, coverageLine } from "../trips/booking-row";

const FILTER_LABELS: { key: keyof AttentionFilters; label: string }[] = [
  { key: "windowOpen", label: "Window open" },
  { key: "missingPrice", label: "Missing price" },
  { key: "unconfirmed", label: "Unconfirmed" },
  { key: "paymentOverdue", label: "Payment overdue" },
  { key: "yourMove", label: "Your move" },
];

export function CrossTripBookings({
  groups,
  itemBookings,
  statusFiltered = false,
  canEdit,
}: {
  groups: VenueGroup[];
  itemBookings: TripItemBookings[];
  // Already narrowed to picked master statuses: show every row of them
  // rather than only the ones needing attention.
  statusFiltered?: boolean;
  canEdit: boolean;
}) {
  const [filters, setFilters] = useState<AttentionFilters>(
    statusFiltered ? NO_ATTENTION_FILTERS : ALL_ATTENTION_FILTERS,
  );
  const [search, setSearch] = useState("");
  const anyFilter = anyFilterOn(filters);

  const shown = useMemo(
    () => filterVenueGroups(groups, filters, search),
    [groups, filters, search],
  );

  const q = search.trim().toLowerCase();
  const shownItems = itemBookings
    .map(({ trip, itemRows }) => ({
      trip,
      itemRows: itemRows.filter(
        (r) =>
          (!anyFilter ||
            (filters.unconfirmed &&
              !isBookingSecured(r.status) &&
              !isBookingOff(r.status)) ||
            (filters.yourMove && isYourMove(r))) &&
          (!q || r.label.toLowerCase().includes(q)),
      ),
    }))
    .filter((t) => t.itemRows.length > 0);

  if (groups.length === 0 && itemBookings.length === 0) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          {statusFiltered ? "No bookings at this status." : "No venues to book."}
        </CardContent>
      </Card>
    );
  }

  const allShown = !anyFilter && !q;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search venues…"
              aria-label="Search venues"
              className="pl-8"
            />
          </div>
          <span className="text-muted-foreground">Show:</span>
          {FILTER_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5">
              <Checkbox
                checked={filters[key]}
                onCheckedChange={(v) =>
                  setFilters((prev) => ({ ...prev, [key]: v === true }))
                }
              />
              {label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button
            type="button"
            size="sm"
            variant={allShown ? "secondary" : "outline"}
            onClick={() => {
              setFilters(NO_ATTENTION_FILTERS);
              setSearch("");
            }}
          >
            Show all
          </Button>
          {anyFilter ? null : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setFilters(ALL_ATTENTION_FILTERS)}
            >
              Needs work
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {allShown
              ? `All ${groups.length} venues`
              : `${shown.length} of ${groups.length} venues`}
          </span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No matches.
        </p>
      ) : (
        shown.map((g) => (
          <VenueCardGroup
            key={g.locationId}
            group={g}
            filters={filters}
            canEdit={canEdit}
          />
        ))
      )}

      {shownItems.length > 0 ? (
        <OtherBookings trips={shownItems} canEdit={canEdit} />
      ) : null}
    </div>
  );
}

function VenueCardGroup({
  group,
  filters,
  canEdit,
}: {
  group: VenueGroup;
  filters: AttentionFilters;
  canEdit: boolean;
}) {
  const email = buildVenueEmail(group);
  const anyFilter = anyFilterOn(filters);
  // Flag rows the current filter picked out (or, with no filter, the ones that
  // sort the venue up) so the trip that needs work stands out among its siblings.
  const flagged = (r: VenueBookingRow) =>
    anyFilter ? rowMatchesFilters(r, filters) : rowNeedsAttention(r);

  return (
    <Card id={`venue-${group.locationId}`} className="scroll-mt-20 gap-4">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Link
                href={`/locations/${group.locationId}`}
                className="link-quiet"
              >
                {group.locationName}
              </Link>
              {group.attentionCount > 0 ? (
                <Badge variant="attention">
                  {group.attentionCount} need
                  {group.attentionCount === 1 ? "s" : ""} attention
                </Badge>
              ) : null}
            </CardTitle>
            {group.regionPath ? (
              <p className="text-xs text-muted-foreground">
                {group.regionPath}
              </p>
            ) : null}
          </div>
          {email.tripCount > 0 ? (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="w-full sm:w-auto"
            >
              <a
                href={email.href}
                title={
                  email.to.length
                    ? `Email ${email.to.join(", ")}`
                    : "No contact email"
                }
              >
                <Mail className="size-4" />
                Email about {email.tripCount} trip
                {email.tripCount === 1 ? "" : "s"}
              </a>
            </Button>
          ) : null}
        </div>
        {group.contacts.length ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {group.contacts.map((c) => (
              <li key={c.id} className="flex items-center gap-1.5">
                <span>
                  {c.name}
                  {c.role ? `, ${c.role}` : ""}
                  <span className="text-xs">
                    {c.primary ? " · primary" : " · booked with"}
                  </span>
                </span>
                <ContactChannels phone={c.phone} email={c.email} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            No contact ·{" "}
            <Link
              href={`/locations/${group.locationId}#contacts`}
              className="link-quiet"
            >
              Set primary contact
            </Link>
          </p>
        )}
      </CardHeader>
      <CardContent>
        {/* Desktop: one table row per trip. Below sm the table doesn't stack. */}
        <div className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trip</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map((r) => (
                <TableRow
                  key={r.trip.id}
                  className={cn(
                    flagged(r.row) && "bg-amber-50 dark:bg-amber-950/40",
                    isBookingOff(r.row.status) && "text-muted-foreground",
                  )}
                >
                  <TableCell>
                    <TripCell entry={r} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <WindowCell row={r.row} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <PriceCell row={r.row} />
                  </TableCell>
                  <TableCell>
                    <VenueStatus entry={r} canEdit={canEdit} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-2 sm:hidden">
          {group.rows.map((r) => (
            <div
              key={r.trip.id}
              className={cn(
                "rounded-lg border p-3",
                flagged(r.row) && "bg-amber-50 dark:bg-amber-950/40",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <TripCell entry={r} />
                </div>
                <span className="shrink-0">
                  <VenueStatus entry={r} canEdit={canEdit} />
                </span>
              </div>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex items-baseline gap-2">
                  <dt className="w-16 shrink-0 text-xs text-muted-foreground">
                    Window
                  </dt>
                  <dd>
                    <WindowCell row={r.row} />
                  </dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="w-16 shrink-0 text-xs text-muted-foreground">
                    Price
                  </dt>
                  <dd>
                    <PriceCell row={r.row} />
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TripCell({ entry: { trip, row } }: { entry: VenueTripRow }) {
  const coverage = coverageLine(row);
  return (
    <div>
      <Link
        href={`/trips/${trip.id}/booking?venue=${row.locationId}`}
        className="font-medium link-quiet"
      >
        {trip.name}
      </Link>
      <span className="block text-xs text-muted-foreground">
        {formatTripDates(trip)}
        {coverage ? ` · ${coverage}` : ""}
        {row.isMissingTime ? " · missing times" : ""}
        {row.confirmationRef ? ` · ref ${row.confirmationRef}` : ""}
      </span>
    </div>
  );
}

function VenueStatus({
  entry: { trip, row },
  canEdit,
}: {
  entry: VenueTripRow;
  canEdit: boolean;
}) {
  return (
    <>
      <WorkflowControl
        target={{ tripId: trip.id, locationId: row.locationId }}
        progress={row.progress}
        canEdit={canEdit}
        showAge={!row.waiting}
      />
      <WaitingNote waiting={row.waiting} className="mt-1 block" />
    </>
  );
}

// Site-less one-off bookings (a coach, a label-only reservation) have no venue
// to group under, so they list per trip beneath the venues.
function OtherBookings({
  trips,
  canEdit,
}: {
  trips: TripItemBookings[];
  canEdit: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Other bookings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {trips.map(({ trip, itemRows }) => (
          <div key={trip.id} className="space-y-1">
            <p className="text-sm">
              <Link
                href={`/trips/${trip.id}/booking`}
                className="font-medium link-quiet"
              >
                {trip.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {" "}
                · {formatTripDates(trip)}
              </span>
            </p>
            <ul className="divide-y rounded-lg border">
              {itemRows.map((r) => (
                <li
                  key={r.bookingId}
                  className="flex items-start justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0 text-sm">
                    {r.label}
                    <span className="block text-xs text-muted-foreground">
                      Day {r.dayIndex}
                      {r.date ? ` · ${formatDate(r.date)}` : ""}
                      {r.contactName ? ` · ${r.contactName}` : ""}
                      {r.confirmationRef ? ` · ref ${r.confirmationRef}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <WorkflowControl
                      target={{ bookingId: r.bookingId }}
                      progress={r.progress}
                      canEdit={canEdit}
                      showAge={!r.waiting}
                    />
                    <WaitingNote waiting={r.waiting} className="mt-1 block" />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
