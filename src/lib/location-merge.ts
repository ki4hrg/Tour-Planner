// Merge a duplicate Location (the SOURCE) into the one being kept (the TARGET).
// Every reference to the source is repointed at the target, then the source is
// deleted — all in one transaction. The target's own values win; the source only
// fills gaps (see the pure `merge*Fields` rules below, unit-tested).
//
// Collisions the unique constraints would reject are resolved, not failed:
// - ScheduleItemSite (item, location) / ItineraryDayLocation (day, location):
//   an item/day that already visits the target just drops the source row.
// - Booking (trip, location): when both venues were engaged on the same trip the
//   two engagements fold into the target's — payments, notes and documents move
//   over, scalar gaps fill from the source, the status keeps the further-along
//   of the two, and the source's installment schedule is adopted only when the
//   target has none.
// - HostSite (1:1): capability flags OR together, notes fill/concatenate.
// - Standing payment terms: adopted only when the target has none.
//
// No revalidatePath here — MCP-safe; web callers revalidate themselves.

import type { BookingStatus, Prisma } from "@prisma/client";
import { BOOKING_STATUS_RANK } from "./booking-workflow";
import { recomputeBooking } from "./booking-workflow-sync";
import { prisma } from "@/lib/db";
import { mergeBookedVia } from "./booked-via";

// Join two free-text fields: keep both when they differ, never duplicate.
export function joinText(
  target: string | null,
  source: string | null,
): string | null {
  const a = target?.trim() || null;
  const b = source?.trim() || null;
  if (!a) return b;
  if (!b || a === b || a.includes(b)) return a;
  return `${a}\n\n${b}`;
}

export type MergeableLocationFields = {
  regionId: string | null;
  address: string | null;
  description: string | null;
  notes: string | null;
  website: string | null;
  mapUrl: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  placeIdCheckedAt: Date | null;
  placeIdNeedsReview: boolean;
  bookable: boolean;
  bookingOpensLeadDays: number | null;
  bookingNotes: string | null;
  scheduleLimitations: string | null;
  primaryContactId: string | null;
  archivedAt: Date | null;
};

// Target wins; the source fills gaps. Long-form text concatenates so nothing
// written about the duplicate is lost. The merged record is live if either was.
// The Google place link travels as a unit (ID + its check date + review flag),
// and so do the coordinates (DB CHECK location_coordinates: both or neither).
export function mergeLocationFields(
  target: MergeableLocationFields,
  source: MergeableLocationFields,
): MergeableLocationFields {
  const place = target.googlePlaceId
    ? target
    : source.googlePlaceId
      ? source
      : null;
  const coords = target.lat != null && target.lng != null ? target : source;
  return {
    regionId: target.regionId ?? source.regionId,
    address: target.address || source.address,
    description: joinText(target.description, source.description),
    notes: joinText(target.notes, source.notes),
    website: target.website || source.website,
    mapUrl: target.mapUrl || source.mapUrl,
    googlePlaceId: place?.googlePlaceId ?? null,
    placeIdCheckedAt: place
      ? place.placeIdCheckedAt
      : (target.placeIdCheckedAt ?? source.placeIdCheckedAt),
    // Neither side linked: an open "re-link by hand" flag on either survives.
    placeIdNeedsReview: place
      ? place.placeIdNeedsReview
      : target.placeIdNeedsReview || source.placeIdNeedsReview,
    lat: coords.lat != null && coords.lng != null ? coords.lat : null,
    lng: coords.lat != null && coords.lng != null ? coords.lng : null,
    bookable: target.bookable || source.bookable,
    bookingOpensLeadDays:
      target.bookingOpensLeadDays ?? source.bookingOpensLeadDays,
    bookingNotes: joinText(target.bookingNotes, source.bookingNotes),
    scheduleLimitations: joinText(
      target.scheduleLimitations,
      source.scheduleLimitations,
    ),
    primaryContactId: target.primaryContactId ?? source.primaryContactId,
    archivedAt:
      target.archivedAt && source.archivedAt ? target.archivedAt : null,
  };
}

