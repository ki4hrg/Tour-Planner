import type {
  BookingStatus,
  Cost,
  CostUnit,
  Payment,
  PaymentScheduleItem,
  TravelMethod,
} from "@prisma/client";
import { toDateInput, todayUtc } from "./dates";
import { bookingWindow, bookingNeedsInfo, earliestCoveredDate } from "./booking";
import {
  resolveSchedule,
  scheduleAttention,
  serializeInstallment,
  type ResolvedInstallment,
} from "./payment-schedule";
import {
  serializeCost,
  serializePayment,
  isCostStale,
  type SerializedCost,
  type SerializedPayment,
} from "./money";
import { agreedTotal as resolveAgreedTotal } from "./costs";
import { scheduleItemPrimaryLabel } from "./trips";
import { stayNights } from "./stays";
import { progressView, type BookingProgressView } from "./booking-workflow";
import { bookedViaMap, engagementLocationId } from "./booked-via";

// Serialized, client-safe rows for the booking dashboard. A "venue" row is the
// single engagement for a (trip, location) — it auto-covers every schedule item the
// trip runs at that location plus any lodging there. An "item" row is a site-less
// booking (e.g. a coach) tied to one schedule item. A site booked via a parent
// venue (`Location.bookedViaId`) folds into the PARENT's row: its sessions and
// nights are covered by the parent's engagement, each labelled with the site.

export type CoveredSession = {
  id: string;
  dayId: string | null; // links the session to its day view
  dayIndex: number;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  label: string;
  // A rough-plan day assignment (GH #9), not a timed schedule item — the venue
  // is on the itinerary but the visit has no slot yet.
  planned?: boolean;
};

export type VenueBookingRow = {
  kind: "venue";
  locationId: string;
  locationName: string;
  bookable: boolean; // false = walk-by stop; never booked, no status control
  bookingId: string | null; // null until the engagement is first created
  status: BookingStatus;
  progress: BookingProgressView; // workflow state for the status control
  label: string | null;
  confirmationRef: string | null;
  notes: string | null;
  bookedContactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  sessions: CoveredSession[];
  nightCount: number;
  costs: SerializedCost[];
  bookedOn: string | null; // planner-set booking date (anchors BOOKING installments)
  // The engagement's negotiated price + payment log. `agreedAmount` is the
  // stored figure — a per-person RATE when `agreedUnit` is PER_PERSON; the
  // balance, settled state and schedule run off `agreedTotal` (rate × headcount
  // for per person, else the amount itself; null when a per-person rate has no
  // headcount to multiply). `unpaidBalance` is null until that total is known;
  // `settled` means payments cover it.
  agreedAmount: number | null;
  agreedCurrency: string;
  agreedUnit: CostUnit | null;
  agreedTotal: number | null;
  headcount: number | null; // trip participants ?? capacity
  payments: SerializedPayment[];
  paidTotal: number;
  unpaidBalance: number | null;
  settled: boolean;
  // Payment schedule (GH #51), resolved against the agreed price + payment log.
  schedule: ResolvedInstallment[];
  overdueAmount: number; // outstanding across past-due installments (0 = none)
  nextDue: ResolvedInstallment | null;
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
  progress: BookingProgressView;
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
  // Travel leg (GH #80) — feeds the row label ("Coach to Bristol") for a
  // site-less booking on a travel item; optional so callers whose queries
  // don't load it stay valid.
  travel?: {
    method: TravelMethod;
    toLocation: { name: string } | null;
    toLabel: string | null;
  } | null;
  sites: { locationId: string }[];
  bookings: (ProgressInput & {
    id: string;
    label: string | null;
    confirmationRef: string | null;
    bookedContact: { name: string } | null;
  })[];
};

// Workflow fields (BOOKING_PROGRESS_SELECT); optional so callers that don't
// load them still build rows (the control then shows the coarse status).
type ProgressInput = {
  status: BookingStatus;
  stageLabel?: string | null;
  stageOn?: Date | null;
  workflowId?: string | null;
  stepCompletions?: { stepId: string; completedOn: Date }[];
};

const toProgress = (b: ProgressInput | null, locationDefault?: string | null) =>
  progressView(
    b && {
      status: b.status,
      stageLabel: b.stageLabel ?? null,
      stageOn: b.stageOn ?? null,
      workflowId: b.workflowId ?? null,
      stepCompletions: b.stepCompletions,
    },
    locationDefault,
  );

type DayInput = {
  id?: string;
  dayIndex: number;
  date: Date | null;
  scheduleItems: ItemInput[];
  // Rough-plan day locations (GH #9): a venue on the itinerary before it has a
  // timed slot still surfaces as an engagement to start booking.
  plannedLocations?: { locationId: string }[];
};

