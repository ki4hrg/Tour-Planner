import type { BookingStatus } from "@prisma/client";
import type {
  CoveredSession,
  ItemBookingRow,
  VenueBookingRow,
} from "./booking-dashboard";
import { isBookingOff, isBookingSecured } from "./booking";
import { BOOKING_STATUS_LABELS, bookingStageText, bookingSubstatus } from "./trips";
import { formatDate } from "./dates";
import { formatMoney } from "./money";
import { waitingAgeText } from "./booking-workflow";

// Cross-trip booking dashboard (/bookings): the per-trip venue rows that
// `buildDashboardRows` produces, regrouped by venue so a planner can see — and
// email about — every in-play trip visiting one host site / hotel at once.
// Pure: no Prisma, no "now" (window/overdue state is already resolved on the
// rows), so it's unit-testable and safe to call from a Client Component.

export type TripRef = {
  id: string;
  name: string;
  tripTypeName: string;
  startDate: string | null; // "yyyy-mm-dd"
  endDate: string | null;
};

export type VenueContact = {
  id: string;
  name: string;
  role?: string | null;
  email: string | null;
  phone: string | null;
  primary: boolean; // the location's designated go-to contact
};

export type VenueMeta = {
  id: string;
  name: string;
  regionPath: string | null;
  primaryContact: Omit<VenueContact, "primary"> | null;
};

// Per-row attention flags, precomputed so consumers (the home dashboard's
// action list) needn't re-derive them. All false on a walk-by / not-needed row.
export type RowFlags = {
  windowOpen: boolean; // window open and the booking isn't secured
  missingPrice: boolean;
  paymentOverdue: boolean; // row.overdueAmount (in row.agreedCurrency) > 0
  unconfirmed: boolean;
  yourMove: boolean; // a started booking whose upcoming workflow step is ours
};

export type VenueTripRow = {
  trip: TripRef;
  row: VenueBookingRow;
  flags: RowFlags;
};

export type TripItemBookings = { trip: TripRef; itemRows: ItemBookingRow[] };

export type VenueGroup = {
  locationId: string;
  locationName: string;
  regionPath: string | null;
  // Primary contact first, then any distinct contact a trip's engagement was
  // booked with.
  contacts: VenueContact[];
  rows: VenueTripRow[];
  attentionCount: number;
};

export type AttentionFilters = {
  windowOpen: boolean;
  missingPrice: boolean;
  unconfirmed: boolean;
  paymentOverdue: boolean;
  yourMove: boolean;
};

export const ALL_ATTENTION_FILTERS: AttentionFilters = {
  windowOpen: true,
  missingPrice: true,
  unconfirmed: true,
  paymentOverdue: true,
  yourMove: true,
};

export const NO_ATTENTION_FILTERS: AttentionFilters = {
  windowOpen: false,
  missingPrice: false,
  unconfirmed: false,
  paymentOverdue: false,
  yourMove: false,
};

/** Bookable and not cancelled / skipped — the only rows that can need work. */
export function rowInPlay(row: VenueBookingRow): boolean {
  return row.bookable && !isBookingOff(row.status);
}

/**
 * The ball is in our court: an engagement already underway (a booking record
 * exists — an untouched venue is "Window open" / "Unconfirmed" instead) whose
 * upcoming workflow step is ours. Works for item rows too (always started).
 */
export function isYourMove(row: {
  waiting: VenueBookingRow["waiting"];
  bookingId: string | null;
  status: BookingStatus;
}): boolean {
  return (
    row.bookingId != null &&
    !isBookingOff(row.status) &&
    row.waiting?.actor === "US" &&
    // A step with a due date isn't our move until that date.
    row.waiting.due !== false
  );
}

/** "Next for you: Sign agreement · due in 12d" / "Next (venue): Confirm
 *  availability · waiting 3d" (the time half is `waitingAgeText`).
 *  Same prefixes as `ACTOR_PREFIX` in trips/waiting-note.tsx: the step label is
 *  the NEXT milestone, so "Your move: Menu chosen" read as already done. */
export function waitingText(w: NonNullable<VenueBookingRow["waiting"]>): string {
  const who = w.actor === "US" ? "Next for you" : "Next (venue)";
  const age = waitingAgeText(w);
  return `${who}: ${w.stepLabel}${age ? ` · ${age}` : ""}`;
}

