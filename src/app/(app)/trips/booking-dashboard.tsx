"use client";

import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { VenueBookingRow, ItemBookingRow } from "@/lib/booking-dashboard";
import type { SerializedDocument } from "@/lib/documents";
import { isBookingSecured } from "@/lib/booking";
import { VenueRow, ItemRow, VenueCard, ItemCard } from "./booking-row";

type ContactOption = { id: string; name: string };

type Filters = {
  windowOpen: boolean;
  missingPrice: boolean;
  unconfirmed: boolean;
  paymentOverdue: boolean;
};

const FILTER_LABELS: { key: keyof Filters; label: string }[] = [
  { key: "windowOpen", label: "Window open" },
  { key: "missingPrice", label: "Missing price" },
  { key: "unconfirmed", label: "Unconfirmed" },
  { key: "paymentOverdue", label: "Payment overdue" },
];

function venueMatches(row: VenueBookingRow, f: Filters): boolean {
  // Not-bookable sites and ones marked "not needed" are never actionable.
  if (!row.bookable || row.status === "NOT_NEEDED") return false;
  return (
    (f.windowOpen && row.open && !isBookingSecured(row.status)) ||
    (f.missingPrice && row.isMissingCost) ||
    (f.unconfirmed && !isBookingSecured(row.status)) ||
    (f.paymentOverdue && row.overdueAmount > 0)
  );
}

export function BookingDashboard({
  tripId,
  canEdit,
  venueRows,
  itemRows,
  contacts,
  currencies,
  documentsByBooking,
  focusLocationId = null,
}: {
  tripId: string;
  canEdit: boolean;
  venueRows: VenueBookingRow[];
  itemRows: ItemBookingRow[];
  contacts: ContactOption[];
  // The trip's currency vocabulary (GH #11) — price/payment pickers offer these.
  currencies: string[];
  // Files filed against each booking, keyed by booking id. A venue with no
  // engagement yet has no id and so no files — it gets an empty list.
  documentsByBooking: Record<string, SerializedDocument[]>;
  // Deep link (`?venue=<locationId>`) from the trip page: start with every row
  // visible and that venue expanded + scrolled into view.
  focusLocationId?: string | null;
}) {
  const docsFor = (bookingId: string | null) =>
    (bookingId && documentsByBooking[bookingId]) || [];
  const focused = focusLocationId != null &&
    venueRows.some((r) => r.locationId === focusLocationId);
  const [filters, setFilters] = useState<Filters>({
    windowOpen: !focused,
    missingPrice: !focused,
    unconfirmed: !focused,
    paymentOverdue: !focused,
  });

  useEffect(() => {
    if (!focused) return;
    // Table on desktop, card below sm — scroll whichever one is visible.
    const el = [
      document.getElementById(`venue-${focusLocationId}`),
      document.getElementById(`venue-card-${focusLocationId}`),
    ].find((e) => e && e.offsetParent !== null);
    el?.scrollIntoView({ block: "start" });
  }, [focused, focusLocationId]);
  const anyFilter = Object.values(filters).some(Boolean);

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
                    documents={docsFor(row.bookingId)}
                    defaultOpen={row.locationId === focusLocationId}
                  />
                ))}
                {shownItems.map((row) => (
                  <ItemRow
                    key={row.bookingId}
                    row={row}
                    canEdit={canEdit}
                    documents={docsFor(row.bookingId)}
                  />
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
                documents={docsFor(row.bookingId)}
                defaultOpen={row.locationId === focusLocationId}
              />
            ))}
            {shownItems.map((row) => (
              <ItemCard
                key={row.bookingId}
                row={row}
                canEdit={canEdit}
                documents={docsFor(row.bookingId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
