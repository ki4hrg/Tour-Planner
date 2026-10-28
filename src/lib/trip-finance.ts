import type { BookingStatus } from "@prisma/client";
import { bookedViaMap, engagementLocationId } from "./booked-via";
import { bookingDashboardHref } from "./documents";
import { formatMoney, isCostStale } from "./money";
import {
  agreedTotal,
  formatPriceBreakdown,
  hasAgreedPrice,
  priceLineSums,
  type CostLike,
  type PriceLine,
} from "./costs";
import { stayHeadcount, stayNights } from "./stays";
import {
  resolveSchedule,
  scheduleAttention,
  type ResolvedInstallment,
  type ScheduleInstallmentInput,
} from "./payment-schedule";
import { toDateInput } from "./dates";

// A trip's finances in one pure pass — what the overview's Finance card and the
// Finance tab both read. Two questions, kept apart:
//
//  * ESTIMATE — what the trip will likely cost, by source. A venue engagement
//    with an agreed price counts at that total (it is the contract, and covers
//    every session and stay there); otherwise the venue's list price (its Cost
//    catalog, the lines valid for the trip's start) scaled by the headcount,
//    plus each stay at its nightly rate. Site-less item bookings (a coach)
//    count at their agreed price. Per currency, no FX.
//  * COMMITMENTS — what has actually been agreed and paid: every booking with
//    an agreed price or a logged payment, its balance and its payment schedule.
//
// Pure over its inputs: callers pass `today`; the only clock read is
// `isCostStale` (lib-only, never in render).

export type FinanceCost = CostLike & {
  label: string;
  confirmedAt: Date | string | null;
};

export type FinanceLocation = {
  id: string;
  name: string;
  bookable?: boolean;
  bookedViaId?: string | null;
  // The list prices in force for this trip (already filtered by validity —
  // see `effectiveCosts`).
  costs: FinanceCost[];
};

export type FinanceStay = {
  id: string;
  locationId: string;
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDayIndex?: number | null;
  checkOutDayIndex?: number | null;
  headcount: number | null;
  costPerPersonPerNight: number | null;
  currency: string;
};

export type FinanceBooking = {
  id: string;
  // A venue engagement names its location; a site-less item booking names the
  // item (day link) instead.
  locationId: string | null;
  label: string | null;
  status: BookingStatus;
  stageLabel: string | null;
  agreedCurrency: string;
  priceLines: PriceLine[];
  payments: number[];
  paymentSchedule: ScheduleInstallmentInput[];
  bookedOn: Date | null;
  createdAt: Date;
  item?: { dayId: string; itemId: string; dayIndex: number } | null;
};

export type FinanceInput = {
  tripId: string;
  headcount: number | null;
  tripStartDate: Date | null;
  today: Date;
  // Every location the trip touches (sessions, planned visits, stays,
  // engagements) — parents of booked-via sites included.
  locations: FinanceLocation[];
  // Locations the itinerary visits (timed sessions + planned), whose list
  // prices feed the estimate.
  visitedLocationIds: string[];
  stays: FinanceStay[];
  bookings: FinanceBooking[];
};

export type EstimateSource = "agreed" | "list" | "stay";

export type EstimateLine = {
  key: string;
  kind: "venue" | "lodging" | "item";
  name: string;
  href: string;
  currency: string;
  amount: number;
  source: EstimateSource;
  // "Admission £12.00 /person × 40 + Group charge £90.00 = £570.00"
  detail: string;
  stale: boolean; // a list price unconfirmed for 1+ year
  // Per-person pricing with no headcount to multiply: counted at 0.
  unknown: boolean;
};

export type EstimateTotal = {
  currency: string;
  total: number;
  lines: EstimateLine[];
  stale: boolean;
  unknown: number;
};

export type MoneyRow = {
  currency: string;
  estimate: number;
  agreed: number;
  paid: number;
  outstanding: number;
  unknown: number; // bookings priced per person with no headcount
};

export type Commitment = {
  key: string;
  kind: "venue" | "item";
  name: string;
  href: string;
  status: BookingStatus;
  stageLabel: string | null;
  currency: string;
  priceLines: PriceLine[];
  agreedTotal: number | null;
  paid: number;
  outstanding: number | null;
  settled: boolean;
  schedule: ResolvedInstallment[];
  overdueAmount: number;
  nextDue: { amount: number; dueDate: string } | null;
};

export type DueItem = {
  key: string;
  name: string;
  href: string;
  currency: string;
  amount: number;
  dueDate: string; // "yyyy-mm-dd"
  overdue: boolean;
};

