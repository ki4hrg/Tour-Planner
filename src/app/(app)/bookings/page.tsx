import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import type { BookingStatus } from "@prisma/client";
import { FilterChip } from "@/components/filter-chip";
import { BookingStatusChips } from "@/components/booking-status-chips";
import { countByStatus, parseBookingStatuses } from "@/lib/trips";
import {
  crossTripStatusRows,
  filterGroupsByStatus,
  filterItemBookingsByStatus,
} from "@/lib/cross-trip-bookings";
import {
  crossTripScope,
  loadCrossTripBookings,
} from "@/lib/cross-trip-bookings.server";
import { CrossTripBookings } from "./cross-trip-bookings";

export const dynamic = "force-dynamic";

// Cross-trip booking dashboard: every venue engaged by the in-play trips, one
// card per venue with a row per trip, so a planner can email a site once about
// every group it's hosting. `?status=` narrows it to master statuses ("every
// visit in progress"), whatever workflow stage each one is at.
export default async function CrossTripBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; past?: string; status?: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { type, past, status } = await searchParams;
  const includePast = past === "1";
  const statuses = parseBookingStatuses(status);

  const [tripTypes, data] = await Promise.all([
    // Only types with an in-scope trip get a chip.
    prisma.tripType.findMany({
      where: { trips: { some: crossTripScope(includePast) } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    loadCrossTripBookings({ tripTypeId: type || undefined, includePast }),
  ]);

  const qs = (params: {
    type?: string;
    past?: boolean;
    statuses?: BookingStatus[];
  }) => {
    const sp = new URLSearchParams();
    if (params.type) sp.set("type", params.type);
    if (params.past) sp.set("past", "1");
    if (params.statuses?.length) sp.set("status", params.statuses.join(","));
    const s = sp.toString();
    return s ? `/bookings?${s}` : "/bookings";
  };
  const counts = countByStatus(crossTripStatusRows(data.groups, data.itemBookings));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Bookings</h1>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip href={qs({ past: includePast, statuses })} active={!type}>
          All types
        </FilterChip>
        {tripTypes.map((tt) => (
          <FilterChip
            key={tt.id}
            href={qs({ type: tt.id, past: includePast, statuses })}
            active={type === tt.id}
          >
            {tt.name}
          </FilterChip>
        ))}
        <span className="ml-auto">
          <Link
            href={qs({ type, past: !includePast, statuses })}
            className="text-sm text-muted-foreground link-quiet"
          >
            {includePast ? "Hide past trips" : "Include past trips"}
          </Link>
        </span>
      </div>

      <BookingStatusChips
        counts={counts}
        selected={statuses}
        hrefFor={(next) => qs({ type, past: includePast, statuses: next })}
      />

      <CrossTripBookings
        // Remount on a status change so the attention filters reset with it.
        key={statuses.join(",")}
        groups={filterGroupsByStatus(data.groups, statuses)}
        itemBookings={filterItemBookingsByStatus(data.itemBookings, statuses)}
        statusFiltered={statuses.length > 0}
        canEdit={canEdit}
      />
    </div>
  );
}
