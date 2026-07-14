import type { PaymentScheduleItem } from "@prisma/client";
import { addDays, toDateInput } from "./dates";

// Payment-schedule resolution (GH #51): turn a booking's raw installments
// (percentage-or-fixed, due N days before trip start) into concrete amounts,
// due dates, and paid/overdue state. Pure over its inputs — callers pass
// `today` (see todayUtc) so render stays free of Date.now().

export type ScheduleInstallmentInput = {
  id: string;
  label: string | null;
  // Exactly one is set (DB CHECK payment_schedule_amount). Numbers here — the
  // caller flattens Prisma Decimals at the boundary.
  percent: number | null;
  fixedAmount: number | null;
  dueOffsetDays: number; // days BEFORE trip start (0 = day of, negative = after)
  sortOrder: number;
};

export type InstallmentState = "paid" | "overdue" | "upcoming" | "unscheduled";

export type ResolvedInstallment = ScheduleInstallmentInput & {
  // null when percentage-based and no agreed price is set yet.
  amountDue: number | null;
  dueDate: string | null; // "yyyy-mm-dd"; null on a date-less trip
  covered: number; // portion of the payment log allocated to this installment
  outstanding: number | null;
  state: InstallmentState; // "unscheduled" = amount or due date unresolvable
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
    dueOffsetDays: i.dueOffsetDays,
    sortOrder: i.sortOrder,
  };
}

/** Chronological order: furthest-out offset first, sortOrder/label as tiebreak. */
export function sortInstallments<T extends { dueOffsetDays: number; sortOrder: number }>(
  installments: T[],
): T[] {
  return [...installments].sort(
    (a, b) => b.dueOffsetDays - a.dueOffsetDays || a.sortOrder - b.sortOrder,
  );
}

/**
 * Resolve a schedule against the booking's agreed price and payment log.
 * Logged payments are allocated to installments oldest-due-first (a payment
 * isn't earmarked for an installment — the log is one running total, matching
 * the naive same-currency summing used for `settled`).
 */
export function resolveSchedule(
  installments: ScheduleInstallmentInput[],
  opts: {
    agreedAmount: number | null;
    paidTotal: number;
    tripStartDate: Date | null;
    today: Date;
  },
): ResolvedInstallment[] {
  const { agreedAmount, paidTotal, tripStartDate, today } = opts;
  let unallocated = paidTotal;

  return sortInstallments(installments).map((inst) => {
    const amountDue =
      inst.fixedAmount != null
        ? inst.fixedAmount
        : agreedAmount != null && inst.percent != null
          ? Math.round(agreedAmount * inst.percent) / 100
          : null;
    const due =
      tripStartDate == null ? null : addDays(tripStartDate, -inst.dueOffsetDays);
    const covered =
      amountDue == null ? 0 : Math.min(unallocated, amountDue);
    unallocated -= covered;

    let state: InstallmentState;
    if (amountDue == null || due == null) state = "unscheduled";
    else if (covered >= amountDue) state = "paid";
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

/** Dashboard attention summary: what's overdue, and what comes due next. */
export function scheduleAttention(resolved: ResolvedInstallment[]): {
  overdueAmount: number; // total outstanding across overdue installments
  nextDue: ResolvedInstallment | null; // earliest unpaid upcoming installment
} {
  let overdueAmount = 0;
  let nextDue: ResolvedInstallment | null = null;
  for (const inst of resolved) {
    if (inst.state === "overdue") overdueAmount += inst.outstanding ?? 0;
    if (inst.state === "upcoming" && nextDue === null) nextDue = inst;
  }
  return { overdueAmount, nextDue };
}
