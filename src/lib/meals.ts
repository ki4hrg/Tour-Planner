// Structured meals (pure, unit-tested). A schedule item with a `mealKind` IS a
// meal; `mealProvision` says how it is provided. The meal plan rolls a trip's
// meals up per day (breakfast / lunch / dinner at a glance) and per providing
// venue (the counts a venue needs with final numbers).

import type { MealKind, MealProvision } from "@prisma/client";

export const MEAL_KINDS: MealKind[] = ["BREAKFAST", "LUNCH", "DINNER", "REFRESHMENTS"];

export const MEAL_KIND_LABELS: Record<MealKind, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
  REFRESHMENTS: "Refreshments",
};

export const MEAL_PROVISIONS: MealProvision[] = ["VENUE", "TAKEAWAY", "RESTAURANT", "ON_OWN"];

export const MEAL_PROVISION_LABELS: Record<MealProvision, string> = {
  VENUE: "Venue",
  TAKEAWAY: "Takeaway",
  RESTAURANT: "Restaurant",
  ON_OWN: "On own",
};

// The venue provides it (served there, or packed by it).
export function isVenueProvided(p: MealProvision | null): boolean {
  return p === "VENUE" || p === "TAKEAWAY";
}

// A category that reads as a meal: the item form offers the meal fields.
export function isMealCategoryName(name: string | null | undefined): boolean {
  return !!name && /meal|breakfast|lunch|dinner|supper/i.test(name);
}

// The meal a title most likely names ("Packed Breakfast", "Supper"), so a new
// meal item pre-fills its kind.
export function guessMealKind(title: string | null | undefined): MealKind | null {
  if (!title) return null;
  if (/breakfast/i.test(title)) return "BREAKFAST";
  if (/lunch|roast/i.test(title)) return "LUNCH";
  if (/supper|dinner|banquet/i.test(title)) return "DINNER";
  if (/tea|coffee|refreshment|reception|drinks/i.test(title)) return "REFRESHMENTS";
  return null;
}

// A meal's default name is its meal ("Lunch"): a blank title on a meal item
// takes the kind's label. Null when not a meal or already titled.
export function defaultMealTitle(
  title: string | null | undefined,
  mealKind: MealKind | null | undefined,
): string | null {
  if (title?.trim() || !mealKind) return null;
  return MEAL_KIND_LABELS[mealKind];
}

