"use client";

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
import type { VenueBookingRow } from "@/lib/booking-dashboard";
import { setVenueBookingStatus } from "./actions";
import { StatusControl } from "./status-control";

export type YearColumn = { tripId: string; year: string; name: string };
export type VenueLine = {
  locationId: string;
  name: string;
  byTrip: Record<string, VenueBookingRow | null>;
};

// One year's cell for a venue: the inline status control + a compact window hint.
function Cell({
  row,
  tripId,
  canEdit,
}: {
  row: VenueBookingRow | null;
  tripId: string;
  canEdit: boolean;
}) {
  if (!row) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (!row.bookable) {
    return (
      <span className="text-xs italic text-muted-foreground">No booking</span>
    );
  }
  return (
    <div className={cn("space-y-1", row.needsInfo && "rounded p-1")}>
      <StatusControl
        status={row.status}
        canEdit={canEdit}
        onSet={(status) => setVenueBookingStatus(tripId, row.locationId, status)}
      />
      <div className="text-[11px] text-muted-foreground">
        {row.status === "CONFIRMED"
          ? "Booked"
          : row.status === "NOT_NEEDED" || row.earliest == null
            ? "—"
            : row.open
              ? "Open now"
              : `Opens ${formatDate(row.earliest)}`}
      </div>
    </div>
  );
}

export function MultiYearGrid({
  columns,
  venues,
  canEdit,
}: {
  columns: YearColumn[];
  venues: VenueLine[];
  canEdit: boolean;
}) {
  if (venues.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No venues across these trips yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-40">Venue</TableHead>
            {columns.map((c) => (
              <TableHead key={c.tripId} className="min-w-32">
                {c.year}
                <span className="block text-xs font-normal text-muted-foreground">
                  {c.name}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {venues.map((v) => (
            <TableRow key={v.locationId}>
              <TableCell className="font-medium align-top">{v.name}</TableCell>
              {columns.map((c) => (
                <TableCell
                  key={c.tripId}
                  className={cn(
                    "align-top",
                    v.byTrip[c.tripId]?.needsInfo &&
                      "bg-amber-50 dark:bg-amber-950/40",
                  )}
                >
                  <Cell
                    row={v.byTrip[c.tripId] ?? null}
                    tripId={c.tripId}
                    canEdit={canEdit}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
