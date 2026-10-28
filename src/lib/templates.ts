import type {
  BookingStatus,
  PaymentAnchor,
  PaymentOffsetUnit,
  Prisma,
  TravelMethod,
} from "@prisma/client";
import { computeDayDate, dayIndexForDate } from "./dates";

// Minimal shapes the deep-copy needs — kept framework-light so the helper is a
// pure, unit-testable function over plain data (no Prisma row instances needed).
export type TemplateItemLocation = {
  locationId: string;
  order: number;
};

export type TemplateBooking = {
  locationId: string | null;
  label: string | null;
  notes: string | null;
  workflowId?: string | null;
};

// A travel leg copies verbatim (route + method + stops are all reusable plan,
// nothing instance-specific).
export type TemplateTravelLeg = {
  method: TravelMethod;
  fromLocationId: string | null;
  fromLabel: string | null;
  toLocationId: string | null;
  toLabel: string | null;
  stops: {
    locationId: string | null;
    label: string | null;
    dwellMinutes: number | null;
    order: number;
  }[];
};

export type TemplateScheduleItem = {
  categoryId: string | null;
  title: string | null;
  order: number;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  isBlock: boolean;
  fixedTime?: boolean;
  presentationId: string | null;
  // This occurrence's speakers — carried over only when duplicating a trip
  // (see InstantiateOptions.presenters); a template resets them.
  presenters?: { id: string }[];
  sites: TemplateItemLocation[];
  bookings: TemplateBooking[];
  travel?: TemplateTravelLeg | null;
};

// A rough-plan day-location assignment (GH #9): reusable planning intent (a
// location + optional note, no times), so it carries over like schedule-item sites.
export type TemplatePlannedLocation = {
  locationId: string;
  order: number;
  note: string | null;
};

export type TemplateDay = {
  dayIndex: number;
  title: string | null;
  logisticalNotes: string | null;
  cityRegionId?: string | null;
  scheduleItems: TemplateScheduleItem[];
  plannedLocations: TemplatePlannedLocation[];
};

// Prisma nested-create payloads (typed structurally so this file stays
// importable from tests without a Prisma client).
export type InstantiatedItemLocation = { locationId: string; order: number };

export type InstantiatedBooking = {
  locationId: string | null;
  label: string | null;
  notes: string | null;
  status: BookingStatus;
  workflowId: string | null;
};

export type InstantiatedScheduleItem = {
  categoryId: string | null;
  title: string | null;
  order: number;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  isBlock: boolean;
  fixedTime?: boolean;
  presentationId: string | null; // catalog link survives; presenters reset unless asked for
  presenters?: { connect: { id: string }[] };
  sites: { create: InstantiatedItemLocation[] };
  bookings?: { create: InstantiatedBooking[] };
  travel?: {
    create: Omit<TemplateTravelLeg, "stops"> & {
      stops: { create: TemplateTravelLeg["stops"] };
    };
  };
};

export type InstantiatedDay = {
  dayIndex: number;
  date: Date | null;
  title: string | null;
  logisticalNotes: string | null;
  cityRegionId: string | null;
  scheduleItems: { create: InstantiatedScheduleItem[] };
  plannedLocations: { create: TemplatePlannedLocation[] };
};

// A venue-engagement booking lives at the trip level (tripId + locationId), so it
// is copied alongside the days rather than nested under an item. Its payment
// schedule (GH #51) is date-relative (days before trip start), so installments
// carry over verbatim — the venue's standing terms, unlike the negotiated price.
export type TemplateScheduleInstallment = {
  label: string | null;
  // Prisma.Decimal flows through untouched (never coerced across this boundary).
  percent: Prisma.Decimal | number | null;
  fixedAmount: Prisma.Decimal | number | null;
  // Anchor + offset carry over verbatim (GH #86): all date-relative, so they
  // resolve against the new trip's dates / booking date once instantiated.
  anchor: PaymentAnchor;
  offsetValue: number | null;
  offsetUnit: PaymentOffsetUnit | null;
  sortOrder: number;
};

export type TemplateVenueBooking = {
  locationId: string | null;
  label: string | null;
  notes: string | null;
  // The workflow the booking follows carries over; its progress does not.
  workflowId?: string | null;
  paymentSchedule?: TemplateScheduleInstallment[];
};

