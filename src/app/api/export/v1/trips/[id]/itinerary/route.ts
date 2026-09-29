import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { verifyApiKey, keyCanReadTrip } from "@/lib/api-keys";
import { buildExportPayload } from "@/lib/itinerary-export";
import { TRAVEL_LEG_INCLUDE } from "@/lib/trips";

// Reads the DB per request; never prerender (no DATABASE_URL at build time).
export const dynamic = "force-dynamic";

// Common location select across the query.
const LOCATION_SELECT = {
  id: true,
  name: true,
  regionId: true,
  address: true,
  description: true,
  website: true,
  mapUrl: true,
  googlePlaceId: true,
  lat: true,
  lng: true,
  archivedAt: true,
  updatedAt: true,
  hostSite: {
    select: {
      providesLodging: true,
    },
  },
} as const;

// The include tree for querying the trip itinerary structure.
const TRIP_INCLUDE = {
  tripType: { select: { id: true } },
  days: {
    orderBy: { dayIndex: "asc" as const },
    include: {
      scheduleItems: {
        orderBy: { order: "asc" as const },
        include: {
          category: { select: { name: true } },
          travel: TRAVEL_LEG_INCLUDE,
          sites: {
            orderBy: { order: "asc" as const },
            include: {
              location: { select: LOCATION_SELECT },
            },
          },
        },
      },
      plannedLocations: {
        orderBy: { order: "asc" as const },
        include: {
          location: { select: LOCATION_SELECT },
        },
      },
    },
  },
  stays: {
    orderBy: [{ priority: "desc" as const }, { checkIn: "asc" as const }],
    select: {
      checkIn: true,
      checkOut: true,
      checkInDayIndex: true,
      checkOutDayIndex: true,
      priority: true,
      locationId: true,
    },
  },
};

/**
 * GET /api/export/v1/trips/[id]/itinerary
 *
 * Get the full itinerary for a trip, including schedule, lodging, locations,
 * and region hierarchy. Returns a deterministic JSON payload suitable for
 * caching (ETag support).
 *
 * Returns 200 with itinerary payload, 304 if unchanged (ETag), or 404 if
 * key is invalid/revoked/out-of-scope or trip not found.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authHeader = req.headers.get("Authorization") ?? undefined;
  const key = await verifyApiKey(authHeader);
  if (!key) {
    return new Response("Not found", { status: 404 });
  }

  const { id } = await params;

  // Look up the trip with its full itinerary.
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: TRIP_INCLUDE,
  });

  if (!trip) {
    return new Response("Not found", { status: 404 });
  }

  // Check key scope.
  const canRead = await keyCanReadTrip(key, trip);
  if (!canRead) {
    return new Response("Not found", { status: 404 });
  }

  // Gather all unique locations (from stays, schedule items, and planned).
  const locationIds = new Set<string>();
  for (const stay of trip.stays) {
    locationIds.add(stay.locationId);
  }
  for (const day of trip.days) {
    if (day.primaryLocationId) locationIds.add(day.primaryLocationId);
    for (const item of day.scheduleItems) {
      for (const site of item.sites) {
        locationIds.add(site.location.id);
      }
    }
    for (const pl of day.plannedLocations) {
      locationIds.add(pl.location.id);
    }
  }

  // Query locations separately to get all fields (the include above only gets sites).
  const locations = await prisma.location.findMany({
    where: { id: { in: Array.from(locationIds) } },
    select: {
      id: true,
      name: true,
      regionId: true,
      address: true,
      description: true,
      website: true,
      mapUrl: true,
      googlePlaceId: true,
      lat: true,
      lng: true,
      archivedAt: true,
      updatedAt: true,
      hostSite: {
        select: {
          providesLodging: true,
        },
      },
    },
  });

  // Gather all unique region IDs and query them.
  const regionIds = new Set<string>();
  for (const loc of locations) {
    if (loc.regionId) regionIds.add(loc.regionId);
  }
  for (const day of trip.days) {
    if (day.cityRegionId) regionIds.add(day.cityRegionId);
  }

  // Recursively gather parent regions.
  const allRegionIds = new Set<string>(regionIds);
  const toProcess = Array.from(regionIds);
  while (toProcess.length > 0) {
    const batch = toProcess.splice(0, 100);
    const parentRegions = await prisma.region.findMany({
      where: { id: { in: batch } },
      select: { parentId: true },
    });
    for (const r of parentRegions) {
      if (r.parentId && !allRegionIds.has(r.parentId)) {
        allRegionIds.add(r.parentId);
        toProcess.push(r.parentId);
      }
    }
  }

  const regions = await prisma.region.findMany({
    where: { id: { in: Array.from(allRegionIds) } },
    select: {
      id: true,
      name: true,
      parentId: true,
    },
  });

  // Build the export payload.
  const payload = buildExportPayload(trip, trip.days, trip.stays, locations, regions);

  // Compute ETag from JSON body (no generatedAt field).
  const bodyJson = JSON.stringify(payload);
  const etag = `"sha256:${createHash("sha256").update(bodyJson).digest("hex")}"`;

  // Check If-None-Match.
  const ifNoneMatch = req.headers.get("If-None-Match");
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304 });
  }

  return new Response(bodyJson, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-cache",
      ETag: etag,
    },
  });
}
