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
import { formatMoney } from "@/lib/money";
import { isBookingSecured } from "@/lib/booking";
import type { VenueBookingRow } from "@/lib/booking-dashboard";
import { WorkflowControl } from "./workflow-control";

export type YearColumn = { tripId: string; year: string; name: string };
export type VenueLine = {
  locationId: string;
  name: string;
  byTrip: Record<string, VenueBookingRow | null>;
};

// Compact per-cell money state (GH #86 part C) so cross-year settled/outstanding
// reads at a glance: overdue beats outstanding beats settled. Null when there's
// no agreed price to reason about.
function MoneyLine({ row }: { row: VenueBookingRow }) {
  if (row.overdueAmount > 0)
    return (
      <div className="text-[11px] font-medium text-red-600 dark:text-red-400">
        {formatMoney(row.overdueAmount, row.agreedCurrency)} overdue
      </div>
    );
  if (row.agreedTotal == null) return null;
  if (row.settled)
    return (
      <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
        settled
      </div>
    );
  if (row.unpaidBalance != null && row.unpaidBalance > 0)
    return (
      <div className="text-[11px] text-amber-700 dark:text-amber-300">
        {formatMoney(row.unpaidBalance, row.agreedCurrency)} left
      </div>
    );
  return null;
}

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
      <WorkflowControl
        target={{ tripId, locationId: row.locationId }}
        progress={row.progress}
        canEdit={canEdit}
        showAge={false}
      />
      <div className="text-[11px] text-muted-foreground">
        {isBookingSecured(row.status)
          ? "Booked"
          : row.status === "NOT_NEEDED" || row.earliest == null
            ? "—"
            : row.open
              ? "Open now"
              : `Opens ${formatDate(row.earliest)}`}
      </div>
      <MoneyLine row={row} />
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
        No venues.
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
