"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { BookingProgressView } from "@/lib/booking-workflow";
import { CompactProgress } from "../trips/booking-progress";

// One row per trip that touches this venue right now or soon: the engagement's
// one-click booking status, what the trip runs here, and a jump to today.
export type LocationTripRow = {
  tripId: string;
  tripName: string;
  dates: string; // preformatted "Mon, 6 Jul 2026 – …" (server-side, Date-free)
  ongoing: boolean;
  booking: BookingProgressView; // this venue's engagement on the trip
  sessionCount: number;
  plannedCount: number; // rough-plan day assignments with no set time
  hasLodging: boolean;
};

export function LocationTripsPanel({
  locationId,
  rows,
  canEdit,
  bookable,
}: {
  locationId: string;
  rows: LocationTripRow[];
  canEdit: boolean;
  bookable: boolean;
}) {
  return (
    <ul className="divide-y">
      {rows.map((r) => {
        const coverage = [
          r.sessionCount
            ? `${r.sessionCount} session${r.sessionCount === 1 ? "" : "s"}`
            : null,
          r.plannedCount ? `${r.plannedCount} planned` : null,
          r.hasLodging ? "lodging" : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={r.tripId} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <Link
                  href={`/trips/${r.tripId}`}
                  className="font-medium hover:underline"
                >
                  {r.tripName}
                </Link>
                {r.ongoing ? (
                  <Badge className="ml-2 align-middle">Now</Badge>
                ) : null}
              </span>
              {r.ongoing ? (
                <Link
                  href={`/trips/${r.tripId}/today`}
                  className="shrink-0 text-xs text-muted-foreground link-quiet"
                >
                  Today
                </Link>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {r.dates}
              {coverage ? ` · ${coverage}` : ""}
            </p>
            {bookable ? (
              <CompactProgress
                target={{ tripId: r.tripId, locationId }}
                progress={r.booking}
                showAge
                canEdit={canEdit}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
