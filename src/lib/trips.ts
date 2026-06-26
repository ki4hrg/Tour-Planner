import type {
  BookingStatus,
  BoardType,
  Booking,
  ItineraryDay,
  ScheduleItem,
  Stay,
  Trip,
  TripStatus,
} from "@prisma/client";
import { toDateInput } from "@/lib/dates";

export const BOARD_LABELS: Record<BoardType, string> = {
  NONE: "No meals",
  BED_AND_BREAKFAST: "B&B",
  HALF_BOARD: "Half board",
  FULL_BOARD: "Full board",
};

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

export type SerializedItemLocation = {
  id: string;
  locationId: string;
  order: number;
  location: { id: string; name: string };
};

export type SerializedPerson = { id: string; name: string };

export type SerializedBooking = {
  id: string;
  scheduleItemId: string | null;
  stayId: string | null;
  locationId: string | null;
  label: string | null;
  status: BookingStatus;
  bookedContactId: string | null;
  bookedContact: SerializedPerson | null;
  confirmationRef: string | null;
  notes: string | null;
};

export type SerializedItemPresentation = {
  id: string;
  title: string;
  defaultPresenters: SerializedPerson[];
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
  presentationId: string | null;
  presentation: SerializedItemPresentation | null;
  presenters: SerializedPerson[]; // per-occurrence override; empty ⇒ use presentation.defaultPresenters
  sites: SerializedItemLocation[];
  bookings: SerializedBooking[];
};

// The primary heading shown for a schedule item. The venue leads everywhere: a
// linked location is the heading, with the talk/title rendered beneath it — so
// locations render consistently whatever the item's kind. Precedence:
//   1. an explicit title override on the item (the override label wins),
//   2. the lone visited location's name,
//   3. a block / multi-location fallback,
//   4. the linked talk's title (site-less talks read by their content),
//   5. "Untitled item".
// `locationIsPrimary` is true only when a single bare location IS the heading, so
// callers know not to repeat it; `presentationIsPrimary` is true only when the
// talk title is the heading (a site-less talk), letting callers avoid echoing it.
export function scheduleItemPrimaryLabel(item: {
  title: string | null;
  isBlock: boolean;
  presentation: { title: string } | null;
  sites: { location: { name: string } }[];
}): {
  primary: string;
  locationIsPrimary: boolean;
  presentationIsPrimary: boolean;
} {
  if (item.title) {
    return {
      primary: item.title,
      locationIsPrimary: false,
      presentationIsPrimary: false,
    };
  }
  if (item.sites.length === 1 && !item.isBlock) {
    return {
      primary: item.sites[0].location.name,
      locationIsPrimary: true,
      presentationIsPrimary: false,
    };
  }
  if (item.sites.length >= 1) {
    const primary = item.isBlock
      ? `Choose from ${item.sites.length} location${item.sites.length === 1 ? "" : "s"}`
      : `${item.sites.length} locations`;
    return { primary, locationIsPrimary: false, presentationIsPrimary: false };
  }
  if (item.presentation) {
    return {
      primary: item.presentation.title,
      locationIsPrimary: false,
      presentationIsPrimary: true,
    };
  }
  return {
    primary: "Untitled item",
    locationIsPrimary: false,
    presentationIsPrimary: false,
  };
}

// The speaker(s) actually shown for an item: the per-occurrence override if set,
// otherwise the catalogued talk's default speaker(s).
export function effectivePresenters(item: {
  presenters: SerializedPerson[];
  presentation: { defaultPresenters: SerializedPerson[] } | null;
}): SerializedPerson[] {
  return item.presenters.length
    ? item.presenters
    : (item.presentation?.defaultPresenters ?? []);
}

export type SerializedDay = Omit<ItineraryDay, "date"> & {
  date: string | null;
  items: SerializedScheduleItem[];
};

export type SerializedTrip = Omit<Trip, "startDate" | "endDate"> & {
  startDate: string | null;
  endDate: string | null;
};

// The relational shapes the serializers expect (a subset of the Prisma rows).
type ItemLocationRow = {
  id: string;
  locationId: string;
  order: number;
  location: { id: string; name: string };
};

type BookingRow = Booking & {
  bookedContact: { id: string; name: string } | null;
};

type ScheduleItemWithRelations = ScheduleItem & {
  category: { id: string; name: string; color: string | null } | null;
  presentation: {
    id: string;
    title: string;
    defaultPresenters: SerializedPerson[];
  } | null;
  presenters: SerializedPerson[];
  sites: ItemLocationRow[];
  bookings: BookingRow[];
};

export function serializeBooking(b: BookingRow): SerializedBooking {
  return {
    id: b.id,
    scheduleItemId: b.scheduleItemId,
    stayId: b.stayId,
    locationId: b.locationId,
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
    presentationId: item.presentationId,
    presentation: item.presentation
      ? {
          id: item.presentation.id,
          title: item.presentation.title,
          defaultPresenters: item.presentation.defaultPresenters.map((p) => ({
            id: p.id,
            name: p.name,
          })),
        }
      : null,
    presenters: item.presenters.map((p) => ({ id: p.id, name: p.name })),
    sites: [...item.sites]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        locationId: s.locationId,
        order: s.order,
        location: {
          id: s.location.id,
          name: s.location.name,
        },
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

// --- Stay (lodging) serialization ---

export type SerializedStay = {
  id: string;
  locationId: string;
  location: { id: string; name: string };
  label: string | null;
  checkIn: string;
  checkOut: string;
  arrivalTime: string | null;
  departureTime: string | null;
  board: BoardType;
  headcount: number | null;
  costPerPersonPerNight: number | null;
  currency: string;
  priority: number;
  notes: string | null;
  booking: SerializedBooking | null;
};

type StayRow = Stay & {
  location: { id: string; name: string };
  booking: BookingRow | null;
};

export function serializeStay(stay: StayRow): SerializedStay {
  return {
    id: stay.id,
    locationId: stay.locationId,
    location: { id: stay.location.id, name: stay.location.name },
    label: stay.label,
    checkIn: toDateInput(stay.checkIn),
    checkOut: toDateInput(stay.checkOut),
    arrivalTime: stay.arrivalTime,
    departureTime: stay.departureTime,
    board: stay.board,
    headcount: stay.headcount,
    // Prisma Decimal → number at the server/client boundary (never pass Decimal).
    costPerPersonPerNight:
      stay.costPerPersonPerNight == null
        ? null
        : Number(stay.costPerPersonPerNight),
    currency: stay.currency,
    priority: stay.priority,
    notes: stay.notes,
    booking: stay.booking ? serializeBooking(stay.booking) : null,
  };
}
