// Pure export builder for the WP plugin API.
// Takes structured trip/itinerary data and produces a deterministic JSON payload.

import type { MealKind, TripStatus } from "@prisma/client";
import { toDateInput } from "@/lib/dates";
import {
  lodgingForDays,
} from "@/lib/stays";
import { regionPath } from "@/lib/regions";
import { mapHref } from "@/lib/maps";

export interface ExportPayload {
  schemaVersion: 1;
  trip: ExportTrip;
  days: ExportDay[];
  locations: Record<string, ExportLocation>;
  regions: Record<string, ExportRegion>;
}

export interface ExportTrip {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: TripStatus;
  isTemplate: boolean;
  updatedAt: string;
}

export interface ExportDay {
  id: string;
  dayIndex: number;
  date: string | null;
  title: string | null;
  participantNotes: string | null;
  cityRegionId: string | null;
  stops: ExportStop[];
  overnight: ExportOvernight | null;
}

export interface ExportStop {
  locationId: string;
  source: "schedule" | "planned";
  startTime: string | null;
  endTime: string | null;
  category: string | null;
  itemTitle: string | null; // Non-null when differs from location name
}

export type ExportOvernight = {
  locationId: string;
};

export interface ExportLocation {
  id: string;
  name: string;
  regionId: string | null;
  address: string | null;
  description: string | null;
  website: string | null;
  mapHref: string | null;
  placeId: string | null; // Google place ID
  lat: number | null; // WGS84; both-or-neither with lng
  lng: number | null;
  providesLodging: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface ExportRegion {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
}

type LocationRow = {
  id: string;
  name: string;
  regionId: string | null;
  address: string | null;
  description: string | null;
  website: string | null;
  mapUrl: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  archivedAt: Date | null;
  updatedAt: Date;
  hostSite?: {
    providesLodging: boolean;
  } | null;
};

type RegionRow = {
  id: string;
  name: string;
  parentId: string | null;
};

type DayRow = {
  id: string;
  dayIndex: number;
  date: Date | null;
  title: string | null;
  participantNotes: string | null;
  primaryLocationId: string | null;
  cityRegionId: string | null; // explicit primary city; wins over derivation
};

type ScheduleItemRow = {
  order: number;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  category: { name: string } | null;
  // Set ⇒ the item is a meal (optional so older callers stay valid).
  mealKind?: MealKind | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  travel: any; // TravelLeg or null; complex union with nested relations
  sites: Array<{ order: number; location: LocationRow }>;
};

type PlannedLocationRow = {
  id: string;
  locationId: string;
  location: LocationRow;
};

type StayRow = {
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDayIndex: number | null;
  checkOutDayIndex: number | null;
  priority: number;
  locationId: string;
};

/**
 * Build the export payload from structured trip and itinerary data.
 * Redacts internal fields (notes, contacts, etc.), dedupes stops, and
 * builds deterministic output.
 */
export function buildExportPayload(
  trip: {
    id: string;
    name: string;
    startDate: Date | null;
    endDate: Date | null;
    status: TripStatus;
    isTemplate: boolean;
    updatedAt: Date;
    tripType: { id: string };
  },
  days: Array<
    DayRow & {
      scheduleItems: ScheduleItemRow[];
      plannedLocations: PlannedLocationRow[];
    }
  >,
  stays: StayRow[],
  locations: LocationRow[],
  regions: RegionRow[],
): ExportPayload {
  const locationMap = new Map(locations.map((l) => [l.id, l]));
  const regionMap = new Map(regions.map((r) => [r.id, r]));

  // Build the regions dict with ancestor paths.
  const exportedRegions: Record<string, ExportRegion> = {};

  // Helper to recursively ensure region and ancestors are in exportedRegions.
  function ensureRegion(regionId: string | null) {
    if (!regionId || exportedRegions[regionId]) return;
    const region = regionMap.get(regionId);
    if (!region) return;

    // Ensure parent first (depth-first).
    if (region.parentId) ensureRegion(region.parentId);

    const regionsByIdForPath = new Map(regions.map((r) => [r.id, r]));
    exportedRegions[regionId] = {
      id: region.id,
      name: region.name,
      parentId: region.parentId ?? null,
      path: regionPath(region, regionsByIdForPath),
    };
  }

  // Resolve overnight lodging per day.
  const overnightMap = lodgingForDays(days, stays);

  // Build export days.
  const exportDays: ExportDay[] = days.map((day) => {
    // Collect stops from schedule items, skip travel legs.
    const stops: ExportStop[] = [];
    const seenLocationIds = new Set<string>();
    // Stops that so far only came from a meal at the venue: a later visit
    // there takes the stop over (same position), so "lunch, then the museum"
    // exports the museum visit rather than the lunch — the guidebook may
    // filter meals out, which would otherwise drop the venue from the day.
    const mealOnly = new Map<string, ExportStop>();

    // Process schedule items (preserving order).
    for (const item of day.scheduleItems) {
      // Skip travel legs (they have a travel property).
      if (item.travel) continue;

      // Process sites within this item (by order).
      const isMeal = item.mealKind != null;
      for (const site of item.sites) {
        const locationId = site.location.id;
        const itemTitle =
          item.title && item.title !== site.location.name ? item.title : null;
        const fields = {
          startTime: item.startTime,
          endTime: item.endTime,
          category: item.category?.name ?? null,
          itemTitle,
        };
        if (!seenLocationIds.has(locationId)) {
          seenLocationIds.add(locationId);
          const stop: ExportStop = { locationId, source: "schedule", ...fields };
          stops.push(stop);
          if (isMeal) mealOnly.set(locationId, stop);
        } else if (!isMeal && mealOnly.has(locationId)) {
          Object.assign(mealOnly.get(locationId)!, fields);
          mealOnly.delete(locationId);
        }
      }
    }

    // Append planned locations not already in stops.
    for (const pl of day.plannedLocations) {
      if (!seenLocationIds.has(pl.locationId)) {
        seenLocationIds.add(pl.locationId);
        stops.push({
          locationId: pl.locationId,
          source: "planned",
          startTime: null,
          endTime: null,
          category: null,
          itemTitle: null,
        });
      }
    }

    // Determine cityRegionId: the planner-set city → primaryLocation region →
    // overnight location region → first stop's location region → null. An
    // explicit city pointing at a region we didn't load falls through.
    let cityRegionId: string | null =
      day.cityRegionId && regionMap.has(day.cityRegionId)
        ? day.cityRegionId
        : null;
    if (!cityRegionId && day.primaryLocationId) {
      const primaryLoc = locationMap.get(day.primaryLocationId);
      if (primaryLoc?.regionId) cityRegionId = primaryLoc.regionId;
    }
    if (!cityRegionId) {
      const overnight = overnightMap.get(day.id);
      if (overnight) {
        const overnightLoc = locationMap.get(overnight.locationId);
        if (overnightLoc?.regionId) cityRegionId = overnightLoc.regionId;
      }
    }
    if (!cityRegionId && stops.length > 0) {
      const firstStopLoc = locationMap.get(stops[0].locationId);
      if (firstStopLoc?.regionId) cityRegionId = firstStopLoc.regionId;
    }

    // Ensure city region is included.
    if (cityRegionId) ensureRegion(cityRegionId);

    // Resolve overnight.
    const overnight = overnightMap.get(day.id);
    if (overnight) ensureRegion(locationMap.get(overnight.locationId)?.regionId ?? null);

    // Ensure all stop locations and their regions are included.
    for (const stop of stops) {
      const loc = locationMap.get(stop.locationId);
      if (loc?.regionId) ensureRegion(loc.regionId);
    }

    return {
      id: day.id,
      dayIndex: day.dayIndex,
      date: day.date ? toDateInput(day.date) : null,
      title: day.title,
      participantNotes: day.participantNotes,
      cityRegionId,
      stops,
      overnight: overnight ? { locationId: overnight.locationId } : null,
    };
  });

  // Build export locations (every location referenced by stops/overnights/primary).
  const exportedLocationIds = new Set<string>();
  for (const day of days) {
    if (day.primaryLocationId && locationMap.has(day.primaryLocationId))
      exportedLocationIds.add(day.primaryLocationId);
  }
  for (const day of exportDays) {
    if (day.overnight) exportedLocationIds.add(day.overnight.locationId);
    for (const stop of day.stops) {
      exportedLocationIds.add(stop.locationId);
    }
  }

  const exportedLocations: Record<string, ExportLocation> = {};
  for (const locId of exportedLocationIds) {
    const loc = locationMap.get(locId);
    if (loc) {
      exportedLocations[loc.id] = {
        id: loc.id,
        name: loc.name,
        regionId: loc.regionId,
        address: loc.address,
        description: loc.description,
        website: loc.website,
        mapHref: mapHref(loc),
        placeId: loc.googlePlaceId,
        // Both-or-neither, even if a row somehow holds just one.
        lat: loc.lat != null && loc.lng != null ? loc.lat : null,
        lng: loc.lat != null && loc.lng != null ? loc.lng : null,
        providesLodging: loc.hostSite?.providesLodging ?? false,
        archived: loc.archivedAt != null,
        updatedAt: loc.updatedAt.toISOString(),
      };
      // Ensure region hierarchy.
      if (loc.regionId) ensureRegion(loc.regionId);
    }
  }

  return {
    schemaVersion: 1,
    trip: {
      id: trip.id,
      name: trip.name,
      startDate: trip.startDate ? toDateInput(trip.startDate) : null,
      endDate: trip.endDate ? toDateInput(trip.endDate) : null,
      status: trip.status,
      isTemplate: trip.isTemplate,
      updatedAt: trip.updatedAt.toISOString(),
    },
    days: exportDays,
    locations: exportedLocations,
    regions: exportedRegions,
  };
}
