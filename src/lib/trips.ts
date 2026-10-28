import type {
  BookingStatus,
  Booking,
  ItineraryDay,
  MealKind,
  MealProvision,
  Prisma,
  ScheduleItem,
  Stay,
  TravelMethod,
  Trip,
  TripStatus,
} from "@prisma/client";
import { toDateInput } from "@/lib/dates";
import { lodgingForDays } from "@/lib/stays";
import { serializePriceLines, type PriceLine } from "@/lib/costs";

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
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  CONFIRMED: "Confirmed",
  FINALIZED: "Finalized",
  CANCELLED: "Cancelled",
  NOT_NEEDED: "Not needed",
};

/** Every master status in display order: the ladder, then the two off it. */
export const BOOKING_STATUSES: BookingStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "CONFIRMED",
  "FINALIZED",
  "CANCELLED",
  "NOT_NEEDED",
];

/** The master-status ladder a booking climbs (workflow steps map onto it). */
export const BOOKING_STATUS_FLOW: BookingStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "CONFIRMED",
  "FINALIZED",
];

/**
 * Parse a `?status=` param ("IN_PROGRESS,CONFIRMED") into known statuses.
 * The pre-rename "PLANNED" still reads as PENDING so old links keep working.
 */
export function parseBookingStatuses(param: string | null | undefined): BookingStatus[] {
  if (!param) return [];
  const out = new Set<BookingStatus>();
  for (const raw of param.split(",")) {
    const v = raw.trim().toUpperCase();
    const s = (v === "PLANNED" ? "PENDING" : v) as BookingStatus;
    if (BOOKING_STATUSES.includes(s)) out.add(s);
  }
  return BOOKING_STATUSES.filter((s) => out.has(s));
}

/** How many rows sit at each master status (every status present, zeros included). */
export function countByStatus(rows: { status: BookingStatus }[]): Record<BookingStatus, number> {
  const counts = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, 0])) as Record<
    BookingStatus,
    number
  >;
  for (const r of rows) counts[r.status]++;
  return counts;
}

// Tailwind classes for a booking-status pill (matches Badge usage).
// PENDING is the neutral baseline, so it stays neutral: amber is reserved for
// "we must act" cues (Your move, stale, no price) and must not also mean
// "nothing done yet", or the alarm stops reading as one. IN_PROGRESS takes
// the palette's primary tint rather than an off-palette blue. FINALIZED is the
// solid form of CONFIRMED's emerald; CANCELLED is an outline so it reads apart
// from NOT_NEEDED's fill without borrowing the overdue red.
export const BOOKING_STATUS_CLASSES: Record<BookingStatus, string> = {
  PENDING: "bg-secondary text-secondary-foreground",
  IN_PROGRESS: "bg-primary/10 text-primary dark:bg-primary/20",
  CONFIRMED:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  FINALIZED: "bg-emerald-700 text-white dark:bg-emerald-600",
  CANCELLED: "border-border text-muted-foreground",
  NOT_NEEDED: "bg-muted text-muted-foreground",
};

export type BookingStatusVariant =
  | "planned"
  | "progress"
  | "confirmed"
  | "finalized"
  | "cancelled"
  | "muted";

/** The `<Badge variant>` for a booking status (same palette as BOOKING_STATUS_CLASSES). */
export function bookingStatusVariant(status: BookingStatus): BookingStatusVariant {
  switch (status) {
    case "PENDING":
      return "planned";
    case "IN_PROGRESS":
      return "progress";
    case "CONFIRMED":
      return "confirmed";
    case "FINALIZED":
      return "finalized";
    case "CANCELLED":
      return "cancelled";
    default:
      return "muted";
  }
}

/**
 * The substatus worth showing beside the master status: the workflow stage
 * (the latest step done), unless the booking is off the ladder (cancelled /
 * not needed — the stage is history then) or the stage just repeats the
 * master label.
 */
export function bookingSubstatus(b: {
  status: BookingStatus;
  stageLabel?: string | null;
}): string | null {
  if (b.status === "CANCELLED" || b.status === "NOT_NEEDED") return null;
  const stage = b.stageLabel?.trim();
  if (!stage || stage.toLowerCase() === BOOKING_STATUS_LABELS[b.status].toLowerCase())
    return null;
  return stage;
}

/**
 * What a booking's status reads as text: the master status, then its
 * workflow stage — "In progress · Availability confirmed". Off-ladder
 * statuses read alone.
 */
