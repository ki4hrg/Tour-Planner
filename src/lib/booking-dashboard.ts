import type { BookingStatus, Cost } from "@prisma/client";
import { toDateInput } from "./dates";
import { bookingWindow, bookingNeedsInfo, earliestCoveredDate } from "./booking";
import { serializeCost, isCostStale, type SerializedCost } from "./money";
import { scheduleItemPrimaryLabel } from "./trips";
import { nightsBetween } from "./stays";

// Serialized, client-safe rows for the booking dashboard. A "venue" row is the
// single engagement for a (trip, location) — it auto-covers every schedule item the
// trip runs at that location plus any lodging there. An "item" row is a site-less
// booking (e.g. a coach) tied to one schedule item.

export type CoveredSession = {
  id: string;
  dayIndex: number;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  label: string;
};

export type VenueBookingRow = {
  kind: "venue";
  locationId: string;
  locationName: string;
  bookable: boolean; // false = walk-by stop; never booked, no status control
  bookingId: string | null; // null until the engagement is first created
  status: BookingStatus;
  label: string | null;
  confirmationRef: string | null;
  notes: string | null;
  bookedContactId: string | null;
  contactName: string | null;
  sessions: CoveredSession[];
  nightCount: number;
  costs: SerializedCost[];
  earliest: string | null;
  open: boolean;
  daysUntilOpen: number | null;
  isMissingCost: boolean;
  isMissingTime: boolean;
  needsInfo: boolean;
};

export type ItemBookingRow = {
  kind: "item";
  bookingId: string;
  label: string;
  status: BookingStatus;
  confirmationRef: string | null;
  contactName: string | null;
  dayIndex: number;
  date: string | null;
};

// --- raw (Prisma) input shapes the builder consumes ---

type ItemInput = {
  id: string;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  category: { name: string } | null;
  presentation: { title: string } | null;
  sites: { locationId: string }[];
  bookings: {
    id: string;
    label: string | null;
    status: BookingStatus;
    confirmationRef: string | null;
    bookedContact: { name: string } | null;
  }[];
};

type DayInput = { dayIndex: number; date: Date | null; scheduleItems: ItemInput[] };

type EngagementInput = {
  id: string;
  locationId: string | null;
  label: string | null;
  status: BookingStatus;
  confirmationRef: string | null;
  notes: string | null;
  bookedContactId: string | null;
  bookedContact: { id: string; name: string } | null;
};

type StayInput = { locationId: string; checkIn: Date; checkOut: Date };

type LocationInput = {
  id: string;
  name: string;
  bookable: boolean;
  bookingOpensLeadDays: number | null;
  costs: Cost[];
};

export type DashboardData = {
  days: DayInput[];
  engagements: EngagementInput[];
  stays: StayInput[];
  locations: LocationInput[];
};

type VenueAccum = { sessions: CoveredSession[]; dates: Date[]; nights: number };

/**
 * Build the dashboard's venue-engagement rows and site-less item-booking rows from
 * raw trip data. Pure over its inputs except for `bookingWindow`, which reads "now"
 * (isolated in lib, never in render). Reused by the single-trip dashboard and the
 * multi-year grid.
 */