/** Same predicate as the single-trip dashboard's attention filter checkboxes. */
export function rowMatchesFilters(
  row: VenueBookingRow,
  f: AttentionFilters,
): boolean {
  if (!rowInPlay(row)) return false;
  return (
    (f.windowOpen && row.open && !isBookingSecured(row.status)) ||
    (f.missingPrice && row.isMissingCost) ||
    (f.unconfirmed && !isBookingSecured(row.status)) ||
    (f.paymentOverdue && row.overdueAmount > 0) ||
    (f.yourMove && isYourMove(row))
  );
}

/**
 * "Needs attention" for sorting venues to the top: an unsecured booking whose
 * window is open, an overdue payment, no usable price, or our move.
 */
export function rowNeedsAttention(row: VenueBookingRow): boolean {
  return rowMatchesFilters(row, {
    windowOpen: true,
    missingPrice: true,
    unconfirmed: false,
    paymentOverdue: true,
    yourMove: true,
  });
}

export function rowFlags(row: VenueBookingRow): RowFlags {
  const only = (key: keyof AttentionFilters) =>
    rowMatchesFilters(row, { ...NO_ATTENTION_FILTERS, [key]: true });
  return {
    windowOpen: only("windowOpen"),
    missingPrice: only("missingPrice"),
    paymentOverdue: only("paymentOverdue"),
    unconfirmed: only("unconfirmed"),
    yourMove: only("yourMove"),
  };
}

/**
 * Narrow venue groups (and site-less item bookings) to the given master
 * statuses — every trip's row at those statuses, whatever workflow stage it
 * is at. Walk-by rows have no status and drop out; so does a venue left with
 * no rows. No statuses = no narrowing.
 */
export function filterGroupsByStatus(
  groups: VenueGroup[],
  statuses: BookingStatus[],
): VenueGroup[] {
  if (statuses.length === 0) return groups;
  return groups
    .map((g) => ({
      ...g,
      rows: g.rows.filter((r) => r.row.bookable && statuses.includes(r.row.status)),
    }))
    .filter((g) => g.rows.length > 0);
}

export function filterItemBookingsByStatus(
  trips: TripItemBookings[],
  statuses: BookingStatus[],
): TripItemBookings[] {
  if (statuses.length === 0) return trips;
  return trips
    .map((t) => ({ ...t, itemRows: t.itemRows.filter((r) => statuses.includes(r.status)) }))
    .filter((t) => t.itemRows.length > 0);
}

/** Master-status counts across venue rows (bookable ones) and item bookings. */
export function crossTripStatusRows(
  groups: VenueGroup[],
  trips: TripItemBookings[],
): { status: BookingStatus }[] {
  return [
    ...groups.flatMap((g) => g.rows.filter((r) => r.row.bookable).map((r) => r.row)),
    ...trips.flatMap((t) => t.itemRows),
  ];
}

/** True when any filter is on; all-off means "show everything". */
export function anyFilterOn(f: AttentionFilters): boolean {
  return Object.values(f).some(Boolean);
}

/** Venues whose rows match the filters (all venues when no filter is on). */
export function filterVenueGroups(
  groups: VenueGroup[],
  f: AttentionFilters,
  search = "",
): VenueGroup[] {
  const q = search.trim().toLowerCase();
  return groups.filter((g) => {
    if (
      q &&
      !g.locationName.toLowerCase().includes(q) &&
      !(g.regionPath ?? "").toLowerCase().includes(q)
    )
      return false;
    if (!anyFilterOn(f)) return true;
    return g.rows.some((r) => rowMatchesFilters(r.row, f));
  });
}

const byTripDate = (a: TripRef, b: TripRef) => {
  if (a.startDate && b.startDate && a.startDate !== b.startDate)
    return a.startDate.localeCompare(b.startDate);
  if (a.startDate && !b.startDate) return -1;
  if (!a.startDate && b.startDate) return 1;
  return a.name.localeCompare(b.name);
};

/**
 * Pivot each trip's venue rows into one group per location. Walk-by stops
 * (`bookable: false`) are dropped — there's nothing to book — so a venue only
 * appears when at least one trip engages it as bookable. Groups needing
 * attention sort first (most flagged trips first), then by their soonest trip,
 * then by name; rows within a group run in trip date order.
 */