export type InstantiatedVenueBooking = {
  locationId: string;
  label: string | null;
  notes: string | null;
  status: BookingStatus;
  workflowId: string | null;
  paymentSchedule?: { create: TemplateScheduleInstallment[] };
};

/**
 * Deep-copy a trip/template's venue-engagement bookings into trip-level create-data.
 * Status is reset to PLANNED (the workflow is kept, its step progress is not) and
 * the instance actuals (contact, confirmationRef, agreed price) are dropped — same reset policy as item bookings. The payment
 * schedule is kept (fixed installment amounts included; the planner adjusts those
 * if the next negotiation differs). Rows without a location are skipped
 * (engagements require one).
 *
 * `engagementVenue` maps a site to the location its engagement lives on (a
 * site booked via a parent → the parent, see booked-via.ts). An engagement
 * copied from a since-reparented child lands on the parent; when the parent's
 * own engagement is copied too, that one wins (one engagement per venue).
 */
export function instantiateVenueBookings(
  bookings: TemplateVenueBooking[],
  engagementVenue: (locationId: string) => string = (id) => id,
): InstantiatedVenueBooking[] {
  const withVenue = bookings
    .filter((b): b is TemplateVenueBooking & { locationId: string } =>
      Boolean(b.locationId),
    )
    .map((b) => ({ b, venueId: engagementVenue(b.locationId) }));
  const chosen = new Map<string, TemplateVenueBooking & { locationId: string }>();
  for (const { b, venueId } of withVenue) {
    const prev = chosen.get(venueId);
    // The venue's own engagement beats one folded in from a child site.
    if (!prev || (prev.locationId !== venueId && b.locationId === venueId)) {
      chosen.set(venueId, b);
    }
  }
  return [...chosen.entries()].map(([venueId, b]) => ({
    locationId: venueId,
    label: b.label,
    notes: b.notes,
    status: "PLANNED" as BookingStatus,
    workflowId: b.workflowId ?? null,
    ...(b.paymentSchedule?.length
      ? {
          paymentSchedule: {
            create: b.paymentSchedule.map((i) => ({
              label: i.label,
              percent: i.percent,
              fixedAmount: i.fixedAmount,
              anchor: i.anchor,
              offsetValue: i.offsetValue,
              offsetUnit: i.offsetUnit,
              sortOrder: i.sortOrder,
            })),
          },
        }
      : {}),
  }));
}

/**
 * Deep-copy a template's days/items into create-data for a new trip.
 *
 * - dayIndex and item order are renumbered 1..n (source gaps are normalised).
 * - each day's date is derived from the new trip's startDate (null if unset).
 * - location links are carried over (re-ordered 0..n).
 * - rough-plan day locations (GH #9) carry over verbatim (re-ordered 0..n) as
 *   reusable planning intent, like schedule-item sites.
 * - bookings are carried over as planning intent but RESET: status → PLANNED
 *   (workflow kept, step progress dropped) and the instance-specific actuals (bookedContact, confirmationRef) are
 *   dropped by omission. Reusable text (label, notes) is kept.
 *
 * Templates are snapshots: this copies values, so later edits to the template do
 * not propagate to trips already instantiated from it.
 */
export type InstantiateOptions = {
  // Copy item bookings (reset to PLANNED) as planning intent. Default true —
  // the template path. Duplicating a past trip passes false: last year's
  // coach booking is not this year's plan.
  bookings?: boolean;
  // Connect each item's own speakers on the copy. Default false (a template
  // resets them); duplicating a trip keeps them — "same as last year".
  presenters?: boolean;
};

