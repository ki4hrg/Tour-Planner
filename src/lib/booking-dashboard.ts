import type {
  BookingStatus,
  Cost,
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
import {
  agreedTotal as resolveAgreedTotal,
  effectiveCosts,
  hasAgreedPrice,
  listPriceLines,
  serializePriceLines,
  type PriceLine,
} from "./costs";
import { scheduleItemPrimaryLabel } from "./trips";
import { stayNights } from "./stays";
import {
  progressView,
  waitingFromView,
  waitingView,
  type BookingProgressView,
  type WaitingView,
  type WorkflowStepLike,
} from "./booking-workflow";
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

// A stay covered by a venue's engagement (lodging there), as the row lists it.
export type CoveredStay = {
  id: string | null;
  checkIn: string | null; // "yyyy-mm-dd" (dated trip)
  checkOut: string | null;
  checkInDayIndex: number | null; // date-less template
  checkOutDayIndex: number | null;
  nights: number;
  // Named when the stay is at a site booked via this venue.
  siteName: string | null;
};

// Where a row's price comes from: the engagement's own agreed lines, the
// venue's list price (the default until one is agreed), or nothing.
export type PriceSource = "agreed" | "venue" | null;

// What kind of engagement a venue row mostly is — the Bookings tab groups by
// it. Lodging wins over sessions; sessions take their most common category.
export type VisitType = "Lodging" | "Planned" | string;

export type VenueBookingRow = {
  kind: "venue";
  locationId: string;
  locationName: string;
  // The venue's region (catalog), for grouping; null when unset / not loaded.
  regionName: string | null;
  visitType: VisitType;
  // The first itinerary day the venue is used on (sessions or lodging);
  // null when nothing is scheduled.
  firstDayIndex: number | null;
  bookable: boolean; // false = walk-by stop; never booked, no status control
  bookingId: string | null; // null until the engagement is first created
  status: BookingStatus;
  progress: BookingProgressView; // workflow state for the status control
  // Whose move it is (the upcoming workflow step + its owner), when the
  // caller passed `workflows`; null with no engagement yet, no workflow, or
  // nothing pending.
  waiting: WaitingView | null;
  label: string | null;
  confirmationRef: string | null;
  notes: string | null;
  bookedContactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  // The venue's standing booking notes + schedule constraints (Location
  // fields) — what to know before picking up the phone; null when unset.
  // Optional only so hand-built row fixtures elsewhere stay valid; the
  // builder always sets both.
  bookingNotes?: string | null;
  scheduleLimitations?: string | null;
  sessions: CoveredSession[];
  stays: CoveredStay[];
  nightCount: number;
  // The venue's list prices in force for this trip (its Cost catalog, the
  // lines valid on the trip's start date — `effectiveCosts`).
  costs: SerializedCost[];
  bookedOn: string | null; // planner-set booking date (anchors BOOKING installments)
  // The engagement's price. `priceLines` are the itemized AGREED price (the
  // per-trip override; empty until one is agreed). `effectiveLines` is what
  // the engagement is priced at: the agreed lines, else the venue's list
  // price (`priceSource` says which). The balance, settled state and schedule
  // run off `agreedTotal` — the effective lines' total: per-person sum ×
  // headcount + per-group sum; null with no lines, or per-person lines and no
  // headcount. `unpaidBalance` is null until that total is known; `settled`
  // means payments cover it.
  priceLines: PriceLine[];
  effectiveLines: PriceLine[];
  priceSource: PriceSource;
  agreedCurrency: string;
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
  waiting: WaitingView | null;
  confirmationRef: string | null;
  contactName: string | null;
  dayIndex: number;
  date: string | null;
  // Agreed price, same itemized shape as a venue engagement's.
  priceLines: PriceLine[];
  agreedCurrency: string;
  agreedTotal: number | null;
  headcount: number | null;
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
    // Optional so callers whose queries don't load the price stay valid.
    agreedCurrency?: string;
    priceLines?: PriceLineInput[];
  })[];
};

// A BookingPriceLine row (Decimal amount) — `PRICE_LINES_SELECT` in costs.ts.
type PriceLineInput = Parameters<typeof serializePriceLines>[0][number];

// Workflow fields (BOOKING_PROGRESS_SELECT); optional so callers that don't
// load them still build rows (the control then shows the coarse status).
type ProgressInput = {
  status: BookingStatus;
  stageLabel?: string | null;
  stageOn?: Date | null;
  workflowId?: string | null;
  stepCompletions?: { stepId: string; completedOn: Date }[];
  bookedOn?: Date | null;
  createdAt?: Date | null;
};

