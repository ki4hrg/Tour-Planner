import type {
  BookingStatus,
  Booking,
  ItineraryDay,
  Prisma,
  ScheduleItem,
  Stay,
  Trip,
  TripStatus,
} from "@prisma/client";
import { toDateInput } from "@/lib/dates";
import { lodgingForDays } from "@/lib/stays";

// The STORED status is a manual override only; the day-to-day lifecycle
// (Planning → In progress → Complete) is derived from dates — see
// deriveTripLifecycle below.
export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  ACTIVE: "Active",
  ARCHIVED: "Archived",
  CANCELLED: "Cancelled",
};

export const TRIP_STATUSES = Object.keys(TRIP_STATUS_LABELS) as TripStatus[];

// What a trip reads as today: derived phases for ACTIVE trips, or the manual
// override verbatim.
export type TripLifecycle =
  | "PLANNING"
  | "IN_PROGRESS"
  | "COMPLETE"
  | "ARCHIVED"
  | "CANCELLED";

export const TRIP_LIFECYCLE_LABELS: Record<TripLifecycle, string> = {
  PLANNING: "Planning",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
  ARCHIVED: "Archived",
  CANCELLED: "Cancelled",
};

export const TRIP_LIFECYCLES = Object.keys(
  TRIP_LIFECYCLE_LABELS,
) as TripLifecycle[];

/**
 * Derive what phase a trip is in on `today` (a date-only UTC Date — pass
 * `todayUtc()`; the caller supplies it so this stays a pure helper). Date-less
 * trips are Planning forever; a trip with only a start date is treated as
 * single-day (mirrors `isOngoing`).
 */
export function deriveTripLifecycle(
  trip: { status: TripStatus; startDate: Date | null; endDate: Date | null },
  today: Date,
): TripLifecycle {
  if (trip.status !== "ACTIVE") return trip.status;
  if (!trip.startDate || trip.startDate.getTime() > today.getTime())
    return "PLANNING";
  const end = trip.endDate ?? trip.startDate;
  return end.getTime() < today.getTime() ? "COMPLETE" : "IN_PROGRESS";
}

/**
 * Prisma where-clause matching trips whose derived lifecycle (per
 * `deriveTripLifecycle` with the same `today`) is `lifecycle`.
 */
export function tripLifecycleWhere(
  lifecycle: TripLifecycle,
  today: Date,
): Prisma.TripWhereInput {
  switch (lifecycle) {
    case "ARCHIVED":
    case "CANCELLED":
      return { status: lifecycle };
    case "PLANNING":
      return {
        status: "ACTIVE",
        OR: [{ startDate: null }, { startDate: { gt: today } }],
      };
    case "IN_PROGRESS":
      return {
        status: "ACTIVE",
        startDate: { lte: today },
        OR: [{ endDate: { gte: today } }, { endDate: null, startDate: today }],
      };
    case "COMPLETE":
      return {
        status: "ACTIVE",
        OR: [
          { endDate: { lt: today } },
          { endDate: null, startDate: { lt: today } },
        ],
      };
  }
}

/**
 * Where-clause for trips still in play (derived Planning or In progress) —
 * the complement of COMPLETE among ACTIVE trips.
 */
export function tripStillInPlayWhere(today: Date): Prisma.TripWhereInput {
  return {
    status: "ACTIVE",
    OR: [
      { endDate: { gte: today } },
      { endDate: null, startDate: { gte: today } },
      { startDate: null },
    ],
  };
}

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  NOT_BOOKED: "Not booked",
  REQUESTED: "Requested",
  TENTATIVELY_CONFIRMED: "Tentatively confirmed",
  CONFIRMED: "Confirmed",
  FINALIZED: "Finalized",
  NOT_NEEDED: "Not needed",
};

export const BOOKING_STATUSES = Object.keys(
  BOOKING_STATUS_LABELS,
) as BookingStatus[];

// Tailwind classes for a booking-status pill (matches Badge usage).
export const BOOKING_STATUS_CLASSES: Record<BookingStatus, string> = {
  NOT_BOOKED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  REQUESTED: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  TENTATIVELY_CONFIRMED:
    "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  CONFIRMED:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  FINALIZED: "bg-emerald-600 text-white dark:bg-emerald-700 dark:text-emerald-50",
  NOT_NEEDED: "bg-muted text-muted-foreground",
};

// --- Serialization (Date → "yyyy-mm-dd" strings for Client Components) ---