export function groupRowsByVenue(
  trips: { trip: TripRef; venueRows: VenueBookingRow[] }[],
  venues: Map<string, VenueMeta>,
): VenueGroup[] {
  const groups = new Map<string, VenueGroup>();
  for (const { trip, venueRows } of trips) {
    for (const row of venueRows) {
      if (!row.bookable) continue;
      let g = groups.get(row.locationId);
      if (!g) {
        const meta = venues.get(row.locationId);
        g = {
          locationId: row.locationId,
          locationName: meta?.name ?? row.locationName,
          regionPath: meta?.regionPath ?? null,
          contacts: meta?.primaryContact
            ? [{ ...meta.primaryContact, primary: true }]
            : [],
          rows: [],
          attentionCount: 0,
        };
        groups.set(row.locationId, g);
      }
      g.rows.push({ trip, row, flags: rowFlags(row) });
      if (rowNeedsAttention(row)) g.attentionCount++;
      if (
        row.bookedContactId &&
        row.contactName &&
        !g.contacts.some((c) => c.id === row.bookedContactId)
      ) {
        g.contacts.push({
          id: row.bookedContactId,
          name: row.contactName,
          email: row.contactEmail,
          phone: row.contactPhone,
          primary: false,
        });
      }
    }
  }

  const list = [...groups.values()];
  for (const g of list) g.rows.sort((a, b) => byTripDate(a.trip, b.trip));
  const soonest = (g: VenueGroup) =>
    g.rows.find((r) => r.trip.startDate)?.trip.startDate ?? null;
  list.sort((a, b) => {
    if (a.attentionCount > 0 !== b.attentionCount > 0)
      return a.attentionCount > 0 ? -1 : 1;
    if (a.attentionCount !== b.attentionCount)
      return b.attentionCount - a.attentionCount;
    const sa = soonest(a);
    const sb = soonest(b);
    if (sa && sb && sa !== sb) return sa.localeCompare(sb);
    if (sa && !sb) return -1;
    if (!sa && sb) return 1;
    return a.locationName.localeCompare(b.locationName);
  });
  return list;
}

// --- Email ------------------------------------------------------------------

const SHORT_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const LONG_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const SESSION_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** "6 Jul – 12 Jul 2026", "30 Dec 2026 – 3 Jan 2027", "6 Jul 2026", "Dates TBC". */
export function formatTripDates(
  trip: Pick<TripRef, "startDate" | "endDate">,
): string {
  const { startDate, endDate } = trip;
  if (!startDate) return "Dates TBC";
  if (!endDate || endDate === startDate)
    return LONG_FMT.format(asDate(startDate));
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  const start = (sameYear ? SHORT_FMT : LONG_FMT).format(asDate(startDate));
  return `${start} – ${LONG_FMT.format(asDate(endDate))}`;
}

/** "Tue 7 Jul, 10:00–12:00: Visit" — Day N when the trip has no dates. */
export function formatSession(s: CoveredSession): string {
  const when = s.date
    ? SESSION_FMT.format(asDate(s.date)).replace(",", "")
    : `Day ${s.dayIndex}`;
  const time =
    s.startTime && s.endTime
      ? `${s.startTime}–${s.endTime}`
      : (s.startTime ?? (s.endTime ? `until ${s.endTime}` : null));
  return `${when}${time ? `, ${time}` : ""}: ${s.label}`;
}

/** Rows worth writing to the venue about — everything still in play. */
export function emailableRows(group: VenueGroup): VenueTripRow[] {
  return group.rows.filter((r) => rowInPlay(r.row));
}

// What the venue reads: the stage it knows ("Requested"), not our master
// status vocabulary; the master label only when there is no stage.
function statusLine(row: VenueBookingRow): string {
  return (
    bookingSubstatus({ status: row.status, stageLabel: row.progress.stageLabel }) ??
    BOOKING_STATUS_LABELS[row.status]
  );
}

/**
 * The "email this venue about all our trips" draft: recipients (primary contact
 * then booked contacts, deduped, email-less ones skipped), a subject, and a plain
 * text body listing each trip with its dates, the sessions / nights it covers and
 * where the booking stands. `href` is the ready mailto: link.
 */