const toProgress = (
  b: ProgressInput | null,
  locationDefault: string | null | undefined,
  tripStartDate: Date | null | undefined,
) =>
  progressView(
    b && {
      status: b.status,
      stageLabel: b.stageLabel ?? null,
      stageOn: b.stageOn ?? null,
      workflowId: b.workflowId ?? null,
      stepCompletions: b.stepCompletions,
      bookedOn: b.bookedOn,
      createdAt: b.createdAt,
    },
    locationDefault,
    tripStartDate,
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
  // The itemized agreed price (Decimal amounts) — flattened in the row.
  agreedCurrency?: string;
  priceLines?: PriceLineInput[];
  payments?: Payment[];
  paymentSchedule?: PaymentScheduleItem[];
};

// checkIn/checkOut are null on a date-less template stay (day-relative anchors);
// such a stay adds 0 nights and no dates to the engagement below.
type StayInput = {
  id?: string;
  locationId: string;
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDayIndex?: number | null;
  checkOutDayIndex?: number | null;
};

type LocationInput = {
  id: string;
  name: string;
  // The venue's region, for grouping (optional: not every caller loads it).
  region?: { name: string } | null;
  // Booked via a parent venue; the parent must be in `locations` too (load
  // with `withBookedViaParentsWhere`) or the site keeps its own row.
  bookedViaId?: string | null;
  bookable: boolean;
  defaultWorkflowId?: string | null;
  bookingOpensLeadDays: number | null;
  // Optional so callers that don't load them (compare grid) stay valid.
  bookingNotes?: string | null;
  scheduleLimitations?: string | null;
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
  // Multiplies PER_PERSON agreed-price lines (`tripHeadcount(trip)`);
  // null/absent leaves a per-person total unknown.
  headcount?: number | null;
  // The trip's default currency — what a venue with no engagement yet (and
  // so no stored currency) prices in. Absent = USD.
  defaultCurrency?: string;
  // The workflow catalog (WORKFLOW_STEP_SELECT steps) — resolves each row's
  // `waiting`; absent leaves it null.
  workflows?: { id: string; steps: WorkflowStepLike[] }[];
};