// mapUrl/primaryContact are only loaded (and serialized) on staff surfaces that
// need them (the day view); they must never reach the public share page — see
// redactDaysForShare, which strips them defensively.
export type SerializedItemLocation = {
  id: string;
  locationId: string;
  order: number;
  location: {
    id: string;
    name: string;
    mapUrl?: string | null;
    primaryContact?: { name: string; phone: string | null } | null;
  };
};

export type SerializedPerson = { id: string; name: string };

export type SerializedBooking = {
  id: string;
  scheduleItemId: string | null;
  tripId: string | null;
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

// The heading shown for a schedule item. Precedence:
//   1. an explicit title override on the item,
//   2. the linked talk's title,
//   3. the category name, qualified by the venue(s) when placed — a bare "Visit"
//      is uninformative, so a located category-labelled item reads
//      "Visit: The Old Rectory" (self-describing kinds like Free time / Break are
//      location-less, so they stay bare),
//   4. "Untitled item".
// `presentationIsPrimary` is true when the talk title IS the heading, so callers
// avoid echoing it. `labelFromCategory` is true when the category name drives the
// heading, so callers drop the (now redundant) category chip and instead tint
// the label in the category colour.
export function scheduleItemPrimaryLabel(item: {
  title: string | null;
  presentation: { title: string } | null;
  category: { name: string } | null;
  sites?: { location: { name: string } }[];
}): {
  primary: string;
  presentationIsPrimary: boolean;
  labelFromCategory: boolean;
} {
  if (item.title) {
    return {
      primary: item.title,
      presentationIsPrimary: false,
      labelFromCategory: false,
    };
  }
  if (item.presentation) {
    return {
      primary: item.presentation.title,
      presentationIsPrimary: true,
      labelFromCategory: false,
    };
  }
  if (item.category) {
    const venues = (item.sites ?? []).map((s) => s.location.name);
    return {
      primary: venues.length
        ? `${item.category.name}: ${venues.join(", ")}`
        : item.category.name,
      presentationIsPrimary: false,
      labelFromCategory: true,
    };
  }
  return {
    primary: "Untitled item",
    presentationIsPrimary: false,
    labelFromCategory: false,
  };
}

// A run of consecutive (time-ordered) items sharing the same venue signature.
// `kind`: 'single' = one venue, 'multi' = a multi-site / block stop, 'none' = no
// location set. Read views render one subheader per run so location appears once;
// venues carry their location id so app surfaces can link through to the venue page.
export type VenueRun = {
  kind: "single" | "multi" | "none";
  venues: {
    id: string;
    name: string;
    mapUrl?: string | null;
    primaryContact?: { name: string; phone: string | null } | null;
  }[];
  items: SerializedScheduleItem[];
};

// Walk items in their given (chronological) order and segment them into venue
// runs: a new run starts whenever the venue signature changes from the previous
// venue item. The same venue revisited after leaving (Sarum → Cathedral → Sarum)
// yields a fresh run, keeping the timeline in true time order.
//
// Location-less categories that read as "still here" and so fold into the
// current single-venue run rather than breaking out — e.g. an on-site Break.
// Free time is deliberately excluded: it implies leaving (be back before the
// next event), so it always stands apart as its own group.
const KEEPS_PLACE_CATEGORIES = new Set<string>(["Break"]);

// Segment a day's (chronological) items into venue runs. A located item starts a
// new run when its venue signature differs from the current run's; the same venue
// revisited later (Sarum → Cathedral → Sarum) yields a fresh run.
//
// Location-less items default to their own headerless run (Free time, transit) so
// they read as a departure from the venue. The exception is "keeps-place" kinds
// (Break): an on-site pause folds back into a preceding single-venue run. Nothing
// location-less ever tucks under a multi-site / block run.
export function groupItemsByVenue(items: SerializedScheduleItem[]): VenueRun[] {
  const runs: VenueRun[] = [];
  const sigOf = (venues: { id: string }[]) =>
    venues
      .map((v) => v.id)
      .sort()
      .join("|");
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (item.sites.length === 0) {
      const keepsPlace =
        !!item.category && KEEPS_PLACE_CATEGORIES.has(item.category.name);
      if (keepsPlace && last && last.kind === "single") {
        last.items.push(item);
      } else if (last && last.kind === "none") {
        last.items.push(item);
      } else {
        runs.push({ kind: "none", venues: [], items: [item] });
      }
      continue;
    }
    const venues = item.sites.map((s) => ({
      id: s.location.id,
      name: s.location.name,
      mapUrl: s.location.mapUrl,
      primaryContact: s.location.primaryContact,
    }));
    if (last && last.venues.length > 0 && sigOf(last.venues) === sigOf(venues)) {
      last.items.push(item);
      continue;
    }
    runs.push({
      kind: item.sites.length === 1 ? "single" : "multi",
      venues,
      items: [item],
    });
  }
  return runs;
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
  location: {
    id: string;
    name: string;
    mapUrl?: string | null;
    primaryContact?: { name: string; phone: string | null } | null;
  };
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
    tripId: b.tripId,
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
          // Staff-only extras, present only when the caller's query loaded them.
          ...(s.location.mapUrl !== undefined ? { mapUrl: s.location.mapUrl } : {}),
          ...(s.location.primaryContact !== undefined
            ? { primaryContact: s.location.primaryContact }
            : {}),
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
  // A stay is anchored EITHER by calendar dates (dated trip) or 1-based day
  // indices (date-less template). Exactly one pair is populated; the other is null.
  checkIn: string | null;
  checkOut: string | null;
  checkInDayIndex: number | null;
  checkOutDayIndex: number | null;
  arrivalTime: string | null;
  departureTime: string | null;
  headcount: number | null;
  costPerPersonPerNight: number | null;
  currency: string;
  priority: number;
  notes: string | null;
  // The venue-engagement booking covering this stay's location (resolved by the
  // caller from the trip's engagements), or null. Lodging no longer owns a booking.
  booking: SerializedBooking | null;
};