export function buildVenueEmail(group: VenueGroup): {
  to: string[];
  subject: string;
  body: string;
  href: string;
  tripCount: number;
} {
  const rows = emailableRows(group);
  const to = [
    ...new Set(
      group.contacts
        .map((c) => c.email?.trim())
        .filter((e): e is string => Boolean(e)),
    ),
  ];

  const tripNames = rows.map((r) => r.trip.name);
  const subject =
    rows.length === 1
      ? `${group.locationName}: ${rows[0].trip.name} (${formatTripDates(rows[0].trip)})`
      : `${group.locationName}: ${rows.length} upcoming groups (${tripNames.join(", ")})`;

  const greetName = group.contacts.find((c) => c.email)?.name.split(/\s+/)[0];
  const lines: string[] = [
    `Hello ${greetName ?? "there"},`,
    "",
    rows.length === 1
      ? `I'm writing about our upcoming group at ${group.locationName}:`
      : `I'm writing about our ${rows.length} upcoming groups at ${group.locationName}:`,
    "",
  ];
  rows.forEach(({ trip, row }, i) => {
    lines.push(`${i + 1}. ${trip.name} (${formatTripDates(trip)})`);
    for (const s of row.sessions) lines.push(`   - ${formatSession(s)}`);
    if (row.nightCount > 0)
      lines.push(
        `   - Lodging: ${row.nightCount} night${row.nightCount === 1 ? "" : "s"}`,
      );
    const ref = row.confirmationRef ? ` (ref ${row.confirmationRef})` : "";
    lines.push(`   Status: ${statusLine(row)}${ref}`);
    lines.push("");
  });
  lines.push("Thank you,");
  const body = lines.join("\r\n");

  // Addresses stay readable (RFC 6068 allows a literal "@"); subject and body
  // are percent-encoded, with CRLF line breaks.
  const addr = to
    .map((e) => encodeURIComponent(e).replace(/%40/g, "@"))
    .join(",");
  const href = `mailto:${addr}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { to, subject, body, href, tripCount: rows.length };
}

// --- Action list (home dashboard) --------------------------------------------

export type ActionReason = "paymentOverdue" | "yourMove" | "windowOpen" | "missingPrice";

export type ActionItem = {
  key: string; // `${tripId}:${locationId}`
  reason: ActionReason; // the most pressing one; a row appears once
  text: string; // short human reason, e.g. "£250.00 overdue"
  trip: TripRef;
  locationId: string;
  locationName: string;
  status: BookingStatus;
  href: string; // the trip's booking dashboard, focused on this venue
};

const REASON_RANK: Record<ActionReason, number> = {
  paymentOverdue: 0,
  yourMove: 1,
  windowOpen: 2,
  missingPrice: 3,
};

/**
 * Flatten venue groups into a "needs action" list, one item per trip×venue
 * row that needs attention: overdue payments first (soonest trip first —
 * amounts can be in different currencies, so they aren't compared), then
 * bookings where it's our move (longest waiting first), then open booking windows (earliest-opened first), then missing prices (by
 * trip date). Merely-unconfirmed rows whose window isn't open are left out.
 */
export function actionItems(groups: VenueGroup[]): ActionItem[] {
  const items: { item: ActionItem; sortKey: string }[] = [];
  for (const g of groups) {
    for (const { trip, row, flags } of g.rows) {
      const reason: ActionReason | null = flags.paymentOverdue
        ? "paymentOverdue"
        : flags.yourMove && row.waiting
          ? "yourMove"
          : flags.windowOpen
          ? "windowOpen"
          : flags.missingPrice
            ? "missingPrice"
            : null;
      if (!reason) continue;
      const status = bookingStageText({
        status: row.status,
        stageLabel: row.progress.stageLabel,
      }).toLowerCase();
      const text =
        reason === "paymentOverdue"
          ? `${formatMoney(row.overdueAmount, row.agreedCurrency)} overdue`
          : reason === "yourMove" && row.waiting
            ? waitingText(row.waiting)
            : reason === "windowOpen"
            ? `Booking window open${row.earliest ? ` since ${formatDate(row.earliest)}` : ""} · ${status}`
            : "No price agreed";
      items.push({
        item: {
          key: `${trip.id}:${row.locationId}`,
          reason,
          text,
          trip,
          locationId: row.locationId,
          locationName: g.locationName,
          status: row.status,
          href: `/trips/${trip.id}/booking?venue=${row.locationId}`,
        },
        sortKey:
          reason === "windowOpen"
            ? (row.earliest ?? "9999")
            : reason === "yourMove"
              ? // Longest wait first.
                String(99999 - Math.min(99999, row.waiting?.days ?? 0)).padStart(5, "0")
              : (trip.startDate ?? "9999"),
      });
    }
  }
  items.sort(
    (a, b) =>
      REASON_RANK[a.item.reason] - REASON_RANK[b.item.reason] ||
      a.sortKey.localeCompare(b.sortKey) ||
      a.item.locationName.localeCompare(b.item.locationName),
  );
  return items.map((i) => i.item);
}
