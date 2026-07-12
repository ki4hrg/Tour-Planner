"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { VenueBookingRow, ItemBookingRow } from "@/lib/booking-dashboard";
import { isBookingSecured } from "@/lib/booking";
import { VenueRow, ItemRow, VenueCard, ItemCard } from "./booking-row";

type ContactOption = { id: string; name: string };

type Filters = {
  windowOpen: boolean;
  missingPrice: boolean;
  unconfirmed: boolean;
};

const FILTER_LABELS: { key: keyof Filters; label: string }[] = [
  { key: "windowOpen", label: "Window open" },
  { key: "missingPrice", label: "Missing price" },
  { key: "unconfirmed", label: "Unconfirmed" },
];

function venueMatches(row: VenueBookingRow, f: Filters): boolean {
  // Not-bookable sites and ones marked "not needed" are never actionable.
  if (!row.bookable || row.status === "NOT_NEEDED") return false;
  return (
    (f.windowOpen && row.open && !isBookingSecured(row.status)) ||
    (f.missingPrice && row.isMissingCost) ||
    (f.unconfirmed && !isBookingSecured(row.status))
  );
}

export function BookingDashboard({
  tripId,
  canEdit,
  venueRows,
  itemRows,
  contacts,
  currencies,
}: {
  tripId: string;
  canEdit: boolean;
  venueRows: VenueBookingRow[];
  itemRows: ItemBookingRow[];
  contacts: ContactOption[];
  // The trip's currency vocabulary (GH #11) — price/payment pickers offer these.
  currencies: string[];
}) {
  const [filters, setFilters] = useState<Filters>({
    windowOpen: true,
    missingPrice: true,
    unconfirmed: true,
  });
  const anyFilter = filters.windowOpen || filters.missingPrice || filters.unconfirmed;

  // No filter checked = show everything; otherwise show rows matching any filter.
  const shownVenues = anyFilter
    ? venueRows.filter((r) => venueMatches(r, filters))
    : venueRows;
  const shownItems = anyFilter
    ? itemRows.filter((r) => filters.unconfirmed && !isBookingSecured(r.status))
    : itemRows;

  const total = venueRows.length + itemRows.length;
  const shown = shownVenues.length + shownItems.length;

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No venues yet. Add locations to the itinerary and they&apos;ll appear here
        to book.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
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
        <span className="ml-auto text-xs text-muted-foreground">
          {anyFilter
            ? `${shown} of ${total} shown`
            : `All ${total} venues`}
        </span>
      </div>

      {shown === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing matches these filters — everything&apos;s handled.
        </p>
      ) : (
        <>
          {/* Desktop: the table. Below sm it doesn't stack, so cards take over. */}
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Venue</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Point of Contact</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownVenues.map((row) => (
                  <VenueRow
                    key={row.locationId}
                    row={row}
                    tripId={tripId}
                    canEdit={canEdit}
                    contacts={contacts}
                    currencies={currencies}
                  />
                ))}
                {shownItems.map((row) => (
                  <ItemRow key={row.bookingId} row={row} canEdit={canEdit} />
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2 sm:hidden">
            {shownVenues.map((row) => (
              <VenueCard
                key={row.locationId}
                row={row}
                tripId={tripId}
                canEdit={canEdit}
                contacts={contacts}
                currencies={currencies}
              />
            ))}
            {shownItems.map((row) => (
              <ItemCard key={row.bookingId} row={row} canEdit={canEdit} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
