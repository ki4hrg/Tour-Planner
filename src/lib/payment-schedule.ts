import type { PaymentScheduleItem } from "@prisma/client";
import { addDays, toDateInput } from "./dates";

// Payment-schedule resolution (GH #51, anchors added in #86 refinement): turn a
// booking's raw installments (percentage-or-fixed, due relative to a selectable
// anchor) into concrete amounts, due dates, and paid/overdue state. Pure over its
// inputs — callers pass `today` (see todayUtc) so render stays free of Date.now().

export type PaymentAnchor = "EVENT_START" | "BOOKING" | "NONE";
export type PaymentOffsetUnit = "DAY" | "WEEK" | "MONTH";

export type ScheduleInstallmentInput = {
  id: string;
  label: string | null;
  // Exactly one is set (DB CHECK payment_schedule_amount). Numbers here — the
  // caller flattens Prisma Decimals at the boundary.
  percent: number | null;
  fixedAmount: number | null;
  // How the due date is measured (DB CHECK payment_schedule_anchor):
  //  - EVENT_START: offset counts BEFORE trip start (negative = after)
  //  - BOOKING: offset counts AFTER the booking's bookedOn date
  //  - NONE: no deadline (offsetValue/offsetUnit null; never overdue)
  anchor: PaymentAnchor;
  offsetValue: number | null; // in offsetUnit; null iff anchor === "NONE"
  offsetUnit: PaymentOffsetUnit | null; // null iff anchor === "NONE"
  sortOrder: number;
};

export type InstallmentState = "paid" | "overdue" | "upcoming" | "unscheduled";

export type ResolvedInstallment = ScheduleInstallmentInput & {
  // null when percentage-based and no agreed price is set yet.
  amountDue: number | null;
  dueDate: string | null; // "yyyy-mm-dd"; null when undated (NONE) or anchor date missing
  covered: number; // portion of the payment log allocated to this installment
  outstanding: number | null;
  state: InstallmentState; // "unscheduled" = amount or (dated) due date unresolvable
};

// Prisma Decimal → number at the boundary, same convention as serializeCost /
// serializePayment in money.ts. Every resolveSchedule caller feeds rows through
// this so the conversion lives in exactly one place.
export function serializeInstallment(
  i: PaymentScheduleItem,
): ScheduleInstallmentInput {
  return {
    id: i.id,
    label: i.label,
    percent: i.percent == null ? null : Number(i.percent),
    fixedAmount: i.fixedAmount == null ? null : Number(i.fixedAmount),
    anchor: i.anchor,
    offsetValue: i.offsetValue,
    offsetUnit: i.offsetUnit,
    sortOrder: i.sortOrder,
  };
}

// Shift a date by a signed value in the given unit. MONTH/WEEK add calendar-aware
// (UTC). A MONTH shift clamps to the last day of the target month rather than
// overflowing into the next one: "1 month before May 31" is Apr 30 (not May 1),
// and Jan 31 + 1mo is Feb 28/29 (not Mar 3). Exported for tests.
export function addUnits(
  date: Date,
  value: number,
  unit: PaymentOffsetUnit,
): Date {
  if (unit === "WEEK") return addDays(date, value * 7);
  if (unit === "MONTH") {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + value;
    // Day 0 of the following month = last day of the target month.
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const d = new Date(date);
    // Park on day 1 so the year/month change can't overflow; keeps time-of-day (a
    // BOOKING anchor may fall back to a timestamped createdAt).
    d.setUTCDate(1);
    d.setUTCFullYear(y, m, Math.min(date.getUTCDate(), lastDay));
    return d;
  }
  return addDays(date, value);
}

// The concrete due date for one installment, or null when undated (NONE) or the
// anchor date isn't known yet (undated trip / booking with no bookedOn).
function installmentDueDate(
  inst: ScheduleInstallmentInput,
  tripStartDate: Date | null,
  bookingDate: Date | null,
): Date | null {
  if (inst.anchor === "NONE" || inst.offsetValue == null || inst.offsetUnit == null)
    return null;
  if (inst.anchor === "BOOKING")
    return bookingDate == null
      ? null
      : addUnits(bookingDate, inst.offsetValue, inst.offsetUnit);
  // EVENT_START: offset counts BEFORE trip start.
  return tripStartDate == null
    ? null
    : addUnits(tripStartDate, -inst.offsetValue, inst.offsetUnit);
}

