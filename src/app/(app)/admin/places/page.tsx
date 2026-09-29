import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { placesEnabled } from "@/lib/google-places";
import { placeIdStaleBefore } from "@/lib/place-refresh";
import { todayUtc } from "@/lib/dates";
import { PlacesBackfill } from "./places-backfill";

export const dynamic = "force-dynamic";

export default async function GooglePlacesPage() {
  await requireRole("ADMIN");

  const staleBefore = placeIdStaleBefore(todayUtc());
  const [unlinked, linkedCount, dueCount] = await Promise.all([
    prisma.location.findMany({
      where: { googlePlaceId: null, archivedAt: null },
      // Places Google dropped on refresh first — they were linked once, so
      // someone cared about them.
      orderBy: [{ placeIdNeedsReview: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        address: true,
        lat: true,
        lng: true,
        placeIdNeedsReview: true,
        region: { select: { name: true } },
      },
    }),
    prisma.location.count({ where: { googlePlaceId: { not: null } } }),
    prisma.location.count({
      where: {
        googlePlaceId: { not: null },
        OR: [
          { placeIdCheckedAt: null },
          { placeIdCheckedAt: { lt: staleBefore } },
        ],
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Google places</h1>
        <p className="text-sm text-muted-foreground">
          Link locations to their Google Maps place so map links open the exact
          venue and the WordPress export carries a place ID and coordinates.
          Candidates are only suggestions; nothing is linked until you accept one.
        </p>
      </div>
      <PlacesBackfill
        enabled={placesEnabled()}
        linkedCount={linkedCount}
        dueCount={dueCount}
        locations={unlinked.map((l) => ({
          id: l.id,
          name: l.name,
          address: l.address,
          region: l.region?.name ?? null,
          hasCoords: l.lat != null && l.lng != null,
          needsReview: l.placeIdNeedsReview,
        }))}
      />
    </div>
  );
}