// Lodging beats everything; otherwise the most common session category
// ("Visit", "Meal", "Talk"…); a venue with only rough-plan days is "Planned".
function visitTypeOf(v: {
  nights: number;
  categories: string[];
  sessions: CoveredSession[];
}): VisitType {
  if (v.nights > 0) return "Lodging";
  if (v.categories.length > 0) {
    const counts = new Map<string, number>();
    for (const c of v.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  if (v.sessions.length > 0 && v.sessions.every((s) => s.planned)) return "Planned";
  return "Visit";
}

type VenueAccum = {
  sessions: CoveredSession[];
  stays: CoveredStay[];
  dates: Date[];
  nights: number;
  // Category names of the covered timed sessions, for the visit type.
  categories: string[];
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
  const today = todayUtc();
  // Whose move, on a booking that exists (an untouched venue has no ball in
  // play yet — "Window open" / "Unconfirmed" cover it) and follows a workflow.
  const workflowById = new Map((data.workflows ?? []).map((w) => [w.id, w]));
  const waitingFor = (progress: BookingProgressView): WaitingView | null => {
    const wf = progress.exists && progress.workflowId
      ? workflowById.get(progress.workflowId)
      : undefined;
    return wf ? waitingView(waitingFromView(wf.steps, progress, today), today) : null;
  };
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
        stays: [],
        dates: [],
        nights: 0,
        categories: [],
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
        if (item.category) v.categories.push(item.category.name);
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
        const progress = toProgress(b, null, data.tripStartDate);
        const priceLines = serializePriceLines(b.priceLines ?? []);
        itemRows.push({
          kind: "item",
          bookingId: b.id,
          label: b.label ?? label,
          status: b.status,
          progress,
          waiting: waitingFor(progress),
          confirmationRef: b.confirmationRef,
          contactName: b.bookedContact?.name ?? null,
          dayIndex: day.dayIndex,
          date: day.date ? toDateInput(day.date) : null,
          priceLines,
          agreedCurrency: b.agreedCurrency ?? data.defaultCurrency ?? "USD",
          agreedTotal: resolveAgreedTotal(priceLines, data.headcount ?? null),
          headcount: data.headcount ?? null,
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
    const venueId = venueOf(stay.locationId);
    const v = ensure(venueId);
    const nights = stayNights(stay);
    v.nights += nights;
    if (stay.checkIn) v.dates.push(stay.checkIn);
    v.stays.push({
      id: stay.id ?? null,
      checkIn: stay.checkIn ? toDateInput(stay.checkIn) : null,
      checkOut: stay.checkOut ? toDateInput(stay.checkOut) : null,
      checkInDayIndex: stay.checkInDayIndex ?? null,
      checkOutDayIndex: stay.checkOutDayIndex ?? null,
      nights,
      siteName:
        stay.locationId === venueId
          ? null
          : (locById.get(stay.locationId)?.name ?? null),
    });
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
    // The venue's list prices in force for this trip's start (today when the
    // trip has no dates yet).
    const liveCosts = effectiveCosts(loc?.costs ?? [], data.tripStartDate ?? today);
    const costs = liveCosts.map(serializeCost);
    // The agreed price (the per-trip override) wins; until one is agreed the
    // venue's list price IS the engagement's price — the estimate, balance and
    // schedule all run off it. Only without either is the row "missing".
    const priceLines = serializePriceLines(eng?.priceLines ?? []);
    const headcount = data.headcount ?? null;
    const storedCurrency = eng?.agreedCurrency ?? data.defaultCurrency ?? "USD";
    const listPrice = hasAgreedPrice(priceLines)
      ? null
      : listPriceLines(costs, storedCurrency);
    const priceSource: PriceSource = hasAgreedPrice(priceLines)
      ? "agreed"
      : listPrice
        ? "venue"
        : null;
    const effectiveLines = priceSource === "venue" ? listPrice!.lines : priceLines;
    const agreedCurrency =
      priceSource === "venue" ? listPrice!.currency : storedCurrency;
    const agreedTotal = resolveAgreedTotal(effectiveLines, headcount);
    const payments = (eng?.payments ?? []).map(serializePayment);
    const paidTotal = payments.reduce((sum, p) => sum + p.amount, 0);
    const unpaidBalance =
      agreedTotal == null ? null : Math.max(0, agreedTotal - paidTotal);
    const schedule = resolveSchedule(
      (eng?.paymentSchedule ?? []).map(serializeInstallment),
      {
        agreedTotal,
        paidTotal,
        tripStartDate: data.tripStartDate ?? null,
        bookingDate: eng?.bookedOn ?? eng?.createdAt ?? null,
        today,
      },
    );
    const { overdueAmount, nextDue } = scheduleAttention(schedule);
    const isMissingCost =
      !hasAgreedPrice(priceLines) &&
      (liveCosts.length === 0 ||
        liveCosts.every((c) => isCostStale(c.confirmedAt)));
    // A planned (untimed) visit is a rough plan, not missing information.
    const isMissingTime = v.sessions.some(
      (s) => !s.planned && !s.startTime && !s.endTime,
    );

    const earliest = earliestCoveredDate(v.dates);
    const win = bookingWindow(earliest, loc?.bookingOpensLeadDays ?? null);
    const status: BookingStatus = eng?.status ?? "PLANNED";
    const progress = toProgress(eng, loc?.defaultWorkflowId, data.tripStartDate);
    // Not-bookable sites and ones deliberately marked "not needed" never need attention.
    const inPlay = bookable && status !== "NOT_NEEDED";

    v.sessions.sort(
      (a, b) =>
        a.dayIndex - b.dayIndex ||
        (a.startTime ?? "").localeCompare(b.startTime ?? ""),
    );
    v.stays.sort((a, b) =>
      (a.checkIn ?? "").localeCompare(b.checkIn ?? "") ||
      (a.checkInDayIndex ?? 0) - (b.checkInDayIndex ?? 0),
    );
    const firstDayIndex = [
      ...v.sessions.map((s) => s.dayIndex),
      ...v.stays.flatMap((s) => (s.checkInDayIndex != null ? [s.checkInDayIndex] : [])),
      ...v.stays.flatMap((s) => {
        // A dated stay's first night → the day index it starts on.
        const day = s.checkIn
          ? data.days.find((d) => d.date && toDateInput(d.date) === s.checkIn)
          : undefined;
        return day ? [day.dayIndex] : [];
      }),
    ].reduce<number | null>((m, n) => (m == null || n < m ? n : m), null);

    venueRows.push({
      kind: "venue",
      locationId,
      locationName: loc?.name ?? "Unknown location",
      regionName: loc?.region?.name ?? null,
      visitType: visitTypeOf(v),
      firstDayIndex,
      bookable,
      bookingId: eng?.id ?? null,
      status,
      progress,
      waiting: bookable ? waitingFor(progress) : null,
      label: eng?.label ?? null,
      confirmationRef: eng?.confirmationRef ?? null,
      notes: eng?.notes ?? null,
      bookedContactId: eng?.bookedContactId ?? null,
      contactName: eng?.bookedContact?.name ?? null,
      contactPhone: eng?.bookedContact?.phone ?? null,
      contactEmail: eng?.bookedContact?.email ?? null,
      bookingNotes: loc?.bookingNotes?.trim() || null,
      scheduleLimitations: loc?.scheduleLimitations?.trim() || null,
      bookedOn: eng?.bookedOn ? toDateInput(eng.bookedOn) : null,
      sessions: v.sessions,
      stays: v.stays,
      nightCount: v.nights,
      costs,
      priceLines,
      effectiveLines,
      priceSource,
      agreedCurrency,
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