// How far along an engagement is (BOOKING_STATUS_RANK); NOT_NEEDED ranks
// lowest so a real booking on either side always survives the merge. A workflow
// booking's status is then re-derived from its merged step completions.
const STATUS_RANK = BOOKING_STATUS_RANK;

export type MergeableBookingFields = {
  status: BookingStatus;
  label: string | null;
  bookedContactId: string | null;
  confirmationRef: string | null;
  notes: string | null;
  bookedOn: Date | null;
  agreedCurrency: string;
  // How many BookingPriceLine rows the booking carries (the lines themselves
  // move in the txn — see `takesSourcePrice`).
  priceLineCount: number;
};

/**
 * The agreed price travels as a unit (lines + currency): the target's wins;
 * the source's is adopted only when the target has no lines of its own.
 */
export function takesSourcePrice(
  target: Pick<MergeableBookingFields, "priceLineCount">,
  source: Pick<MergeableBookingFields, "priceLineCount">,
): boolean {
  return target.priceLineCount === 0 && source.priceLineCount > 0;
}

export function mergeBookingFields(
  target: MergeableBookingFields,
  source: MergeableBookingFields,
): Omit<MergeableBookingFields, "priceLineCount"> {
  const price = takesSourcePrice(target, source) ? source : target;
  return {
    status:
      STATUS_RANK[source.status] > STATUS_RANK[target.status]
        ? source.status
        : target.status,
    label: target.label || source.label,
    bookedContactId: target.bookedContactId ?? source.bookedContactId,
    confirmationRef: joinText(target.confirmationRef, source.confirmationRef),
    notes: joinText(target.notes, source.notes),
    bookedOn: target.bookedOn ?? source.bookedOn,
    agreedCurrency: price.agreedCurrency,
  };
}

export type MergeableHostSiteFields = {
  providesLodging: boolean;
  providesMeals: boolean;
  providesMeetingSpace: boolean;
  staffNotes: string | null;
  logisticsNotes: string | null;
};

export function mergeHostSiteFields(
  target: MergeableHostSiteFields,
  source: MergeableHostSiteFields,
): MergeableHostSiteFields {
  return {
    providesLodging: target.providesLodging || source.providesLodging,
    providesMeals: target.providesMeals || source.providesMeals,
    providesMeetingSpace:
      target.providesMeetingSpace || source.providesMeetingSpace,
    staffNotes: joinText(target.staffNotes, source.staffNotes),
    logisticsNotes: joinText(target.logisticsNotes, source.logisticsNotes),
  };
}

// What a merge would move — shown before confirming (UI dialog, MCP dryRun).
export type LocationMergePreview = {
  source: { id: string; name: string };
  target: { id: string; name: string };
  scheduleItems: number;
  plannedDays: number;
  bookings: number;
  // Trips where both venues have an engagement; those fold into one.
  bookingConflicts: { tripId: string; tripName: string }[];
  stays: number;
  notes: number;
  documents: number;
  costs: number;
  events: number;
  contacts: number;
  travelReferences: number;
  shareLinks: number;
  // Sites booked via the source that will be booked via the target instead.
  coveredSites: number;
  hostSite: "none" | "moved" | "merged";
  paymentTerms: "none" | "moved" | "dropped";
};

type Db = Prisma.TransactionClient | typeof prisma;

