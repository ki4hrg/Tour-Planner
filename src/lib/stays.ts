// Pure lodging helpers. Stays are date-only spans ([checkIn, checkOut) — the
// checkout morning is NOT a night), MAY overlap, and each carries its own cost.
// Operate in UTC (dates are `@db.Date`) to avoid off-by-one shifts.

const DAY_MS = 24 * 60 * 60 * 1000;

export type StayLike = {
  // Null on a date-less template stay (day-relative anchors instead); such a stay
  // has no calendar position, so it contributes 0 nights / 0 cost here.
  checkIn: Date | null;
  checkOut: Date | null;
  headcount?: number | null;
  costPerPersonPerNight?: number | null;
  currency?: string;
  priority?: number;
};

/** Nights in [checkIn, checkOut). The checkout morning has no night (watch the
 * off-by-one): Jul 6 → Jul 8 is 2 nights (6th, 7th). Negative spans clamp to 0.
 * A missing endpoint (date-less template stay) → 0 nights. */
export function nightsBetween(
  checkIn: Date | null,
  checkOut: Date | null,
): number {
  if (!checkIn || !checkOut) return 0;
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

/** True when a stay covers the night of date `night` (checkIn ≤ night < checkOut).
 * A date-less template stay (null endpoints) covers nothing. */
function covers(
  stay: { checkIn: Date | null; checkOut: Date | null },
  night: Date,
): boolean {
  if (!stay.checkIn || !stay.checkOut) return false;
  const t = night.getTime();
  return stay.checkIn.getTime() <= t && t < stay.checkOut.getTime();
}

/** True when a day-relative stay covers the night of day `dayIndex`
 * (checkInDayIndex ≤ dayIndex < checkOutDayIndex). The 1-based day-number analog
 * of `covers`, for date-less template stays. A stay with no index anchor (a dated
 * stay) covers nothing here. */
function coversDayIndex(
  stay: { checkInDayIndex?: number | null; checkOutDayIndex?: number | null },
  dayIndex: number,
): boolean {
  if (stay.checkInDayIndex == null || stay.checkOutDayIndex == null) return false;
  return stay.checkInDayIndex <= dayIndex && dayIndex < stay.checkOutDayIndex;
}

/** Shared "tonight's bed" pick: highest `priority` wins; ties broken by the
 * shortest span (the more specific override — an excursion beats the base). */
function pickBed<T extends { priority?: number }>(
  covering: T[],
  spanOf: (s: T) => number,
): T | null {
  if (covering.length === 0) return null;
  return covering.reduce((best, s) => {
    const bp = best.priority ?? 0;
    const sp = s.priority ?? 0;
    if (sp !== bp) return sp > bp ? s : best;
    return spanOf(s) < spanOf(best) ? s : best;
  });
}

/**
 * "Tonight's bed" per night: the covering stay with the highest `priority`
 * (ties broken by the shortest span — an excursion overrides the base). Returns
 * one entry per input night date (null when nothing covers it).
 */
export function lodgingByNight<T extends { checkIn: Date | null; checkOut: Date | null; priority?: number }>(
  stays: T[],
  nights: Date[],
): (T | null)[] {
  return nights.map((night) =>
    pickBed(
      stays.filter((s) => covers(s, night)),
      (s) => nightsBetween(s.checkIn, s.checkOut),
    ),
  );
}

/**
 * Day-number analog of `lodgingByNight` for date-less templates: resolve, per
 * 1-based day index, the day-relative stay the group sleeps in that night. Same
 * priority rules. Returns one entry per input day index (null when uncovered).
 */
export function lodgingByDayIndex<
  T extends { checkInDayIndex?: number | null; checkOutDayIndex?: number | null; priority?: number },
>(stays: T[], dayIndices: number[]): (T | null)[] {
  return dayIndices.map((di) =>
    pickBed(
      stays.filter((s) => coversDayIndex(s, di)),
      (s) => (s.checkOutDayIndex ?? 0) - (s.checkInDayIndex ?? 0),
    ),
  );
}

/**
 * Resolve, per itinerary day, the stay the group sleeps in that night — using the
 * same priority rules for both anchor modes. Dated days match stays by calendar
 * night; date-less template days match day-relative stays by 1-based day index.
 * Days that fit neither mode map to null. Lets the itinerary surface where
 * everyone is staying each night on real trips AND templates (GH #15).
 */
export function lodgingForDays<
  D extends { id: string; date: Date | null; dayIndex?: number },
  S extends {
    checkIn: Date | null;
    checkOut: Date | null;
    checkInDayIndex?: number | null;
    checkOutDayIndex?: number | null;
    priority?: number;
  },
>(days: D[], stays: S[]): Map<string, S | null> {
  const map = new Map<string, S | null>();

  // Dated days → match by calendar night.
  const dated = days.filter((d): d is D & { date: Date } => d.date != null);
  const datedPicks = lodgingByNight(
    stays,
    dated.map((d) => d.date),
  );
  dated.forEach((d, i) => map.set(d.id, datedPicks[i]));

  // Date-less template days (have a dayIndex, no date) → match by day number.
  const templated = days.filter(
    (d): d is D & { dayIndex: number } => d.date == null && d.dayIndex != null,
  );
  const templatedPicks = lodgingByDayIndex(
    stays,
    templated.map((d) => d.dayIndex),
  );
  templated.forEach((d, i) => map.set(d.id, templatedPicks[i]));

  for (const d of days) if (!map.has(d.id)) map.set(d.id, null);
  return map;
}
