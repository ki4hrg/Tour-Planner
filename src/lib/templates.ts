import type { BookingStatus } from "@prisma/client";
import { computeDayDate } from "./dates";

// Minimal shapes the deep-copy needs — kept framework-light so the helper is a
// pure, unit-testable function over plain data (no Prisma row instances needed).
export type TemplateStop = {
  siteId: string | null;
  title: string | null;
  order: number;
  startTime: string | null;
  endTime: string | null;
  scheduleNotes: string | null;
  bookingNotes: string | null;
};

export type TemplateDay = {
  dayIndex: number;
  title: string | null;
  logisticalNotes: string | null;
  stops: TemplateStop[];
};

// Prisma nested-create payload for `Trip.days` (typed structurally so this file
// stays importable from tests without a Prisma client).
export type InstantiatedStop = {
  siteId: string | null;
  title: string | null;
  order: number;
  startTime: string | null;
  endTime: string | null;
  scheduleNotes: string | null;
  bookingNotes: string | null;
  bookingStatus: BookingStatus;
};

export type InstantiatedDay = {
  dayIndex: number;
  date: Date | null;
  title: string | null;
  logisticalNotes: string | null;
  stops: { create: InstantiatedStop[] };
};

/**
 * Deep-copy a template's days/stops into create-data for a new trip.
 *
 * - dayIndex and stop order are renumbered 1..n (source gaps are normalised).
 * - each day's date is derived from the new trip's startDate (null if unset).
 * - booking is reset: status → NOT_BOOKED, and the instance-specific actuals
 *   (bookedContact, confirmationRef) are dropped by omission. Reusable planning
 *   text (scheduleNotes, bookingNotes) is carried over.
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
        stops: {
          create: [...day.stops]
            .sort((a, b) => a.order - b.order)
            .map((stop, si) => ({
              siteId: stop.siteId,
              title: stop.title,
              order: si + 1,
              startTime: stop.startTime,
              endTime: stop.endTime,
              scheduleNotes: stop.scheduleNotes,
              bookingNotes: stop.bookingNotes,
              bookingStatus: "NOT_BOOKED" as BookingStatus,
            })),
        },
      };
    });
}