async function loadPair(db: Db, sourceId: string, targetId: string) {
  if (sourceId === targetId) {
    throw new MergeError("Pick a different location to merge into.");
  }
  const select = {
    id: true,
    name: true,
    regionId: true,
    address: true,
    description: true,
    notes: true,
    website: true,
    mapUrl: true,
    googlePlaceId: true,
    lat: true,
    lng: true,
    placeIdCheckedAt: true,
    placeIdNeedsReview: true,
    bookable: true,
    bookingOpensLeadDays: true,
    bookingNotes: true,
    scheduleLimitations: true,
    primaryContactId: true,
    archivedAt: true,
    defaultWorkflowId: true,
    bookedViaId: true,
    coveredSites: { select: { id: true } },
    hostSite: true,
    contacts: { select: { id: true } },
    tripTypes: { select: { id: true } },
    _count: { select: { defaultPaymentSchedule: true } },
  } satisfies Prisma.LocationSelect;
  const [source, target] = await Promise.all([
    db.location.findUnique({ where: { id: sourceId }, select }),
    db.location.findUnique({ where: { id: targetId }, select }),
  ]);
  if (!source) throw new MergeError("Location to merge away not found.");
  if (!target) throw new MergeError("Location to keep not found.");
  // Booked-via (parent venue) link: the source's covered sites move to the
  // target; refused when that would nest parents.
  const bookedVia = mergeBookedVia({
    sourceId,
    targetId,
    sourceBookedViaId: source.bookedViaId,
    targetBookedViaId: target.bookedViaId,
    sourceHasCoveredSites: source.coveredSites.some((c) => c.id !== targetId),
    targetHasCoveredSites: target.coveredSites.some((c) => c.id !== sourceId),
  });
  if ("error" in bookedVia) throw new MergeError(bookedVia.error);
  return { source, target, bookedVia };
}

/**
 * Fold booking `sourceId` into booking `targetId` and delete the source:
 * payments, notes and documents move over, scalar gaps fill from the source,
 * the status keeps the further-along of the two, the source's schedule and
 * price are adopted only when the target has none, and same-workflow step
 * completions move — then the target's status recomputes.
 */
export async function foldBookingInto(
  tx: Prisma.TransactionClient,
  sourceId: string,
  targetId: string,
): Promise<void> {
  const withCounts = {
    include: { _count: { select: { paymentSchedule: true, priceLines: true } } },
  } as const;
  const sb = await tx.booking.findUniqueOrThrow({ where: { id: sourceId }, ...withCounts });
  const tb = await tx.booking.findUniqueOrThrow({ where: { id: targetId }, ...withCounts });
  const move = { where: { bookingId: sb.id }, data: { bookingId: tb.id } };
  await tx.payment.updateMany(move);
  await tx.note.updateMany(move);
  await tx.document.updateMany(move);
  if (tb._count.paymentSchedule === 0) {
    await tx.paymentScheduleItem.updateMany(move);
  }
  const tFields = { ...tb, priceLineCount: tb._count.priceLines };
  const sFields = { ...sb, priceLineCount: sb._count.priceLines };
  if (takesSourcePrice(tFields, sFields)) {
    await tx.bookingPriceLine.updateMany(move);
  }
  // Workflow progress: the target's workflow wins (adopting the source's
  // when it has none); source completions on that workflow's steps move
  // over unless the target already ticked the same step.
  const workflowId = tb.workflowId ?? sb.workflowId;
  if (workflowId && sb.workflowId === workflowId) {
    const done = await tx.bookingStepCompletion.findMany({
      where: { bookingId: tb.id },
      select: { stepId: true },
    });
    await tx.bookingStepCompletion.updateMany({
      where: {
        bookingId: sb.id,
        stepId: { notIn: done.map((d) => d.stepId) },
      },
      data: { bookingId: tb.id },
    });
  }
  await tx.booking.update({
    where: { id: tb.id },
    data: { ...mergeBookingFields(tFields, sFields), workflowId },
  });
  await tx.booking.delete({ where: { id: sb.id } });
  await recomputeBooking(tb.id, tx);
}

/**
 * Move every venue engagement on `sourceId` to `targetId`. Where both venues
 * are engaged on the same trip the two fold into the target's booking
 * (`foldBookingInto`). Returns how many engagements moved.
 * Shared by the location merge and "booked via" (a site gaining a parent hands
 * its engagements to the parent).
 */