export function instantiateDays(
  days: TemplateDay[],
  startDate: Date | null,
  options: InstantiateOptions = {},
): InstantiatedDay[] {
  const copyBookings = options.bookings ?? true;
  const copyPresenters = options.presenters ?? false;
  return [...days]
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .map((day, i) => {
      const dayIndex = i + 1;
      return {
        dayIndex,
        date: computeDayDate(startDate, dayIndex),
        title: day.title,
        logisticalNotes: day.logisticalNotes,
        cityRegionId: day.cityRegionId ?? null,
        plannedLocations: {
          create: [...day.plannedLocations]
            .sort((a, b) => a.order - b.order)
            .map((p, pi) => ({
              locationId: p.locationId,
              order: pi,
              note: p.note,
            })),
        },
        scheduleItems: {
          create: [...day.scheduleItems]
            .sort((a, b) => a.order - b.order)
            .map((item, si) => ({
              categoryId: item.categoryId,
              title: item.title,
              order: si + 1,
              startTime: item.startTime,
              endTime: item.endTime,
              notes: item.notes,
              isBlock: item.isBlock,
              fixedTime: item.fixedTime ?? false,
              // The shared catalog link survives; the per-occurrence speaker
              // override is reset (next trip assigns its own — like bookings).
              presentationId: item.presentationId,
              ...(copyPresenters && item.presenters?.length
                ? { presenters: { connect: item.presenters.map((c) => ({ id: c.id })) } }
                : {}),
              sites: {
                create: [...item.sites]
                  .sort((a, b) => a.order - b.order)
                  .map((s, sj) => ({ locationId: s.locationId, order: sj })),
              },
              ...(copyBookings
                ? {
                    bookings: {
                      create: item.bookings.map((b) => ({
                        locationId: b.locationId,
                        label: b.label,
                        notes: b.notes,
                        status: "PLANNED" as BookingStatus,
                        workflowId: b.workflowId ?? null,
                      })),
                    },
                  }
                : {}),
              // The travel leg (route/method/stops) is reusable plan — copied
              // verbatim, stops renumbered 0..n.
              ...(item.travel
                ? {
                    travel: {
                      create: {
                        method: item.travel.method,
                        fromLocationId: item.travel.fromLocationId,
                        fromLabel: item.travel.fromLabel,
                        toLocationId: item.travel.toLocationId,
                        toLabel: item.travel.toLabel,
                        stops: {
                          create: [...item.travel.stops]
                            .sort((a, b) => a.order - b.order)
                            .map((s, sk) => ({
                              locationId: s.locationId,
                              label: s.label,
                              dwellMinutes: s.dwellMinutes,
                              order: sk,
                            })),
                        },
                      },
                    },
                  }
                : {}),
            })),
        },
      };
    });
}

// --- Stay (lodging) templatize / instantiate ---
//
// A stay anchors EITHER to absolute dates (dated trip) or 1-based day indices
// (date-less template). Reusable attributes (location, cost…) carry over
// unchanged in both directions; only the anchor is converted. The venue-engagement
// booking that covers the stay's location is handled by the booking copy path, so
// it is not touched here.

// The reusable, anchor-independent attributes shared across both directions.
type StayCarryOver = {
  locationId: string;
  arrivalTime: string | null;
  departureTime: string | null;
  headcount: number | null;
  // Prisma.Decimal flows through untouched (never coerced across this boundary).
  costPerPersonPerNight: Prisma.Decimal | null;
  currency: string;
  priority: number;
  notes: string | null;
};

export type SourceStay = StayCarryOver & {
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDayIndex: number | null;
  checkOutDayIndex: number | null;
};

export type TemplatizedStay = StayCarryOver & {
  checkIn: null;
  checkOut: null;
  checkInDayIndex: number;
  checkOutDayIndex: number;
};

export type InstantiatedStay = StayCarryOver & {
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDayIndex: number | null;
  checkOutDayIndex: number | null;
};

function carryOver(s: StayCarryOver): StayCarryOver {
  return {
    locationId: s.locationId,
    arrivalTime: s.arrivalTime,
    departureTime: s.departureTime,
    headcount: s.headcount,
    costPerPersonPerNight: s.costPerPersonPerNight,
    currency: s.currency,
    priority: s.priority,
    notes: s.notes,
  };
}

/**
 * Convert a trip's stays into day-relative template rows (dates → day indices,
 * measured from the source trip's startDate). A stay that can't be anchored — the
 * source trip has no startDate, or the stay is already day-relative with no dates —
 * is dropped, since a template stay MUST carry indices. Returns Prisma create-data.
 */
export function templatizeStays(
  stays: SourceStay[],
  startDate: Date | null,
): TemplatizedStay[] {
  return stays.flatMap((s) => {
    const ci = dayIndexForDate(startDate, s.checkIn);
    const co = dayIndexForDate(startDate, s.checkOut);
    if (ci == null || co == null) return [];
    return [
      {
        ...carryOver(s),
        checkIn: null,
        checkOut: null,
        checkInDayIndex: ci,
        checkOutDayIndex: co,
      },
    ];
  });
}

