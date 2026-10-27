// "Booked via" parent venues: a child Location (`bookedViaId`) still shows as
// itself on itineraries, share pages, feeds and the WP export, but
// administratively it is covered by its PARENT's (trip, parent) venue
// engagement — e.g. a museum whose one booking covers several sites nearby.
//
// Single level only: a parent has no parent of its own, and a location is
// never its own parent (DB CHECK location_booked_via_not_self). This module is
// the ONE place that maps a site to the location its engagement lives on;
// every engagement read/create resolves through it.
//
// Pure (no Prisma client) — the DB-aware wrappers live in booked-via.server.ts.

import type { Prisma } from "@prisma/client";

export type BookedViaRef = { id: string; bookedViaId?: string | null };

/** child id → parent id, for every location in `locations` that has a parent. */
export function bookedViaMap(locations: Iterable<BookedViaRef>): Map<string, string> {
  const map = new Map<string, string>();
  for (const l of locations) {
    if (l.bookedViaId && l.bookedViaId !== l.id) map.set(l.id, l.bookedViaId);
  }
  return map;
}

/** The location whose (trip, location) engagement covers `locationId`. */
export function engagementLocationId(
  locationId: string,
  map: ReadonlyMap<string, string>,
): string {
  return map.get(locationId) ?? locationId;
}

/**
 * Prisma `where` for a set of locations PLUS the parents they're booked via —
 * so a caller that loads "every location the trip touches" also gets the
 * parent rows its engagements live on, in the same single query.
 */
export function withBookedViaParentsWhere(
  ids: string[],
): Prisma.LocationWhereInput {
  return {
    OR: [{ id: { in: ids } }, { coveredSites: { some: { id: { in: ids } } } }],
  };
}

export type BookedViaCheck = {
  locationId: string | null; // null when the location is being created
  parentId: string;
  // The location already covers other sites (it is a parent itself).
  hasCoveredSites: boolean;
  parent: {
    name: string;
    bookedViaId: string | null;
    bookedViaName?: string | null;
    bookable: boolean;
  } | null;
};

/** Error message when `parentId` can't be this location's "booked via", else null. */
export function bookedViaError(c: BookedViaCheck): string | null {
  if (c.locationId && c.parentId === c.locationId) {
    return "A location can't be booked via itself.";
  }
  if (!c.parent) return "Booked-via location not found.";
  if (c.hasCoveredSites) {
    return "This location covers other sites, so it can't be booked via another.";
  }
  if (c.parent.bookedViaId) {
    return `${c.parent.name} is itself booked via ${c.parent.bookedViaName ?? "another location"}.`;
  }
  if (!c.parent.bookable) return `${c.parent.name} is marked not bookable.`;
  return null;
}

export type MergeBookedViaInput = {
  sourceId: string;
  targetId: string;
  sourceBookedViaId: string | null;
  targetBookedViaId: string | null;
  sourceHasCoveredSites: boolean; // excluding the target itself
  targetHasCoveredSites: boolean; // excluding the source itself
};

/**
 * How a location merge treats the booked-via link. Children of the source
 * repoint to the target (so the target becomes their parent); the source's own
 * parent fills the target's when the target has none. Single-level and not-self
 * rules hold on the result, or the merge is refused with a message.
 */
export function mergeBookedVia(
  m: MergeBookedViaInput,
): { error: string } | { targetBookedViaId: string | null } {
  // A parent pointing at the other half of the pair disappears with the merge.
  const targetOwn =
    m.targetBookedViaId === m.sourceId ? null : m.targetBookedViaId;
  const sourceOwn =
    m.sourceBookedViaId === m.targetId ? null : m.sourceBookedViaId;
  const targetWillCover = m.targetHasCoveredSites || m.sourceHasCoveredSites;
  if (targetOwn && m.sourceHasCoveredSites) {
    return {
      error:
        "The location being merged away covers other sites, but the kept one is itself booked via another.",
    };
  }
  const parent = targetOwn ?? (targetWillCover ? null : sourceOwn);
  return { targetBookedViaId: parent };
}