export type TripFinance = {
  headcount: number | null;
  estimate: EstimateTotal[];
  money: MoneyRow[];
  commitments: Commitment[];
  due: DueItem[]; // overdue first, then soonest
  overdueCount: number;
  hasStaleCost: boolean;
  // Visited, bookable venues with neither an agreed nor a list price — the
  // estimate is incomplete by these.
  unpriced: { id: string; name: string; href: string }[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cost rows → price lines, one set per currency. */
function linesByCurrency(costs: FinanceCost[]): Map<string, PriceLine[]> {
  const out = new Map<string, PriceLine[]>();
  for (const c of costs) {
    const list = out.get(c.currency) ?? [];
    list.push({ label: c.label, amount: c.amount, unit: c.unit });
    out.set(c.currency, list);
  }
  return out;
}

export function buildTripFinance(input: FinanceInput): TripFinance {
  const { tripId, headcount, today } = input;
  const locById = new Map(input.locations.map((l) => [l.id, l]));
  const viaMap = bookedViaMap(input.locations);
  const venueOf = (locationId: string) => engagementLocationId(locationId, viaMap);
  const nameOf = (locationId: string) =>
    locById.get(locationId)?.name ?? "Unknown location";
  const venueHref = (locationId: string) =>
    bookingDashboardHref(tripId, venueOf(locationId));
  const itemHref = (b: FinanceBooking) =>
    b.item
      ? `/trips/${tripId}/days/${b.item.dayId}#item-${b.item.itemId}`
      : `/trips/${tripId}/booking`;

  // --- Commitments: every booking with a price or a payment -----------------
  const commitments: Commitment[] = [];
  const due: DueItem[] = [];
  // Engagements priced by an agreed total, keyed by venue — these venues'
  // list prices and stays drop out of the estimate.
  const agreedByVenue = new Map<string, { total: number; currency: string }>();
  for (const b of input.bookings) {
    const isVenue = b.locationId != null;
    const name = isVenue ? nameOf(b.locationId!) : (b.label ?? "Booking");
    const href = isVenue ? venueHref(b.locationId!) : itemHref(b);
    const priced = hasAgreedPrice(b.priceLines);
    const total = agreedTotal(b.priceLines, headcount);
    const paid = round2(b.payments.reduce((s, p) => s + p, 0));
    if (isVenue && total != null && b.status !== "NOT_NEEDED") {
      agreedByVenue.set(b.locationId!, { total, currency: b.agreedCurrency });
    }
    if (!priced && paid === 0) continue;
    const schedule = resolveSchedule(b.paymentSchedule, {
      agreedTotal: total,
      paidTotal: paid,
      tripStartDate: input.tripStartDate,
      bookingDate: b.bookedOn ?? b.createdAt,
      today,
    });
    const { overdueAmount, nextDue } = scheduleAttention(schedule);
    const key = `${isVenue ? "v" : "i"}:${b.id}`;
    commitments.push({
      key,
      kind: isVenue ? "venue" : "item",
      name,
      href,
      status: b.status,
      stageLabel: b.stageLabel,
      currency: b.agreedCurrency,
      priceLines: b.priceLines,
      agreedTotal: total,
      paid,
      outstanding: total == null ? null : Math.max(0, round2(total - paid)),
      settled: total != null && paid >= total,
      schedule,
      overdueAmount,
      nextDue:
        nextDue?.dueDate && nextDue.outstanding
          ? { amount: nextDue.outstanding, dueDate: nextDue.dueDate }
          : null,
    });
    for (const inst of schedule) {
      if (inst.state === "overdue" && inst.outstanding && inst.dueDate) {
        due.push({
          key: `${key}:${inst.id ?? inst.dueDate}`,
          name,
          href,
          currency: b.agreedCurrency,
          amount: inst.outstanding,
          dueDate: inst.dueDate,
          overdue: true,
        });
      }
    }
    if (nextDue?.dueDate && nextDue.outstanding) {
      due.push({
        key: `${key}:next`,
        name,
        href,
        currency: b.agreedCurrency,
        amount: nextDue.outstanding,
        dueDate: nextDue.dueDate,
        overdue: false,
      });
    }
  }
  due.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) || a.dueDate.localeCompare(b.dueDate),
  );

  // --- Estimate ------------------------------------------------------------
  const lines: EstimateLine[] = [];
  const unpriced: TripFinance["unpriced"] = [];
  const notNeeded = new Set(
    input.bookings
      .filter((b) => b.locationId && b.status === "NOT_NEEDED")
      .map((b) => b.locationId!),
  );
  // Agreed engagements, one line each (venue or site-less item).
  for (const b of input.bookings) {
    if (b.status === "NOT_NEEDED") continue;
    const total = agreedTotal(b.priceLines, headcount);
    const isVenue = b.locationId != null;
    if (!hasAgreedPrice(b.priceLines)) continue;
    const { hasPerPerson } = priceLineSums(b.priceLines);
    const unknown = total == null && hasPerPerson;
    lines.push({
      key: `agreed:${b.id}`,
      kind: isVenue ? "venue" : "item",
      name: isVenue ? nameOf(b.locationId!) : (b.label ?? "Booking"),
      href: isVenue ? venueHref(b.locationId!) : itemHref(b),
      currency: b.agreedCurrency,
      amount: total ?? 0,
      source: "agreed",
      detail: formatPriceBreakdown(b.priceLines, b.agreedCurrency, headcount),
      stale: false,
      unknown,
    });
  }
  // Visited venues without an agreed price: their list prices.
  const visited = [...new Set(input.visitedLocationIds)];
  for (const id of visited) {
    const venueId = venueOf(id);
    if (agreedByVenue.has(venueId) || notNeeded.has(venueId)) continue;
    const loc = locById.get(id);
    if (!loc) continue;
    if (loc.costs.length === 0) {
      if (loc.bookable !== false) {
        unpriced.push({ id, name: loc.name, href: venueHref(id) });
      }
      continue;
    }
    for (const [currency, priceLines] of linesByCurrency(loc.costs)) {
      const total = agreedTotal(priceLines, headcount);
      const { hasPerPerson } = priceLineSums(priceLines);
      lines.push({
        key: `list:${id}:${currency}`,
        kind: "venue",
        name: loc.name,
        href: venueHref(id),
        currency,
        amount: total ?? 0,
        source: "list",
        detail: formatPriceBreakdown(priceLines, currency, headcount),
        stale: loc.costs.some(
          (c) => c.currency === currency && isCostStale(c.confirmedAt),
        ),
        unknown: total == null && hasPerPerson,
      });
    }
  }
  // Stays at venues without an agreed price: nightly rate × heads × nights.
  for (const s of input.stays) {
    const venueId = venueOf(s.locationId);
    if (agreedByVenue.has(venueId) || notNeeded.has(venueId)) continue;
    const nights = stayNights(s);
    const heads = stayHeadcount(s, headcount);
    const rate = s.costPerPersonPerNight;
    if (rate == null || nights === 0) continue;
    const amount = heads == null ? 0 : round2(rate * heads * nights);
    lines.push({
      key: `stay:${s.id}`,
      kind: "lodging",
      name: nameOf(s.locationId),
      href: venueHref(s.locationId),
      currency: s.currency,
      amount,
      source: "stay",
      detail: `${nights} night${nights === 1 ? "" : "s"} × ${
        heads != null ? `${heads} × ` : ""
      }${formatMoney(rate, s.currency)}/person`,
      stale: false,
      unknown: heads == null,
    });
  }

  const estimate: EstimateTotal[] = [...new Set(lines.map((l) => l.currency))]
    .sort()
    .map((currency) => {
      const own = lines.filter((l) => l.currency === currency);
      return {
        currency,
        total: round2(own.reduce((s, l) => s + l.amount, 0)),
        lines: own.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
        stale: own.some((l) => l.stale),
        unknown: own.filter((l) => l.unknown).length,
      };
    });

  // --- Money: per-currency roll-up of estimate and commitments --------------
  const money = new Map<string, MoneyRow>();
  const rowFor = (currency: string): MoneyRow => {
    let row = money.get(currency);
    if (!row) {
      row = { currency, estimate: 0, agreed: 0, paid: 0, outstanding: 0, unknown: 0 };
      money.set(currency, row);
    }
    return row;
  };
  for (const e of estimate) rowFor(e.currency).estimate = e.total;
  for (const c of commitments) {
    const row = rowFor(c.currency);
    if (hasAgreedPrice(c.priceLines) && c.agreedTotal == null) row.unknown++;
    row.agreed = round2(row.agreed + (c.agreedTotal ?? 0));
    row.paid = round2(row.paid + c.paid);
    row.outstanding = round2(row.outstanding + (c.outstanding ?? 0));
  }

  return {
    headcount,
    estimate,
    money: [...money.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    commitments: commitments.sort(
      (a, b) =>
        Number(b.overdueAmount > 0) - Number(a.overdueAmount > 0) ||
        (a.nextDue?.dueDate ?? "9999").localeCompare(b.nextDue?.dueDate ?? "9999") ||
        a.name.localeCompare(b.name),
    ),
    due,
    overdueCount: due.filter((d) => d.overdue).length,
    hasStaleCost: lines.some((l) => l.stale),
    unpriced,
  };
}

/** "yyyy-mm-dd" for a cost's validity bound, for the UI. */
export function dateBound(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return typeof d === "string" ? d.slice(0, 10) : toDateInput(d);
}
