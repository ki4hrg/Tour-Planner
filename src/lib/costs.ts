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
