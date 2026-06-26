// Pure lodging helpers. Stays are date-only spans ([checkIn, checkOut) — the
// checkout morning is NOT a night), MAY overlap, and each carries its own cost.
// Operate in UTC (dates are `@db.Date`) to avoid off-by-one shifts.

const DAY_MS = 24 * 60 * 60 * 1000;

export type StayLike = {
  checkIn: Date;
  checkOut: Date;
  headcount?: number | null;
  costPerPersonPerNight?: number | null;
  currency?: string;
  priority?: number;
};

/** Nights in [checkIn, checkOut). The checkout morning has no night (watch the
 * off-by-one): Jul 6 → Jul 8 is 2 nights (6th, 7th). Negative spans clamp to 0. */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  const n = Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
  return n > 0 ? n : 0;
}

/** Cost of a whole stay = perPersonPerNight × headcount × nights. Any missing
 * factor → 0 (the estimate simply doesn't count it). */
export function stayTotal(stay: StayLike): number {
  const perNight = stay.costPerPersonPerNight ?? 0;
  const heads = stay.headcount ?? 0;
  return perNight * heads * nightsBetween(stay.checkIn, stay.checkOut);
}

export type StayCurrencyTotal = { currency: string; total: number };

/** Per-currency sum of stay totals. Overlap is legitimate — do NOT dedupe nights
 * across stays (you really pay both the held base room and the excursion). */
export function rollUpStays(stays: StayLike[]): StayCurrencyTotal[] {
  const byCurrency = new Map<string, number>();
  for (const s of stays) {
    const total = stayTotal(s);
    if (total === 0) continue;
    const currency = s.currency ?? "USD";
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + total);
  }
  return [...byCurrency.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** True when a stay covers the night of date `night` (checkIn ≤ night < checkOut). */
function covers(stay: { checkIn: Date; checkOut: Date }, night: Date): boolean {
  const t = night.getTime();
  return stay.checkIn.getTime() <= t && t < stay.checkOut.getTime();
}

/**
 * "Tonight's bed" per night: the covering stay with the highest `priority`
 * (ties broken by the shortest span — an excursion overrides the base). Returns
 * one entry per input night date (null when nothing covers it).
 */
export function lodgingByNight<T extends { checkIn: Date; checkOut: Date; priority?: number }>(
  stays: T[],
  nights: Date[],
): (T | null)[] {
  return nights.map((night) => {
    const covering = stays.filter((s) => covers(s, night));
    if (covering.length === 0) return null;
    return covering.reduce((best, s) => {
      const bp = best.priority ?? 0;
      const sp = s.priority ?? 0;
      if (sp !== bp) return sp > bp ? s : best;
      // tie on priority → shorter span wins (the more specific override)
      const bSpan = nightsBetween(best.checkIn, best.checkOut);
      const sSpan = nightsBetween(s.checkIn, s.checkOut);
      return sSpan < bSpan ? s : best;
    });
  });
}
