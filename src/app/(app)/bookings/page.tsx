import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import { cn } from "@/lib/utils";
import {
  crossTripScope,
  loadCrossTripBookings,
} from "@/lib/cross-trip-bookings.server";
import { CrossTripBookings } from "./cross-trip-bookings";

export const dynamic = "force-dynamic";

// Cross-trip booking dashboard: every venue engaged by the in-play trips, one
// card per venue with a row per trip, so a planner can email a site once about
// every group it's hosting.
export default async function CrossTripBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; past?: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { type, past } = await searchParams;
  const includePast = past === "1";

  const [tripTypes, data] = await Promise.all([
    // Only types with an in-scope trip get a chip.
    prisma.tripType.findMany({
      where: { trips: { some: crossTripScope(includePast) } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    loadCrossTripBookings({ tripTypeId: type || undefined, includePast }),
  ]);

  const qs = (params: { type?: string; past?: boolean }) => {
    const sp = new URLSearchParams();
    if (params.type) sp.set("type", params.type);
    if (params.past) sp.set("past", "1");
    const s = sp.toString();
    return s ? `/bookings?${s}` : "/bookings";
  };
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm",
      active ? "bg-muted font-medium" : "text-muted-foreground",
    );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Bookings</h1>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ past: includePast })} className={chip(!type)}>
          All types
        </Link>
        {tripTypes.map((tt) => (
          <Link
            key={tt.id}
            href={qs({ type: tt.id, past: includePast })}
            className={chip(type === tt.id)}
          >
            {tt.name}
          </Link>
        ))}
        <span className="ml-auto">
          <Link
            href={qs({ type, past: !includePast })}
            className="text-sm text-muted-foreground link-quiet"
          >
            {includePast ? "Hide past trips" : "Include past trips"}
          </Link>
        </span>
      </div>

      <CrossTripBookings
        groups={data.groups}
        itemBookings={data.itemBookings}
        canEdit={canEdit}
      />
    </div>
  );
}
