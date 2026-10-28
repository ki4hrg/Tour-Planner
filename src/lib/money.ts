import type { Cost, CostUnit, Payment } from "@prisma/client";
import { toDateInput } from "./dates";

// Currencies the cost forms offer. System default is USD; trip types set their
// own default (e.g. Wesley → GBP).
export const CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * The codes a trip-scoped currency picker should offer: the trip's own currency
 * set (GH #11), falling back to the global list while a trip has none, and always
 * including the field's current value so legacy data stays selectable.
 */
export function currencyOptions(
  tripCurrencies: string[] | null | undefined,
  current?: string | null,
): string[] {
  const base = tripCurrencies?.length ? tripCurrencies : [...CURRENCIES];
  return current && !base.includes(current) ? [...base, current] : base;
}

export const COST_UNIT_LABELS: Record<CostUnit, string> = {
  PER_PERSON: "per person",
  PER_GROUP: "per group",
};

// Prisma Decimal doesn't serialize cleanly into Client Components — flatten to a
// number at the server/client boundary.
export type SerializedCost = Omit<
  Cost,
  "amount" | "confirmedAt" | "validFrom" | "validTo"
> & {
  amount: number;
  confirmedAt: string | null;
  validFrom: string | null; // "yyyy-mm-dd"
  validTo: string | null;
};

export function serializeCost(cost: Cost): SerializedCost {
  return {
    ...cost,
    amount: Number(cost.amount),
    confirmedAt: cost.confirmedAt ? cost.confirmedAt.toISOString() : null,
    validFrom: cost.validFrom ? cost.validFrom.toISOString().slice(0, 10) : null,
    validTo: cost.validTo ? cost.validTo.toISOString().slice(0, 10) : null,
  };
}

// Payment rows cross to Client Components too — same Decimal/Date flattening.
export type SerializedPayment = Omit<Payment, "amount" | "paidOn" | "createdAt"> & {
  amount: number;
  paidOn: string; // "yyyy-mm-dd"
  createdAt: string;
};

export function serializePayment(payment: Payment): SerializedPayment {
  return {
    ...payment,
    amount: Number(payment.amount),
    paidOn: toDateInput(payment.paidOn),
    createdAt: payment.createdAt.toISOString(),
  };
}

const STALE_MS = 365 * 24 * 3600 * 1000;

// A price is "stale" if never confirmed or confirmed over a year ago. Defined
// as a plain helper so callers don't invoke Date.now() inside render.
export function isCostStale(confirmedAt: Date | string | null): boolean {
  if (!confirmedAt) return true;
  const ms =
    typeof confirmedAt === "string"
      ? new Date(confirmedAt).getTime()
      : confirmedAt.getTime();
  return Date.now() - ms > STALE_MS;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to a plain number + code.
    return `${amount.toFixed(2)} ${currency}`;
  }
}