type StayRow = Stay & {
  location: { id: string; name: string };
};

// A compact, client-safe summary of the night's lodging for a single day — what
// the itinerary read views show as the "overnight" line (GH #15).
export type DayLodgingSummary = {
  locationName: string;
};

type LodgingStayRow = {
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDayIndex?: number | null;
  checkOutDayIndex?: number | null;
  priority?: number;
  location: { name: string };
};

/**
 * Map each day id to a serializable summary of where the group sleeps that
 * night (or null). Computed from raw Prisma rows (Date-typed), so call it before
 * serializing days. Pairs with `lodgingForDays` in `lib/stays.ts`.
 */
export function summarizeDayLodging(
  days: { id: string; date: Date | null; dayIndex?: number }[],
  stays: LodgingStayRow[],
): Record<string, DayLodgingSummary | null> {
  const byDay = lodgingForDays(days, stays);
  const out: Record<string, DayLodgingSummary | null> = {};
  for (const [id, s] of byDay) {
    out[id] = s ? { locationName: s.location.name } : null;
  }
  return out;
}

export function serializeStay(
  stay: StayRow,
  // The venue-engagement booking for this stay's location, if any (looked up by
  // the caller via `bookingsByLocation`). Lodging no longer carries its own booking.
  booking: SerializedBooking | null = null,
): SerializedStay {
  return {
    id: stay.id,
    locationId: stay.locationId,
    location: { id: stay.location.id, name: stay.location.name },
    // toDateInput returns "" for null; normalize to null so the client can tell
    // "no date" (template stay) from an empty string.
    checkIn: stay.checkIn ? toDateInput(stay.checkIn) : null,
    checkOut: stay.checkOut ? toDateInput(stay.checkOut) : null,
    checkInDayIndex: stay.checkInDayIndex,
    checkOutDayIndex: stay.checkOutDayIndex,
    arrivalTime: stay.arrivalTime,
    departureTime: stay.departureTime,
    headcount: stay.headcount,
    // Prisma Decimal → number at the server/client boundary (never pass Decimal).
    costPerPersonPerNight:
      stay.costPerPersonPerNight == null
        ? null
        : Number(stay.costPerPersonPerNight),
    currency: stay.currency,
    priority: stay.priority,
    notes: stay.notes,
    booking,
  };
}

/**
 * Index a trip's venue-engagement bookings (tripId + locationId set) by location
 * id, so an item/stay can resolve the single booking covering its venue. Site-less
 * item bookings (no locationId) are skipped.
 */
export function bookingsByLocation(
  bookings: SerializedBooking[],
): Map<string, SerializedBooking> {
  const map = new Map<string, SerializedBooking>();
  for (const b of bookings) {
    if (b.tripId && b.locationId) map.set(b.locationId, b);
  }
  return map;
}