export async function foldVenueEngagements(
  tx: Prisma.TransactionClient,
  sourceId: string,
  targetId: string,
): Promise<number> {
  const sourceBookings = await tx.booking.findMany({
    where: { locationId: sourceId, tripId: { not: null } },
    select: { id: true, tripId: true },
  });
  for (const sb of sourceBookings) {
    const tb = await tx.booking.findUnique({
      where: { tripId_locationId: { tripId: sb.tripId!, locationId: targetId } },
      select: { id: true },
    });
    if (!tb) continue; // no collision — repointed by the updateMany below
    await foldBookingInto(tx, sb.id, tb.id);
  }
  // The rest (no collision) simply repoint.
  await tx.booking.updateMany({
    where: { locationId: sourceId, tripId: { not: null } },
    data: { locationId: targetId },
  });
  return sourceBookings.length;
}

export class MergeError extends Error {}

export async function previewLocationMerge(
  sourceId: string,
  targetId: string,
): Promise<LocationMergePreview> {
  const { source, target } = await loadPair(prisma, sourceId, targetId);
  const s = { locationId: sourceId };
  const targetContactIds = new Set(target.contacts.map((c) => c.id));

  const [
    scheduleItems,
    plannedDays,
    bookings,
    conflicts,
    stays,
    notes,
    documents,
    costs,
    events,
    travelFrom,
    travelTo,
    travelStops,
    primaryDays,
    shareLinks,
  ] = await Promise.all([
    prisma.scheduleItemSite.count({ where: s }),
    prisma.itineraryDayLocation.count({ where: s }),
    prisma.booking.count({ where: s }),
    prisma.booking.findMany({
      where: {
        locationId: sourceId,
        tripId: { not: null },
        trip: { bookings: { some: { locationId: targetId } } },
      },
      select: { trip: { select: { id: true, name: true } } },
    }),
    prisma.stay.count({ where: s }),
    prisma.note.count({ where: s }),
    prisma.document.count({ where: s }),
    prisma.cost.count({ where: s }),
    prisma.locationEvent.count({ where: s }),
    prisma.travelLeg.count({ where: { fromLocationId: sourceId } }),
    prisma.travelLeg.count({ where: { toLocationId: sourceId } }),
    prisma.travelStop.count({ where: s }),
    prisma.itineraryDay.count({ where: { primaryLocationId: sourceId } }),
    prisma.shareLink.count({ where: s }),
  ]);

  return {
    source: { id: source.id, name: source.name },
    target: { id: target.id, name: target.name },
    scheduleItems,
    plannedDays,
    bookings,
    bookingConflicts: conflicts.flatMap((b) =>
      b.trip ? [{ tripId: b.trip.id, tripName: b.trip.name }] : [],
    ),
    stays,
    notes,
    documents,
    costs,
    events,
    contacts: source.contacts.filter((c) => !targetContactIds.has(c.id)).length,
    travelReferences: travelFrom + travelTo + travelStops + primaryDays,
    shareLinks,
    coveredSites: source.coveredSites.filter((c) => c.id !== targetId).length,
    hostSite: !source.hostSite ? "none" : target.hostSite ? "merged" : "moved",
    paymentTerms:
      source._count.defaultPaymentSchedule === 0
        ? "none"
        : target._count.defaultPaymentSchedule === 0
          ? "moved"
          : "dropped",
  };
}