export function bookingStageText(b: {
  status: BookingStatus;
  stageLabel?: string | null;
}): string {
  const sub = bookingSubstatus(b);
  return sub
    ? `${BOOKING_STATUS_LABELS[b.status]} · ${sub}`
    : BOOKING_STATUS_LABELS[b.status];
}

// --- Serialization (Date → "yyyy-mm-dd" strings for Client Components) ---

// A venue's go-to person as itinerary surfaces show it. `email`/`role` ride
// along only where the page's query selected them (the staff day view).
export type PrimaryContactSummary = {
  name: string;
  phone: string | null;
  email?: string | null;
  role?: string | null;
};

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
    googlePlaceId?: string | null;
    lat?: number | null;
    lng?: number | null;
    primaryContact?: PrimaryContactSummary | null;
    // Staff day page only: the venue's standing schedule constraints.
    scheduleLimitations?: string | null;
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
  stageLabel: string | null;
  bookedContactId: string | null;
  bookedContact: SerializedPerson | null;
  confirmationRef: string | null;
  notes: string | null;
  // The itemized agreed price (empty when the query didn't load it).
  agreedCurrency: string;
  priceLines: PriceLine[];
};

export type SerializedItemPresentation = {
  id: string;
  title: string;
  defaultPresenters: SerializedPerson[];
};

// A travel span's client-safe shape (GH #80). Endpoints resolve to a display
// name via location ?? free-text label; stops are ordered.
export type SerializedTravelStop = {
  id: string;
  location: { id: string; name: string } | null;
  label: string | null;
  dwellMinutes: number | null;
  order: number;
};

export type SerializedTravelLeg = {
  id: string;
  method: TravelMethod;
  fromLocation: { id: string; name: string } | null;
  fromLabel: string | null;
  toLocation: { id: string; name: string } | null;
  toLabel: string | null;
  stops: SerializedTravelStop[];
};

export const TRAVEL_METHOD_LABELS: Record<TravelMethod, string> = {
  COACH: "Coach",
  TRAIN: "Train",
  FERRY: "Ferry",
  FLIGHT: "Flight",
  WALK: "Walk",
  TAXI: "Taxi",
  OTHER: "Travel",
};

/** Display name of a travel endpoint: catalogued location beats free text. */
export function travelEndpointName(
  location: { name: string } | null,
  label: string | null,
): string | null {
  return location?.name ?? label ?? null;
}

/** "Old Sarum → Bristol" (or just the known endpoint) — null when neither is set. */
export function travelRoute(travel: {
  fromLocation: { name: string } | null;
  fromLabel: string | null;
  toLocation: { name: string } | null;
  toLabel: string | null;
}): string | null {
  const from = travelEndpointName(travel.fromLocation, travel.fromLabel);
  const to = travelEndpointName(travel.toLocation, travel.toLabel);
  if (from && to) return `${from} → ${to}`;
  return to ?? from;
}

/**
 * "Old Sarum → Bristol · via M5 services (15 min)" — the route + stops line
 * under a travel row's heading. Null when the leg has no route and no stops.
 */
export function travelDetailLine(travel: SerializedTravelLeg): string | null {
  const stops = travel.stops
    .map((s) => {
      const name = s.location?.name ?? s.label;
      if (!name) return null;
      return s.dwellMinutes ? `${name} (${s.dwellMinutes} min)` : name;
    })
    .filter(Boolean);
  return (
    [travelRoute(travel), stops.length ? `via ${stops.join(", ")}` : null]
      .filter(Boolean)
      .join(" · ") || null
  );
}

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
  fixedTime: boolean; // times we don't control; shifts/reorders never move it
  room: string | null; // where within the venue ("Refectory")
  mealKind: MealKind | null; // set ⇒ a meal
  mealProvision: MealProvision | null;
  presentationId: string | null;
  presentation: SerializedItemPresentation | null;
  presenters: SerializedPerson[]; // per-occurrence override; empty ⇒ use presentation.defaultPresenters
  sites: SerializedItemLocation[];
  bookings: SerializedBooking[];
  // Set ⇒ this item is a travel span (GH #80). Optional so callers whose
  // queries don't load the relation stay valid; absent reads as "not travel".
  travel?: SerializedTravelLeg | null;
};

