import { prisma } from "@/lib/db";
import { verifyApiKey, keyCanReadTrip } from "@/lib/api-keys";
import { toDateInput } from "@/lib/dates";

// Reads the DB per request; never prerender (no DATABASE_URL at build time).
export const dynamic = "force-dynamic";

/**
 * GET /api/export/v1/trips
 *
 * List trips accessible to the API key, filtered by trip type and archive status.
 * Returns a JSON array of trip summaries.
 *
 * Query parameters:
 * - tripType: Filter by trip type ID or name (optional; comma-separated for multiple)
 * - includeArchived: Include ARCHIVED status trips (optional; default=0)
 *
 * Returns 200 with trip array, or 404 if key is invalid/revoked.
 */
export async function GET(req: Request) {
  const authHeader = (req.headers.get("Authorization") ?? undefined);

  const key = await verifyApiKey(authHeader);
  if (!key) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const tripTypeFilter = url.searchParams.get("tripType");
  const includeArchived = url.searchParams.get("includeArchived") === "1";

  // Build trip type filter: either by ID or by name.
  const tripTypeWhere = tripTypeFilter
    ? {
        OR: [
          { id: { in: tripTypeFilter.split(",").map((s) => s.trim()) } },
          { name: { in: tripTypeFilter.split(",").map((s) => s.trim()) } },
        ],
      }
    : undefined;

  // Query trips, excluding CANCELLED and optionally ARCHIVED.
  const excludedStatuses: ("CANCELLED" | "ARCHIVED")[] = includeArchived
    ? ["CANCELLED"]
    : ["CANCELLED", "ARCHIVED"];

  const trips = await prisma.trip.findMany({
    where: {
      isTemplate: false,
      status: { notIn: excludedStatuses },
      ...(tripTypeWhere && { tripType: tripTypeWhere }),
    },
    select: {
      id: true,
      name: true,
      tripTypeId: true,
      tripType: { select: { id: true, name: true } },
      startDate: true,
      endDate: true,
      status: true,
      updatedAt: true,
    },
    orderBy: { startDate: "asc" },
  });

  // Filter by key scope (trip type IDs).
  const accessible = await Promise.all(
    trips.map(async (t: typeof trips[0]) => ({
      trip: t,
      canRead: await keyCanReadTrip(key, t),
    })),
  );

  const result = accessible
    .filter((a) => a.canRead)
    .map((a) => ({
      id: a.trip.id,
      name: a.trip.name,
      tripType: {
        id: a.trip.tripType.id,
        name: a.trip.tripType.name,
      },
      startDate: toDateInput(a.trip.startDate),
      endDate: toDateInput(a.trip.endDate),
      status: a.trip.status,
      updatedAt: a.trip.updatedAt.toISOString(),
    }));

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-cache",
    },
  });
}