type EngagementInput = ProgressInput & {
  id: string;
  locationId: string | null;
  label: string | null;
  confirmationRef: string | null;
  notes: string | null;
  bookedContactId: string | null;
  bookedContact: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
  } | null;
  // Anchor date for BOOKING-relative installments (GH #86); resolution uses
  // bookedOn ?? createdAt.
  bookedOn?: Date | null;
  createdAt?: Date | null;
  // Prisma Decimal (or already-numeric) — flattened to number in the row.
  agreedAmount?: Payment["amount"] | number | null;
  agreedCurrency?: string;
  agreedUnit?: CostUnit | null;
  payments?: Payment[];
  paymentSchedule?: PaymentScheduleItem[];
};

// checkIn/checkOut are null on a date-less template stay (day-relative anchors);
// such a stay adds 0 nights and no dates to the engagement below.
type StayInput = {
  locationId: string;
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDayIndex?: number | null;
  checkOutDayIndex?: number | null;
};

type LocationInput = {
  id: string;
  name: string;
  // Booked via a parent venue; the parent must be in `locations` too (load
  // with `withBookedViaParentsWhere`) or the site keeps its own row.
  bookedViaId?: string | null;
  bookable: boolean;
  defaultWorkflowId?: string | null;
  bookingOpensLeadDays: number | null;
  costs: Cost[];
};

export type DashboardData = {
  days: DayInput[];
  engagements: EngagementInput[];
  stays: StayInput[];
  locations: LocationInput[];
  // Anchors EVENT_START payment installments (offset counts back from this);
  // null (template / undated trip) leaves those installments "unscheduled".
  tripStartDate?: Date | null;
  // Multiplies PER_PERSON agreed prices (`tripHeadcount(trip)`); null/absent
  // leaves a per-person total unknown.
  headcount?: number | null;
};

type VenueAccum = {
  sessions: CoveredSession[];
  dates: Date[];
  nights: number;
  // `${dayIndex}:${siteId}` already covered by a timed session, and item ids
  // already listed (a block visiting parent + child counts once).
  siteDays: Set<string>;
  itemIds: Set<string>;
};

/**
 * Build the dashboard's venue-engagement rows and site-less item-booking rows from
 * raw trip data. Pure over its inputs except for `bookingWindow` and the payment-
 * schedule due/overdue states, which read "now" (isolated in lib, never in render).
 * Reused by the single-trip dashboard and the multi-year grid.
 */
