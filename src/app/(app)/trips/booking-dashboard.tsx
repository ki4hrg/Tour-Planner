"use client";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { VenueBookingRow, ItemBookingRow } from "@/lib/booking-dashboard";
import { VenueRow, ItemRow } from "./booking-row";

type ContactOption = { id: string; name: string };

export function BookingDashboard({
  tripId,
  canEdit,
  venueRows,
  itemRows,
  contacts,
}: {
  tripId: string;
  canEdit: boolean;
  venueRows: VenueBookingRow[];
  itemRows: ItemBookingRow[];
  contacts: ContactOption[];
}) {
  if (venueRows.length === 0 && itemRows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No venues yet. Add locations to the itinerary and they&apos;ll appear here
        to book.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Venue</TableHead>
          <TableHead>Window</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>Booked with</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {venueRows.map((row) => (
          <VenueRow
            key={row.locationId}
            row={row}
            tripId={tripId}
            canEdit={canEdit}
            contacts={contacts}
          />
        ))}
        {itemRows.map((row) => (
          <ItemRow key={row.bookingId} row={row} canEdit={canEdit} />
        ))}
      </TableBody>
    </Table>
  );
}