// "Lunch · On own" — the meal fact a row shows beside its title.
export function mealText(item: {
  mealKind: MealKind | null;
  mealProvision: MealProvision | null;
}): string | null {
  if (!item.mealKind) return null;
  return [
    MEAL_KIND_LABELS[item.mealKind],
    item.mealProvision ? MEAL_PROVISION_LABELS[item.mealProvision] : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type MealItemLike = {
  id: string;
  title: string | null;
  startTime: string | null;
  mealKind: MealKind | null;
  mealProvision: MealProvision | null;
  // Who packs a takeaway eaten elsewhere (loaded by the caller's query).
  mealProvider?: { id: string; name: string } | null;
  sites: { location: { id: string; name: string } }[];
  // A travel leg's en-route stops can carry a meal ("dinner on own at the
  // services").
  travel?: {
    stops: {
      id: string;
      location: { id: string; name: string } | null;
      label: string | null;
      mealKind: MealKind | null;
      mealProvision: MealProvision | null;
    }[];
  } | null;
};

export type MealDayLike = {
  id: string;
  dayIndex: number;
  date: string | null;
  title: string | null;
  items: MealItemLike[];
};

export type MealEntry = {
  itemId: string;
  // Set when the meal is taken at an en-route travel stop.
  stopId?: string;
  // Where it is eaten when that isn't the provider (a takeaway from last
  // night's host eaten at the next site; the services on a coach leg).
  at?: string | null;
  kind: MealKind;
  provision: MealProvision | null;
  // Who provides it: the item's venue; a site-less venue meal (a packed
  // breakfast) falls back to where the group slept the night before.
  venue: { id: string; name: string } | null;
};

export type MealPlanDay = {
  dayId: string;
  dayIndex: number;
  date: string | null;
  title: string | null;
  meals: MealEntry[];
};

export type VenueMealCount = {
  venue: { id: string; name: string };
  counts: Record<MealKind, number>;
  total: number;
};

export type MealPlan = {
  days: MealPlanDay[];
  // Venue-provided meals (served or takeaway) per venue, most first.
  byVenue: VenueMealCount[];
  byProvision: Record<MealProvision, number>;
  // Meals with no provision set yet.
  unset: number;
  total: number;
};

const zeroKinds = (): Record<MealKind, number> => ({
  BREAKFAST: 0,
  LUNCH: 0,
  DINNER: 0,
  REFRESHMENTS: 0,
});

/**
 * Roll a trip's meal items up per day and per providing venue. `lodgingByDay`
 * (day id → where the group sleeps that night) supplies the provider for a
 * site-less venue meal: the previous night's lodging (who packs the breakfast),
 * else the same night's.
 */
export function buildMealPlan(
  days: MealDayLike[],
  lodgingByDay: Record<string, { locationId?: string | null; locationName: string } | null> = {},
): MealPlan {
  const byVenue = new Map<string, VenueMealCount>();
  const byProvision: Record<MealProvision, number> = {
    VENUE: 0,
    TAKEAWAY: 0,
    RESTAURANT: 0,
    ON_OWN: 0,
  };
  let unset = 0;
  let total = 0;
  const lodgingVenue = (dayId: string | undefined) => {
    const l = dayId ? lodgingByDay[dayId] : null;
    return l?.locationId ? { id: l.locationId, name: l.locationName } : null;
  };

  const out = days.map((day, i) => {
    const meals: MealEntry[] = [];
    const count = (
      entry: MealEntry,
    ) => {
      meals.push(entry);
      total++;
      if (entry.provision) byProvision[entry.provision]++;
      else unset++;
      const venue = entry.venue;
      if (venue && isVenueProvided(entry.provision)) {
        const row =
          byVenue.get(venue.id) ??
          ({ venue, counts: zeroKinds(), total: 0 } satisfies VenueMealCount);
        row.counts[entry.kind]++;
        row.total++;
        byVenue.set(venue.id, row);
      }
    };
    for (const item of day.items) {
      const site = item.sites[0]?.location ?? null;
      if (item.mealKind) {
        // Provider: an explicit takeaway packer, else the item's venue, else
        // (site-less venue meal) the previous night's lodging.
        const provider =
          item.mealProvision === "TAKEAWAY" && item.mealProvider ? item.mealProvider : null;
        const venue = provider
          ? provider
          : site
            ? { id: site.id, name: site.name }
            : isVenueProvided(item.mealProvision)
              ? (lodgingVenue(days[i - 1]?.id) ?? lodgingVenue(day.id))
              : null;
        count({
          itemId: item.id,
          kind: item.mealKind,
          provision: item.mealProvision,
          venue,
          at: provider && site && site.id !== provider.id ? site.name : null,
        });
      }
      for (const stop of item.travel?.stops ?? []) {
        if (!stop.mealKind) continue;
        count({
          itemId: item.id,
          stopId: stop.id,
          kind: stop.mealKind,
          provision: stop.mealProvision,
          // A stop meal is never venue-served; it is where the coach pulls in.
          venue: null,
          at: stop.location?.name ?? stop.label,
        });
      }
    }
    return {
      dayId: day.id,
      dayIndex: day.dayIndex,
      date: day.date,
      title: day.title,
      meals,
    };
  });

  return {
    days: out,
    byVenue: [...byVenue.values()].sort(
      (a, b) => b.total - a.total || a.venue.name.localeCompare(b.venue.name),
    ),
    byProvision,
    unset,
    total,
  };
}
