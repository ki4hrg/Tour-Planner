import type { BookingStatus } from "@prisma/client";
import { computeDayDate } from "./dates";

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
};

export type TemplateScheduleItem = {
  categoryId: string | null;
  title: string | null;
  order: number;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  isBlock: boolean;
  presentationId: string | null;
  sites: TemplateItemLocation[];
  bookings: TemplateBooking[];
};

export type TemplateDay = {
  dayIndex: number;
  title: string | null;
  logisticalNotes: string | null;
  scheduleItems: TemplateScheduleItem[];
};

// Prisma nested-create payloads (typed structurally so this file stays
// importable from tests without a Prisma client).
export type InstantiatedItemLocation = { locationId: string; order: number };

export type InstantiatedBooking = {
  locationId: string | null;
  label: string | null;
  notes: string | null;
  status: BookingStatus;
};

export type InstantiatedScheduleItem = {
  categoryId: string | null;
  title: string | null;
  order: number;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  isBlock: boolean;
  presentationId: string | null; // catalog link survives; presenters reset (omitted)
  sites: { create: InstantiatedItemLocation[] };
  bookings: { create: InstantiatedBooking[] };
};

export type InstantiatedDay = {
  dayIndex: number;
  date: Date | null;
  title: string | null;
  logisticalNotes: string | null;
  scheduleItems: { create: InstantiatedScheduleItem[] };
};

// A venue-engagement booking lives at the trip level (tripId + locationId), so it
// is copied alongside the days rather than nested under an item.
export type TemplateVenueBooking = {
  locationId: string | null;
  label: string | null;
  notes: string | null;
};

export type InstantiatedVenueBooking = {
  locationId: string;
  label: string | null;
  notes: string | null;
  status: BookingStatus;
};

/**
 * Deep-copy a trip/template's venue-engagement bookings into trip-level create-data.
 * Status is reset to NOT_BOOKED and the instance actuals (contact, confirmationRef)
 * are dropped — same reset policy as item bookings. Rows without a location are
 * skipped (engagements require one).
 */
export function instantiateVenueBookings(
  bookings: TemplateVenueBooking[],
): InstantiatedVenueBooking[] {
  return bookings
    .filter((b): b is TemplateVenueBooking & { locationId: string } =>
      Boolean(b.locationId),
    )
    .map((b) => ({
      locationId: b.locationId,
      label: b.label,
      notes: b.notes,
      status: "NOT_BOOKED" as BookingStatus,
    }));
}

/**
 * Deep-copy a template's days/items into create-data for a new trip.
 *
 * - dayIndex and item order are renumbered 1..n (source gaps are normalised).
 * - each day's date is derived from the new trip's startDate (null if unset).
 * - location links are carried over (re-ordered 0..n).
 * - bookings are carried over as planning intent but RESET: status → NOT_BOOKED
 *   and the instance-specific actuals (bookedContact, confirmationRef) are
 *   dropped by omission. Reusable text (label, notes) is kept.
 *
 * Templates are snapshots: this copies values, so later edits to the template do
 * not propagate to trips already instantiated from it.
 */
export function instantiateDays(
  days: TemplateDay[],
  startDate: Date | null,
): InstantiatedDay[] {
  return [...days]
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .map((day, i) => {
      const dayIndex = i + 1;
      return {
        dayIndex,
        date: computeDayDate(startDate, dayIndex),
        title: day.title,
        logisticalNotes: day.logisticalNotes,
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
              // The shared catalog link survives; the per-occurrence speaker
              // override is reset (next trip assigns its own — like bookings).
              presentationId: item.presentationId,
              sites: {
                create: [...item.sites]
                  .sort((a, b) => a.order - b.order)
                  .map((s, sj) => ({ locationId: s.locationId, order: sj })),
              },
              bookings: {
                create: item.bookings.map((b) => ({
                  locationId: b.locationId,
                  label: b.label,
                  notes: b.notes,
                  status: "NOT_BOOKED" as BookingStatus,
                })),
              },
            })),
        },
      };
    });
}
