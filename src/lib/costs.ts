import type { CostUnit } from "@prisma/client";
import { formatMoney, isCostStale } from "./money";

// Cost rollups are estimates only (plan decision 6) and per-currency — a trip
// type is single-currency, so no FX conversion. Per-person costs scale with the
// participant count; per-group costs are charged once.

export type CostLike = {
  amount: number;
  currency: string;
  unit: CostUnit;
};

export type CurrencyRollup = {
  currency: string;
  // Sum of per-person amounts (cost for ONE head).
  perPersonPerHead: number;
  // Sum of per-group amounts (charged once regardless of headcount).
  perGroup: number;
  participantCount: number;
  // perPersonPerHead × participantCount + perGroup.
  total: number;
};

/**
 * Roll reference costs up to per-currency trip estimates.
 * `participantCount` null → treated as 0 (per-person lines contribute nothing
 * until a headcount is set; the UI surfaces that).
 */
export function rollUpCosts(
  costs: CostLike[],
  participantCount: number | null,
): CurrencyRollup[] {
  const heads = participantCount ?? 0;
  const byCurrency = new Map<string, { perPersonPerHead: number; perGroup: number }>();

  for (const c of costs) {
    const entry = byCurrency.get(c.currency) ?? { perPersonPerHead: 0, perGroup: 0 };
    if (c.unit === "PER_PERSON") entry.perPersonPerHead += c.amount;
    else entry.perGroup += c.amount;
    byCurrency.set(c.currency, entry);
  }

  return [...byCurrency.entries()]
    .map(([currency, { perPersonPerHead, perGroup }]) => ({
      currency,
      perPersonPerHead,
      perGroup,
      participantCount: heads,
      total: perPersonPerHead * heads + perGroup,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * The trip's headcount for per-person pricing: confirmed participants, else
 * capacity (the same fallback the trip overview's cost estimate uses). Null when
 * neither is set.
 */
export function tripHeadcount(trip: {
  participantCount?: number | null;
  capacity?: number | null;
}): number | null {
  return trip.participantCount ?? trip.capacity ?? null;
}

/**
 * The currency a trip's new stays, bookings and price lines start in: its
 * explicit default, else the first of its currency set, else USD (legacy rows).
 */
export function tripDefaultCurrency(trip: {
  defaultCurrency?: string | null;
  currencies?: string[] | null;
}): string {
  return trip.defaultCurrency ?? trip.currencies?.[0] ?? "USD";
}

// One line of a booking's agreed price (`BookingPriceLine`), mirroring the
// venue's Cost lines. Amount is in the booking's `agreedCurrency`.
export type PriceLine = {
  label: string;
  amount: number;
  unit: CostUnit;
};

/** The Prisma `priceLines` relation select every booking query spreads. */
export const PRICE_LINES_SELECT = {
  orderBy: { order: "asc" },
  select: { label: true, amount: true, unit: true, order: true },
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Prisma rows (Decimal amounts) → plain, ordered PriceLines — safe to pass to a
 * Client Component. Accepts anything `Number()` can read (Decimal, string).
 */
export function serializePriceLines(
  lines: { label: string; amount: unknown; unit: CostUnit; order?: number }[],
): PriceLine[] {
  return [...lines]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((l) => ({ label: l.label, amount: Number(l.amount), unit: l.unit }));
}

/** A booking has an agreed price once it carries at least one price line. */
export function hasAgreedPrice(lines: readonly PriceLine[]): boolean {
  return lines.length > 0;
}

/** Per-person sum (cost for ONE head) and per-group sum of a line set. */
export function priceLineSums(lines: readonly PriceLine[]): {
  perPerson: number;
  perGroup: number;
  hasPerPerson: boolean;
} {
  let perPerson = 0;
  let perGroup = 0;
  let hasPerPerson = false;
  for (const l of lines) {
    if (l.unit === "PER_PERSON") {
      perPerson += l.amount;
      hasPerPerson = true;
    } else perGroup += l.amount;
  }
  return { perPerson: round2(perPerson), perGroup: round2(perGroup), hasPerPerson };
}

/**
 * The agreed engagement TOTAL a booking's balance, settled state and payment
 * schedule are measured against: per-person lines × the trip headcount plus the
 * per-group lines — so it follows the headcount as it changes. Null when there
 * are no lines, or per-person lines with no known headcount — the total is then
 * unknown, and callers treat it like no agreed price.
 */
export function agreedTotal(
  lines: readonly PriceLine[],
  headcount: number | null,
): number | null {
  if (!hasAgreedPrice(lines)) return null;
  const { perPerson, perGroup, hasPerPerson } = priceLineSums(lines);
  if (!hasPerPerson) return perGroup;
  if (headcount == null) return null;
  return round2(perPerson * headcount + perGroup);
}

/**
 * Compact one-line breakdown of a price-line set:
 * "Admission £12.00 + Lunch £20.00 /person × 40 + Group charge £90.00 = £1,370.00".
 * Per-person lines come first (with "/person × N", or "/person" alone when the
 * headcount is unknown — no total then); per-group lines follow. A single
 * per-group line is just its amount. Empty string for no lines.
 */
export function formatPriceBreakdown(
  lines: readonly PriceLine[],
  currency: string,
  headcount: number | null,
): string {
  if (lines.length === 0) return "";
  const fmt = (l: PriceLine) =>
    `${l.label.trim() ? `${l.label.trim()} ` : ""}${formatMoney(l.amount, currency)}`;
  const pp = lines.filter((l) => l.unit === "PER_PERSON");
  const grp = lines.filter((l) => l.unit !== "PER_PERSON");
  const parts: string[] = [];
  if (pp.length > 0) {
    parts.push(
      `${pp.map(fmt).join(" + ")} /person${headcount != null ? ` × ${headcount}` : ""}`,
    );
  }
  parts.push(...grp.map(fmt));
  const total = agreedTotal(lines, headcount);
  if (lines.length === 1 && pp.length === 0) return formatMoney(lines[0].amount, currency);
  return total != null ? `${parts.join(" + ")} = ${formatMoney(total, currency)}` : parts.join(" + ");
}

// A list-price line copied into the editor; `stale` flags a catalog price
// unconfirmed for 1+ year (`isCostStale`) so the copy is checked, not trusted.
export type ListPriceLine = PriceLine & { stale: boolean };

export type ListPriceLines = {
  currency: string;
  lines: ListPriceLine[];
  skipped: number; // venue lines in another currency, left out
};

/**
 * The venue's list prices (its Cost catalog) as agreed-price lines, copied 1:1
 * (label, amount, unit) — no collapsing, so a mixed set keeps following the
 * headcount. A booking has one currency: lines are taken in `preferredCurrency`
 * (the booking's) when the venue lists any in it, else the venue's most-used
 * currency; lines in other currencies are counted in `skipped`. Each line
 * carries `stale` from the cost's `confirmedAt` (a cost without the field is
 * not flagged). Null when the venue has no list prices.
 */
export function listPriceLines(
  costs: (CostLike & { label: string; confirmedAt?: Date | string | null })[],
  preferredCurrency?: string | null,
): ListPriceLines | null {
  if (costs.length === 0) return null;
  let currency: string;
  if (preferredCurrency && costs.some((c) => c.currency === preferredCurrency)) {
    currency = preferredCurrency;
  } else {
    const counts = new Map<string, number>();
    for (const c of costs) counts.set(c.currency, (counts.get(c.currency) ?? 0) + 1);
    currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  const lines = costs
    .filter((c) => c.currency === currency)
    .map((c) => ({
      label: c.label,
      amount: c.amount,
      unit: c.unit,
      stale: c.confirmedAt !== undefined && isCostStale(c.confirmedAt),
    }));
  return { currency, lines, skipped: costs.length - lines.length };
}

// --- Validity windows (active-dates table on the venue's price list) ---------

export type CostValidity = {
  validFrom?: Date | string | null;
  validTo?: Date | string | null;
};

const dateMs = (d: Date | string) =>
  typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00.000Z`).getTime() : d.getTime();

/**
 * Whether a list price applies on a date: inside [validFrom, validTo] where
 * set (either bound open). An undated line always applies — the ordinary case.
 */
export function costAppliesOn(cost: CostValidity, on: Date): boolean {
  const t = on.getTime();
  if (cost.validFrom && dateMs(cost.validFrom) > t) return false;
  if (cost.validTo && dateMs(cost.validTo) < t) return false;
  return true;
}

/**
 * The venue's price list in force on a date — the trip's start date, or today
 * for a date-less trip. A future price change is entered as a dated line
 * (e.g. "Admission £14 from 2027-04-01") beside the current one, so each trip
 * is estimated and defaulted at the price it will actually pay.
 */
export function effectiveCosts<T extends CostValidity>(costs: T[], on: Date): T[] {
  return costs.filter((c) => costAppliesOn(c, on));
}