export function buildDashboardRows(data: DashboardData): {
  venueRows: VenueBookingRow[];
  itemRows: ItemBookingRow[];
} {
  const locById = new Map(data.locations.map((l) => [l.id, l]));
  // Child site → the parent whose engagement covers it (parent must be loaded).
  const viaMap = bookedViaMap(
    data.locations.filter((l) => l.bookedViaId && locById.has(l.bookedViaId)),
  );
  const venueOf = (siteId: string) => engagementLocationId(siteId, viaMap);
  // Under a parent's heading, a child's session names its site.
  const withSite = (label: string, siteId: string, venueId: string) =>
    siteId === venueId
      ? label
      : `${label} · ${locById.get(siteId)?.name ?? "Unknown location"}`;
  const engByLoc = new Map<string, EngagementInput>();
  for (const e of data.engagements) {
    if (e.locationId) engByLoc.set(e.locationId, e);
  }

  const venues = new Map<string, VenueAccum>();
  const ensure = (locationId: string): VenueAccum => {
    let v = venues.get(locationId);
    if (!v) {
      v = {
        sessions: [],
        dates: [],
        nights: 0,
        siteDays: new Set(),
        itemIds: new Set(),
      };
      venues.set(locationId, v);
    }
    return v;
  };

  // Sessions: every schedule item visiting a location is covered by that venue.
  const itemRows: ItemBookingRow[] = [];
  for (const day of data.days) {
    for (const item of day.scheduleItems) {
      // The venue is already this row's heading, so keep the session label bare
      // ("Visit", not "Visit: The Old Rectory").
      const sessionLabel = scheduleItemPrimaryLabel(
        { ...item, sites: [] },
        { venueInHeading: false },
      ).primary;
      const label = scheduleItemPrimaryLabel({ ...item, sites: [] }).primary;
      for (const site of item.sites) {
        const venueId = venueOf(site.locationId);
        const v = ensure(venueId);
        v.siteDays.add(`${day.dayIndex}:${site.locationId}`);
        if (v.itemIds.has(item.id)) continue;
        v.itemIds.add(item.id);
        v.sessions.push({
          id: item.id,
          dayId: day.id ?? null,
          dayIndex: day.dayIndex,
          date: day.date ? toDateInput(day.date) : null,
          startTime: item.startTime,
          endTime: item.endTime,
          label: withSite(sessionLabel, site.locationId, venueId),
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
          progress: toProgress(b),
          confirmationRef: b.confirmationRef,
          contactName: b.bookedContact?.name ?? null,
          dayIndex: day.dayIndex,
          date: day.date ? toDateInput(day.date) : null,
        });
      }
    }
    // Planned visits: one untimed session per (day, site) the day's schedule
    // doesn't already cover.
    for (const p of day.plannedLocations ?? []) {
      const venueId = venueOf(p.locationId);
      const v = ensure(venueId);
      const key = `${day.dayIndex}:${p.locationId}`;
      if (v.siteDays.has(key)) continue;
      v.siteDays.add(key);
      v.sessions.push({
        id: `planned:${day.dayIndex}:${p.locationId}`,
        dayId: day.id ?? null,
        dayIndex: day.dayIndex,
        date: day.date ? toDateInput(day.date) : null,
        startTime: null,
        endTime: null,
        label: withSite("Planned", p.locationId, venueId),
        planned: true,
      });
      if (day.date) v.dates.push(day.date);
    }
  }

  // Stays: lodging at a location folds into that venue's engagement.
  for (const stay of data.stays) {
    const v = ensure(venueOf(stay.locationId));
    v.nights += stayNights(stay);
    if (stay.checkIn) v.dates.push(stay.checkIn);
  }

  // Engagements with no remaining itinerary/lodging coverage still surface.
  for (const e of data.engagements) {
    if (e.locationId) ensure(e.locationId);
  }

  const venueRows: VenueBookingRow[] = [];
  const today = todayUtc();
  for (const [locationId, v] of venues) {
    const loc = locById.get(locationId);
    const eng = engByLoc.get(locationId) ?? null;
    const bookable = loc?.bookable ?? true;
    const costs = (loc?.costs ?? []).map(serializeCost);
    // The agreed price settles the "what does this cost" question outright; only
    // without one does the (possibly stale) catalog price leave the row "missing".
    const agreedAmount =
      eng?.agreedAmount == null ? null : Number(eng.agreedAmount);
    const headcount = data.headcount ?? null;
    const agreedTotal = resolveAgreedTotal(
      { agreedAmount, agreedUnit: eng?.agreedUnit ?? null },
      headcount,
    );
    const payments = (eng?.payments ?? []).map(serializePayment);
    const paidTotal = payments.reduce((sum, p) => sum + p.amount, 0);
    const unpaidBalance =
      agreedTotal == null ? null : Math.max(0, agreedTotal - paidTotal);
    const schedule = resolveSchedule(
      (eng?.paymentSchedule ?? []).map(serializeInstallment),
      {
        agreedAmount: agreedTotal,
        paidTotal,
        tripStartDate: data.tripStartDate ?? null,
        bookingDate: eng?.bookedOn ?? eng?.createdAt ?? null,
        today,
      },
    );
    const { overdueAmount, nextDue } = scheduleAttention(schedule);
    const isMissingCost =
      agreedAmount == null &&
      ((loc?.costs.length ?? 0) === 0 ||
        (loc?.costs.every((c) => isCostStale(c.confirmedAt)) ?? true));
    // A planned (untimed) visit is a rough plan, not missing information.
    const isMissingTime = v.sessions.some(
      (s) => !s.planned && !s.startTime && !s.endTime,
    );

    const earliest = earliestCoveredDate(v.dates);
    const win = bookingWindow(earliest, loc?.bookingOpensLeadDays ?? null);
    const status: BookingStatus = eng?.status ?? "PLANNED";
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
      progress: toProgress(eng, loc?.defaultWorkflowId),
      label: eng?.label ?? null,
      confirmationRef: eng?.confirmationRef ?? null,
      notes: eng?.notes ?? null,
      bookedContactId: eng?.bookedContactId ?? null,
      contactName: eng?.bookedContact?.name ?? null,
      contactPhone: eng?.bookedContact?.phone ?? null,
      contactEmail: eng?.bookedContact?.email ?? null,
      bookedOn: eng?.bookedOn ? toDateInput(eng.bookedOn) : null,
      sessions: v.sessions,
      nightCount: v.nights,
      costs,
      agreedAmount,
      agreedCurrency: eng?.agreedCurrency ?? "USD",
      agreedUnit: eng?.agreedUnit ?? null,
      agreedTotal,
      headcount,
      payments,
      paidTotal,
      unpaidBalance,
      settled: agreedTotal != null && paidTotal >= agreedTotal,
      schedule,
      overdueAmount: inPlay ? overdueAmount : 0,
      nextDue,
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
          paymentOverdue: overdueAmount > 0,
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