// Fold `sourceId` into `targetId` and delete the source. Returns the preview
// computed just before the merge (what was moved).
export async function mergeLocations(
  sourceId: string,
  targetId: string,
): Promise<LocationMergePreview> {
  const preview = await previewLocationMerge(sourceId, targetId);

  await prisma.$transaction(async (tx) => {
    const { source, target, bookedVia } = await loadPair(
      tx,
      sourceId,
      targetId,
    );
    const fromSource = { where: { locationId: sourceId } };
    const toTarget = { data: { locationId: targetId } };

    // Itinerary visits: drop source rows on items/days that already hit the target.
    const itemsAtTarget = await tx.scheduleItemSite.findMany({
      where: { locationId: targetId },
      select: { scheduleItemId: true },
    });
    await tx.scheduleItemSite.deleteMany({
      where: {
        locationId: sourceId,
        scheduleItemId: { in: itemsAtTarget.map((r) => r.scheduleItemId) },
      },
    });
    await tx.scheduleItemSite.updateMany({ ...fromSource, ...toTarget });

    const daysAtTarget = await tx.itineraryDayLocation.findMany({
      where: { locationId: targetId },
      select: { dayId: true },
    });
    await tx.itineraryDayLocation.deleteMany({
      where: {
        locationId: sourceId,
        dayId: { in: daysAtTarget.map((r) => r.dayId) },
      },
    });
    await tx.itineraryDayLocation.updateMany({ ...fromSource, ...toTarget });

    // Venue engagements: fold same-trip pairs, repoint the rest.
    await foldVenueEngagements(tx, sourceId, targetId);
    // Item-targeted bookings that name the source as their venue.
    await tx.booking.updateMany({ ...fromSource, ...toTarget });

    // Plain repoints.
    await tx.stay.updateMany({ ...fromSource, ...toTarget });
    await tx.note.updateMany({ ...fromSource, ...toTarget });
    await tx.document.updateMany({ ...fromSource, ...toTarget });
    await tx.cost.updateMany({ ...fromSource, ...toTarget });
    await tx.locationEvent.updateMany({ ...fromSource, ...toTarget });
    await tx.shareLink.updateMany({ ...fromSource, ...toTarget });
    await tx.travelStop.updateMany({ ...fromSource, ...toTarget });
    await tx.travelLeg.updateMany({
      where: { fromLocationId: sourceId },
      data: { fromLocationId: targetId },
    });
    await tx.travelLeg.updateMany({
      where: { toLocationId: sourceId },
      data: { toLocationId: targetId },
    });
    await tx.itineraryDay.updateMany({
      where: { primaryLocationId: sourceId },
      data: { primaryLocationId: targetId },
    });
    if (target._count.defaultPaymentSchedule === 0) {
      await tx.locationPaymentScheduleItem.updateMany({ ...fromSource, ...toTarget });
    }
    if (!target.defaultWorkflowId && source.defaultWorkflowId) {
      await tx.location.update({
        where: { id: targetId },
        data: { defaultWorkflowId: source.defaultWorkflowId },
      });
    }

    // Host-site extension (1:1).
    if (source.hostSite && target.hostSite) {
      await tx.hostSite.update({
        where: { locationId: targetId },
        data: mergeHostSiteFields(target.hostSite, source.hostSite),
      });
    } else if (source.hostSite) {
      await tx.hostSite.update({
        where: { locationId: sourceId },
        data: { locationId: targetId },
      });
    }

    // Sites booked via the source are now booked via the target.
    await tx.location.updateMany({
      where: { bookedViaId: sourceId, id: { not: targetId } },
      data: { bookedViaId: targetId },
    });

    // The target's own fields + the union of contacts and trip-type tags.
    const { primaryContactId, regionId, ...fields } = mergeLocationFields(
      target,
      source,
    );
    await tx.location.update({
      where: { id: targetId },
      data: {
        ...fields,
        region: regionId ? { connect: { id: regionId } } : undefined,
        contacts: { connect: source.contacts },
        tripTypes: { connect: source.tripTypes },
        primaryContact: primaryContactId
          ? { connect: { id: primaryContactId } }
          : undefined,
        bookedVia: bookedVia.targetBookedViaId
          ? { connect: { id: bookedVia.targetBookedViaId } }
          : { disconnect: true },
      },
    });
    // Booked via a parent now: the parent's engagement covers the target, so
    // the target's own (incl. those just moved from the source) fold into it.
    if (bookedVia.targetBookedViaId) {
      await foldVenueEngagements(tx, targetId, bookedVia.targetBookedViaId);
    }

    // Anything left on the source (host site / terms we didn't adopt) cascades.
    await tx.location.delete({ where: { id: sourceId } });
  });

  return preview;
}
