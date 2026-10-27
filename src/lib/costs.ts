import type { CostUnit } from "@prisma/client";

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
 * The agreed engagement TOTAL a booking's balance, settled state and payment
 * schedule are measured against. `agreedAmount` is the total unless the unit is
 * PER_PERSON, in which case it is a rate multiplied by the trip headcount.
 * PER_GROUP (legacy) and null both mean "already the total". Returns null when
 * there is no agreed price, or a per-person rate with no known headcount — the
 * total is then unknown, and callers treat it like no agreed price.
 */
export function agreedTotal(
  price: {
    agreedAmount: number | null;
    agreedUnit?: CostUnit | null;
  },
  headcount: number | null,
): number | null {
  if (price.agreedAmount == null) return null;
  if (price.agreedUnit !== "PER_PERSON") return price.agreedAmount;
  if (headcount == null) return null;
  return Math.round(price.agreedAmount * headcount * 100) / 100;
}

export type ListPriceSuggestion = {
  currency: string;
  // What to put in the agreed-price field: a per-person rate when every line
  // is per person (so it keeps scaling with headcount), otherwise a total.
  amount: number;
  perPerson: boolean;
  perPersonLines: { label: string; amount: number }[];
  groupLines: { label: string; amount: number }[];
  headcount: number | null; // used to total per-person lines in a mixed set
  skipped: number; // lines in another currency, left out
};

/**
 * Suggest an agreed price from a venue's list prices (its Cost catalog), which
 * may mix per-person lines (admission, a meal) with per-group ones (a group
 * charge). The agreed price is one amount, so:
 *  - all per person → the summed per-person rate (stays headcount-scaled);
 *  - all per group  → the summed total;
 *  - mixed          → per-person sum × headcount + group sum, as a total
 *                     (null when there's no headcount to total it with).
 * Lines are taken in the venue's most-used currency; others are counted in
 * `skipped`. Returns null when there's nothing to suggest.
 */
export function listPriceSuggestion(
  costs: (CostLike & { label: string })[],
  headcount: number | null,
): ListPriceSuggestion | null {
  if (costs.length === 0) return null;
  const counts = new Map<string, number>();
  for (const c of costs) counts.set(c.currency, (counts.get(c.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const lines = costs.filter((c) => c.currency === currency);

  const perPersonLines = lines
    .filter((c) => c.unit === "PER_PERSON")
    .map((c) => ({ label: c.label, amount: c.amount }));
  const groupLines = lines
    .filter((c) => c.unit !== "PER_PERSON")
    .map((c) => ({ label: c.label, amount: c.amount }));
  const sum = (ls: { amount: number }[]) =>
    Math.round(ls.reduce((t, l) => t + l.amount, 0) * 100) / 100;
  const pp = sum(perPersonLines);
  const grp = sum(groupLines);

  let amount: number;
  let perPerson = false;
  if (groupLines.length === 0) {
    amount = pp;
    perPerson = true;
  } else if (perPersonLines.length === 0) {
    amount = grp;
  } else {
    if (headcount == null) return null;
    amount = Math.round((pp * headcount + grp) * 100) / 100;
  }
  return {
    currency,
    amount,
    perPerson,
    perPersonLines,
    groupLines,
    headcount,
    skipped: costs.length - lines.length,
  };
}
