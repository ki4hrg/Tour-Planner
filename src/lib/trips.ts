import type {
  BookingStatus,
  Booking,
  ItineraryDay,
  ScheduleItem,
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
  NOT_BOOKED: "Not booked",
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
};

export const BOOKING_STATUSES = Object.keys(
  BOOKING_STATUS_LABELS,
) as BookingStatus[];

// Tailwind classes for a booking-status pill (matches Badge usage).
export const BOOKING_STATUS_CLASSES: Record<BookingStatus, string> = {
  NOT_BOOKED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  REQUESTED: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  CONFIRMED:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

// --- Serialization (Date → "yyyy-mm-dd" strings for Client Components) ---

export type SerializedItemSite = {
  id: string;
  siteId: string;
  order: number;
  site: { id: string; name: string; region: string | null };
};

export type SerializedBooking = {
  id: string;
  scheduleItemId: string;
  siteId: string | null;
  label: string | null;
  status: BookingStatus;
  bookedContactId: string | null;
  bookedContact: { id: string; name: string } | null;
  confirmationRef: string | null;
  notes: string | null;
};

export type SerializedScheduleItem = {
  id: string;
  dayId: string;
  categoryId: string | null;
  category: { id: string; name: string; color: string | null } | null;
  title: string | null;
  order: number;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  isBlock: boolean;
  presenterContactId: string | null;
  presenter: { id: string; name: string } | null;
  sites: SerializedItemSite[];
  bookings: SerializedBooking[];
};

export type SerializedDay = Omit<ItineraryDay, "date"> & {
  date: string | null;
  items: SerializedScheduleItem[];
};

export type SerializedTrip = Omit<Trip, "startDate" | "endDate"> & {
  startDate: string | null;
  endDate: string | null;
};

// The relational shapes the serializers expect (a subset of the Prisma rows).
type ItemSiteRow = {
  id: string;
  siteId: string;
  order: number;
  site: { id: string; name: string; region: string | null };
};

type BookingRow = Booking & {
  bookedContact: { id: string; name: string } | null;
};

type ScheduleItemWithRelations = ScheduleItem & {
  category: { id: string; name: string; color: string | null } | null;
  presenter: { id: string; name: string } | null;
  sites: ItemSiteRow[];
  bookings: BookingRow[];
};

export function serializeBooking(b: BookingRow): SerializedBooking {
  return {
    id: b.id,
    scheduleItemId: b.scheduleItemId,
    siteId: b.siteId,
    label: b.label,
    status: b.status,
    bookedContactId: b.bookedContactId,
    bookedContact: b.bookedContact
      ? { id: b.bookedContact.id, name: b.bookedContact.name }
      : null,
    confirmationRef: b.confirmationRef,
    notes: b.notes,
  };
}

export function serializeScheduleItem(
  item: ScheduleItemWithRelations,
): SerializedScheduleItem {
  return {
    id: item.id,
    dayId: item.dayId,
    categoryId: item.categoryId,
    category: item.category
      ? { id: item.category.id, name: item.category.name, color: item.category.color }
      : null,
    title: item.title,
    order: item.order,
    startTime: item.startTime,
    endTime: item.endTime,
    notes: item.notes,
    isBlock: item.isBlock,
    presenterContactId: item.presenterContactId,
    presenter: item.presenter
      ? { id: item.presenter.id, name: item.presenter.name }
      : null,
    sites: [...item.sites]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        siteId: s.siteId,
        order: s.order,
        site: { id: s.site.id, name: s.site.name, region: s.site.region },
      })),
    bookings: item.bookings.map(serializeBooking),
  };
}

export function serializeDay(
  day: ItineraryDay & { scheduleItems: ScheduleItemWithRelations[] },
): SerializedDay {
  return {
    ...day,
    date: day.date ? toDateInput(day.date) : null,
    items: day.scheduleItems.map(serializeScheduleItem),
  };
}

export function serializeTrip(trip: Trip): SerializedTrip {
  return {
    ...trip,
    startDate: trip.startDate ? toDateInput(trip.startDate) : null,
    endDate: trip.endDate ? toDateInput(trip.endDate) : null,
  };
}