// The heading shown for a schedule item. Precedence:
//   1. an explicit title override on the item,
//   2. the linked talk's title,
//   3. a travel leg's derived label — "Coach to Bristol" (method + destination;
//      bare method label when the destination isn't set yet),
//   4. the category name, qualified by the venue(s) when placed — a bare "Visit"
//      is uninformative, so a located category-labelled item reads
//      "Visit: The Old Rectory" (self-describing kinds like Free time / Break are
//      location-less, so they stay bare),
//   5. with no category, the venue(s) themselves — or "Visit" when the caller
//      already shows the venue as the heading (`venueInHeading: false`, e.g. a
//      venue's session list),
//   6. the first line of the notes, else "Item" (an item must have a title or
//      a location, so this is only reachable for legacy rows).
// `presentationIsPrimary` is true when the talk title IS the heading, so callers
// avoid echoing it. `labelFromCategory` is true when the category name drives the
// heading, so callers drop the (now redundant) category chip and instead tint
// the label in the category colour. Surfaces that show the chip on every
// categorised item (the itinerary timeline + editor) pass `categoryChip`: the
// heading then never falls back to the category, so the chip is consistent.
export function scheduleItemPrimaryLabel(item: {
  title: string | null;
  presentation: { title: string } | null;
  category: { name: string } | null;
  notes?: string | null;
  sites?: { location: { name: string } }[];
  travel?: {
    method: TravelMethod;
    toLocation: { name: string } | null;
    toLabel: string | null;
  } | null;
}, opts: { venueInHeading?: boolean; categoryChip?: boolean } = {}): {
  primary: string;
  presentationIsPrimary: boolean;
  labelFromCategory: boolean;
} {
  const venueInHeading = opts.venueInHeading ?? true;
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
  if (item.travel) {
    const method = TRAVEL_METHOD_LABELS[item.travel.method];
    const to = travelEndpointName(item.travel.toLocation, item.travel.toLabel);
    return {
      primary: to ? `${method} to ${to}` : method,
      presentationIsPrimary: false,
      labelFromCategory: false,
    };
  }
  const venues = venueInHeading
    ? (item.sites ?? []).map((s) => s.location.name)
    : [];
  // A surface that always renders the category chip doesn't repeat it as
  // the heading: an untitled item reads as its chip alone.
  if (item.category && opts.categoryChip) {
    return { primary: "", presentationIsPrimary: false, labelFromCategory: false };
  }
  if (item.category) {
    return {
      primary: venues.length
        ? `${item.category.name}: ${venues.join(", ")}`
        : item.category.name,
      presentationIsPrimary: false,
      labelFromCategory: true,
    };
  }
  return {
    primary: venues.length
      ? venues.join(", ")
      : !venueInHeading
        ? "Visit"
        : item.notes?.split("\n")[0].trim() || "Item",
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
    googlePlaceId?: string | null;
    lat?: number | null;
    lng?: number | null;
    primaryContact?: PrimaryContactSummary | null;
    scheduleLimitations?: string | null;
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
      googlePlaceId: s.location.googlePlaceId,
      lat: s.location.lat,
      lng: s.location.lng,
      primaryContact: s.location.primaryContact,
      scheduleLimitations: s.location.scheduleLimitations,
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

// A rough-plan day-location assignment (GH #9): a location intended for the day
// with no timed schedule item.
export type SerializedPlannedLocation = {
  id: string;
  locationId: string;
  name: string;
  note: string | null;
  order: number;
};

export type SerializedDay = Omit<ItineraryDay, "date"> & {
  date: string | null;
  items: SerializedScheduleItem[];
  // Rough-plan cluster (GH #9). Optional so callers whose queries don't load the
  // relation (and hand-built fixtures) stay valid; absent reads as "none".
  plannedLocations?: SerializedPlannedLocation[];
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
    googlePlaceId?: string | null;
    lat?: number | null;
    lng?: number | null;
    primaryContact?: PrimaryContactSummary | null;
    scheduleLimitations?: string | null;
  };
};

type BookingRow = Booking & {
  bookedContact: { id: string; name: string } | null;
  // Optional: present only when the caller's query loaded PRICE_LINES_SELECT.
  priceLines?: Parameters<typeof serializePriceLines>[0];
};

type TravelLegRow = {
  id: string;
  method: TravelMethod;
  fromLocation: { id: string; name: string } | null;
  fromLabel: string | null;
  toLocation: { id: string; name: string } | null;
  toLabel: string | null;
  stops: {
    id: string;
    location: { id: string; name: string } | null;
    label: string | null;
    dwellMinutes: number | null;
    order: number;
  }[];
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
  // Optional: present only when the caller's query loaded the relation.
  travel?: TravelLegRow | null;
};

export function serializeBooking(b: BookingRow): SerializedBooking {
  return {
    id: b.id,
    scheduleItemId: b.scheduleItemId,
    tripId: b.tripId,
    locationId: b.locationId,
    label: b.label,
    status: b.status,
    stageLabel: b.stageLabel ?? null,
    bookedContactId: b.bookedContactId,
    bookedContact: b.bookedContact
      ? { id: b.bookedContact.id, name: b.bookedContact.name }
      : null,
    confirmationRef: b.confirmationRef,
    notes: b.notes,
    agreedCurrency: b.agreedCurrency,
    priceLines: serializePriceLines(b.priceLines ?? []),
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
    fixedTime: item.fixedTime,
    room: item.room ?? null,
    mealKind: item.mealKind ?? null,
    mealProvision: item.mealProvision ?? null,
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
          ...(s.location.googlePlaceId !== undefined
            ? {
                googlePlaceId: s.location.googlePlaceId,
                lat: s.location.lat ?? null,
                lng: s.location.lng ?? null,
              }
            : {}),
          ...(s.location.primaryContact !== undefined
            ? { primaryContact: s.location.primaryContact }
            : {}),
          ...(s.location.scheduleLimitations !== undefined
            ? { scheduleLimitations: s.location.scheduleLimitations }
            : {}),
        },
      })),
    bookings: item.bookings.map(serializeBooking),
    travel:
      item.travel === undefined
        ? undefined
        : item.travel && {
            id: item.travel.id,
            method: item.travel.method,
            fromLocation: item.travel.fromLocation,
            fromLabel: item.travel.fromLabel,
            toLocation: item.travel.toLocation,
            toLabel: item.travel.toLabel,
            stops: [...item.travel.stops]
              .sort((a, b) => a.order - b.order)
              .map((s) => ({
                id: s.id,
                location: s.location,
                label: s.label,
                dwellMinutes: s.dwellMinutes,
                order: s.order,
              })),
          },
  };
}