export function buildDashboardRows(data: DashboardData): {
  venueRows: VenueBookingRow[];
  itemRows: ItemBookingRow[];
} {
  const locById = new Map(data.locations.map((l) => [l.id, l]));
  const engByLoc = new Map<string, EngagementInput>();
  for (const e of data.engagements) {
    if (e.locationId) engByLoc.set(e.locationId, e);
  }

  const venues = new Map<string, VenueAccum>();
  const ensure = (locationId: string): VenueAccum => {
    let v = venues.get(locationId);
    if (!v) {
      v = { sessions: [], dates: [], nights: 0 };
      venues.set(locationId, v);
    }
    return v;
  };

  // Sessions: every schedule item visiting a location is covered by that venue.
  const itemRows: ItemBookingRow[] = [];
  for (const day of data.days) {
    for (const item of day.scheduleItems) {
      // The venue is already this row's heading, so keep the session label bare
      // ("Visit", not "Visit: The Old Rectory") by folding in no sites.
      const label = scheduleItemPrimaryLabel({ ...item, sites: [] }).primary;
      for (const site of item.sites) {
        const v = ensure(site.locationId);
        v.sessions.push({
          id: item.id,
          dayIndex: day.dayIndex,
          date: day.date ? toDateInput(day.date) : null,
          startTime: item.startTime,
          endTime: item.endTime,
          label,
        });
        if (day.date) v.dates.push(day.date);
      }
      // Site-less / one-off item bookings stay their own rows.
      for (const b of item.bookings) {
        itemRows.push({
          kind: "item",
          bookingId: b.id,
          label: b.label ?? label,
          status: b.status,
          confirmationRef: b.confirmationRef,
          contactName: b.bookedContact?.name ?? null,
          dayIndex: day.dayIndex,
          date: day.date ? toDateInput(day.date) : null,
        });
      }
    }
  }

  // Stays: lodging at a location folds into that venue's engagement.
  for (const stay of data.stays) {
    const v = ensure(stay.locationId);
    v.nights += nightsBetween(stay.checkIn, stay.checkOut);
    v.dates.push(stay.checkIn);
  }

  // Engagements with no remaining itinerary/lodging coverage still surface.
  for (const e of data.engagements) {
    if (e.locationId) ensure(e.locationId);
  }

  const venueRows: VenueBookingRow[] = [];
  for (const [locationId, v] of venues) {
    const loc = locById.get(locationId);
    const eng = engByLoc.get(locationId) ?? null;
    const bookable = loc?.bookable ?? true;
    const costs = (loc?.costs ?? []).map(serializeCost);
    const isMissingCost =
      (loc?.costs.length ?? 0) === 0 ||
      (loc?.costs.every((c) => isCostStale(c.confirmedAt)) ?? true);
    const isMissingTime = v.sessions.some((s) => !s.startTime && !s.endTime);

    const earliest = earliestCoveredDate(v.dates);
    const win = bookingWindow(earliest, loc?.bookingOpensLeadDays ?? null);
    const status: BookingStatus = eng?.status ?? "NOT_BOOKED";
    // Not-bookable sites and ones deliberately marked "not needed" never need attention.
    const inPlay = bookable && status !== "NOT_NEEDED";

    v.sessions.sort(
      (a, b) =>
        a.dayIndex - b.dayIndex ||
        (a.startTime ?? "").localeCompare(b.startTime ?? ""),
    );

    venueRows.push({
      kind: "venue",
      locationId,
      locationName: loc?.name ?? "Unknown location",
      bookable,
      bookingId: eng?.id ?? null,
      status,
      label: eng?.label ?? null,
      confirmationRef: eng?.confirmationRef ?? null,
      notes: eng?.notes ?? null,
      bookedContactId: eng?.bookedContactId ?? null,
      contactName: eng?.bookedContact?.name ?? null,
      sessions: v.sessions,
      nightCount: v.nights,
      costs,
      earliest: win.earliest ? toDateInput(win.earliest) : null,
      open: win.open,
      daysUntilOpen: win.daysUntilOpen,
      isMissingCost,
      isMissingTime,
      needsInfo:
        inPlay &&
        bookingNeedsInfo({
          status,
          windowOpen: win.open,
          hasRef: Boolean(eng?.confirmationRef),
          isMissingCost,
          isMissingTime,
        }),
    });
  }

  // Earliest-bookable first (no window last), then alphabetical.
  venueRows.sort((a, b) => {
    if (a.earliest && b.earliest) return a.earliest.localeCompare(b.earliest);
    if (a.earliest) return -1;
    if (b.earliest) return 1;
    return a.locationName.localeCompare(b.locationName);
  });
  itemRows.sort((a, b) => a.dayIndex - b.dayIndex);

  return { venueRows, itemRows };
}