/**
 * Resolve a schedule against the booking's agreed price and payment log.
 * Installments are ordered by resolved due date (earliest first; undated last),
 * and logged payments are allocated oldest-due-first (the log is one running
 * total, matching the naive same-currency summing used for `settled`). An
 * undated NONE installment therefore absorbs payments only after every dated one
 * — a "deposit at booking, pay first" belongs to a BOOKING anchor with offset 0.
 */
export function resolveSchedule(
  installments: ScheduleInstallmentInput[],
  opts: {
    agreedAmount: number | null;
    paidTotal: number;
    tripStartDate: Date | null;
    // The booking's bookedOn ?? createdAt; null for a not-yet-booked engagement
    // or a location's standing terms (BOOKING installments stay "unscheduled").
    bookingDate: Date | null;
    today: Date;
  },
): ResolvedInstallment[] {
  const { agreedAmount, paidTotal, tripStartDate, bookingDate, today } = opts;

  const computed = installments.map((inst) => {
    const amountDue =
      inst.fixedAmount != null
        ? inst.fixedAmount
        : agreedAmount != null && inst.percent != null
          ? Math.round(agreedAmount * inst.percent) / 100
          : null;
    const due = installmentDueDate(inst, tripStartDate, bookingDate);
    return { inst, amountDue, due };
  });

  // Earliest due first (undated last), sortOrder as tiebreak — this is both the
  // display order and the oldest-due-first allocation order.
  computed.sort((a, b) => {
    if (a.due && b.due)
      return a.due.getTime() - b.due.getTime() || a.inst.sortOrder - b.inst.sortOrder;
    if (a.due) return -1;
    if (b.due) return 1;
    return a.inst.sortOrder - b.inst.sortOrder;
  });

  let unallocated = paidTotal;
  return computed.map(({ inst, amountDue, due }) => {
    const covered = amountDue == null ? 0 : Math.min(unallocated, amountDue);
    unallocated -= covered;

    let state: InstallmentState;
    if (amountDue == null) state = "unscheduled";
    else if (covered >= amountDue) state = "paid";
    else if (inst.anchor === "NONE")
      state = "upcoming"; // owed, no deadline — never overdue
    else if (due == null) state = "unscheduled"; // dated anchor, date not known yet
    else if (due.getTime() < today.getTime()) state = "overdue";
    else state = "upcoming";

    return {
      ...inst,
      amountDue,
      dueDate: due ? toDateInput(due) : null,
      covered,
      outstanding: amountDue == null ? null : Math.max(0, amountDue - covered),
      state,
    };
  });
}

const UNIT_WORDS: Record<PaymentOffsetUnit, string> = {
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
};

/**
 * Plain-language description of when an installment falls due, from its anchor +
 * offset — the "rule" ("180 days before start", "3 months after booking", "no
 * set deadline"), shown in both editors even before it resolves to a date.
 */
export function describeCadence(i: {
  anchor: PaymentAnchor;
  offsetValue: number | null;
  offsetUnit: PaymentOffsetUnit | null;
}): string {
  if (i.anchor === "NONE") return "no set deadline";
  const value = i.offsetValue ?? 0;
  const n = Math.abs(value);
  const unit = `${UNIT_WORDS[i.offsetUnit ?? "DAY"]}${n === 1 ? "" : "s"}`;
  if (i.anchor === "BOOKING") {
    if (value === 0) return "on booking date";
    return value > 0 ? `${n} ${unit} after booking` : `${n} ${unit} before booking`;
  }
  // EVENT_START — offset counts before trip start (negative = after).
  if (value === 0) return "on start day";
  return value > 0 ? `${n} ${unit} before start` : `${n} ${unit} after start`;
}

/** Dashboard attention summary: what's overdue, and what comes due next. */
export function scheduleAttention(resolved: ResolvedInstallment[]): {
  overdueAmount: number; // total outstanding across overdue installments
  nextDue: ResolvedInstallment | null; // earliest unpaid dated upcoming installment
} {
  let overdueAmount = 0;
  let nextDue: ResolvedInstallment | null = null;
  for (const inst of resolved) {
    if (inst.state === "overdue") overdueAmount += inst.outstanding ?? 0;
    // resolved is due-date ordered, so the first dated upcoming is the soonest.
    if (inst.state === "upcoming" && inst.dueDate != null && nextDue === null)
      nextDue = inst;
  }
  return { overdueAmount, nextDue };
}