/**
 * Copy stays into a new trip. When the target has a startDate the day-relative
 * anchors are resolved to absolute dates (indices → dates); when the target is
 * itself date-less (instantiating a template as another template) the indices are
 * carried over as-is. Already-dated source stays keep their dates. Returns
 * Prisma create-data.
 */
export function instantiateStays(
  stays: SourceStay[],
  startDate: Date | null,
): InstantiatedStay[] {
  return stays.map((s) => {
    const base = carryOver(s);
    // Prefer an explicit day-index anchor; fall back to an absolute one.
    const idxIn = s.checkInDayIndex;
    const idxOut = s.checkOutDayIndex;
    if (idxIn != null && idxOut != null) {
      const dateIn = computeDayDate(startDate, idxIn);
      const dateOut = computeDayDate(startDate, idxOut);
      // Dated target → materialize dates and clear indices; date-less target →
      // keep indices (dates stay null). Exactly one mode is populated either way.
      return dateIn && dateOut
        ? { ...base, checkIn: dateIn, checkOut: dateOut, checkInDayIndex: null, checkOutDayIndex: null }
        : { ...base, checkIn: null, checkOut: null, checkInDayIndex: idxIn, checkOutDayIndex: idxOut };
    }
    return {
      ...base,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      checkInDayIndex: null,
      checkOutDayIndex: null,
    };
  });
}

/**
 * Copy stays from any source trip onto a new one. A date-less template already
 * carries day indices; a dated trip's stays are first re-expressed as indices
 * against the SOURCE startDate (as "Save as template" would), so the copy lands on
 * the same trip days under the new dates — the "same as last year, shifted a
 * week" case — without a template row ever being written.
 */
export function copyStays(
  stays: SourceStay[],
  source: { isTemplate: boolean; startDate: Date | null },
  targetStartDate: Date | null,
): InstantiatedStay[] {
  const dayRelative = source.isTemplate
    ? stays
    : templatizeStays(stays, source.startDate);
  return instantiateStays(dayRelative, targetStartDate);
}

// --- Fit copied days to the new trip's date range ---

export type DayFit = {
  days: InstantiatedDay[];
  endDate: Date | null;
  // How many empty days were appended to reach endDate.
  padded: number;
  // endDate was pushed out to the last copied day (the range was shorter).
  endDateMoved: boolean;
};

/**
 * Reconcile a copied itinerary with the date range the planner typed. A longer
 * range pads empty dated days up to endDate (what addDay would create, one per
 * missing date); a shorter range KEEPS every day and moves endDate to the last
 * one — dropping days silently would lose plan. No startDate ⇒ nothing to fit
 * (a template). No endDate ⇒ it is set to the last day.
 */
export function fitDaysToRange(
  days: InstantiatedDay[],
  startDate: Date | null,
  endDate: Date | null,
): DayFit {
  if (!startDate || days.length === 0) {
    return { days, endDate, padded: 0, endDateMoved: false };
  }
  const rangeDays = dayIndexForDate(startDate, endDate) ?? 0;
  const count = days.length;
  if (rangeDays > count) {
    const pad: InstantiatedDay[] = [];
    for (let dayIndex = count + 1; dayIndex <= rangeDays; dayIndex++) {
      pad.push({
        dayIndex,
        date: computeDayDate(startDate, dayIndex),
        title: null,
        logisticalNotes: null,
        cityRegionId: null,
        scheduleItems: { create: [] },
        plannedLocations: { create: [] },
      });
    }
    return { days: [...days, ...pad], endDate, padded: pad.length, endDateMoved: false };
  }
  if (rangeDays < count) {
    return {
      days,
      endDate: computeDayDate(startDate, count),
      padded: 0,
      endDateMoved: true,
    };
  }
  return { days, endDate, padded: 0, endDateMoved: false };
}

const DAY_MONTH_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** The create toast: "Created with 7 days." / "…; end date moved to 5 Nov." */
export function describeDayFit(fit: DayFit): string {
  const n = fit.days.length;
  const base = `Created with ${n} day${n === 1 ? "" : "s"}`;
  return fit.endDateMoved && fit.endDate
    ? `${base}; end date moved to ${DAY_MONTH_FMT.format(fit.endDate)}.`
    : `${base}.`;
}
