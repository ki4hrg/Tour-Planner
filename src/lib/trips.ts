import type {
  BookingStatus,
  ItineraryDay,
  Stop,
  Trip,
  TripStatus,
} from "@prisma/client";
import { toDateInput } from "@/lib/dates";

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  PLANNING: "Planning",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const TRIP_STATUSES = Object.keys(TRIP_STATUS_LABELS) as TripStatus[];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  NOT_NEEDED: "Not needed",
  NOT_BOOKED: "Not booked",
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
};

export const BOOKING_STATUSES = Object.keys(
  BOOKING_STATUS_LABELS,
) as BookingStatus[];

// Tailwind classes for a booking-status pill (matches Badge usage).
export const BOOKING_STATUS_CLASSES: Record<BookingStatus, string> = {
  NOT_NEEDED: "bg-muted text-muted-foreground",
  NOT_BOOKED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  REQUESTED: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  CONFIRMED:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

// --- Serialization (Date → "yyyy-mm-dd" strings for Client Components) ---

export type SerializedStop = Omit<Stop, never> & {
  site: { id: string; name: string } | null;
  bookedContact: { id: string; name: string } | null;
};

export type SerializedDay = Omit<ItineraryDay, "date"> & {
  date: string | null;
  stops: SerializedStop[];
};

export type SerializedTrip = Omit<Trip, "startDate" | "endDate"> & {
  startDate: string | null;
  endDate: string | null;
};

type StopWithRelations = Stop & {
  site: { id: string; name: string } | null;
  bookedContact: { id: string; name: string } | null;
};

export function serializeStop(stop: StopWithRelations): SerializedStop {
  return {
    ...stop,
    site: stop.site ? { id: stop.site.id, name: stop.site.name } : null,
    bookedContact: stop.bookedContact
      ? { id: stop.bookedContact.id, name: stop.bookedContact.name }
      : null,
  };
}

export function serializeDay(
  day: ItineraryDay & { stops: StopWithRelations[] },
): SerializedDay {
  return {
    ...day,
    date: day.date ? toDateInput(day.date) : null,
    stops: day.stops.map(serializeStop),
  };
}

export function serializeTrip(trip: Trip): SerializedTrip {
  return {
    ...trip,
    startDate: trip.startDate ? toDateInput(trip.startDate) : null,
    endDate: trip.endDate ? toDateInput(trip.endDate) : null,
  };
}