// The Prisma include every item query that renders travel needs — spread as
// `travel: TRAVEL_LEG_INCLUDE` next to `sites`/`bookings`.
export const TRAVEL_LEG_INCLUDE = {
  include: {
    fromLocation: { select: { id: true, name: true } },
    toLocation: { select: { id: true, name: true } },
    stops: {
      orderBy: { order: "asc" },
      include: { location: { select: { id: true, name: true } } },
    },
  },
} satisfies Prisma.ScheduleItem$travelArgs;

// The Prisma include every day query needs to render the rough-plan cluster (GH
// #9) — spread as `plannedLocations: PLANNED_LOCATIONS_INCLUDE` next to
// `scheduleItems` under a day's include.
export const PLANNED_LOCATIONS_INCLUDE = {
  orderBy: { order: "asc" },
  include: { location: { select: { name: true } } },
} satisfies Prisma.ItineraryDay$plannedLocationsArgs;

// The relational shape for a rough-plan assignment (a subset of the Prisma row).
type PlannedLocationRow = {
  id: string;
  locationId: string;
  note: string | null;
  order: number;
  location: { name: string };
};

export function serializeDay(
  day: ItineraryDay & {
    scheduleItems: ScheduleItemWithRelations[];
    // Optional: present only when the caller's query loaded the relation.
    plannedLocations?: PlannedLocationRow[];
  },
): SerializedDay {
  // The raw relations stay out of the spread: they'd ride into the RSC payload
  // un-serialized (e.g. booking price-line Decimals, which can't cross).
  const { scheduleItems, plannedLocations, ...rest } = day;
  return {
    ...rest,
    date: day.date ? toDateInput(day.date) : null,
    items: scheduleItems.map(serializeScheduleItem),
    plannedLocations: (plannedLocations ?? []).map((p) => ({
      id: p.id,
      locationId: p.locationId,
      name: p.location.name,
      note: p.note,
      order: p.order,
    })),
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
  // The parent venue whose engagement covers this lodging, when the stay's
  // location is booked via one (null otherwise).
  bookedVia: { id: string; name: string } | null;
};

type StayRow = Stay & {
  location: {
    id: string;
    name: string;
    bookedVia?: { id: string; name: string } | null;
  };
};

// A compact, client-safe summary of the night's lodging for a single day — what
// the itinerary read views show as the "overnight" line (GH #15).
export type DayLodgingSummary = {
  locationName: string;
  // The venue's id when the caller's query selected it — app surfaces link
  // the overnight line through to the venue's booking row with it.
  locationId?: string | null;
};

type LodgingStayRow = {
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDayIndex?: number | null;
  checkOutDayIndex?: number | null;
  priority?: number;
  location: { id?: string; name: string };
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
    out[id] = s
      ? { locationName: s.location.name, locationId: s.location.id ?? null }
      : null;
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
    bookedVia: stay.location.bookedVia
      ? { id: stay.location.bookedVia.id, name: stay.location.bookedVia.name }
      : null,
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
