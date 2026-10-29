import type { MealKind, MealProvision, TravelMethod } from "@prisma/client";

// The validated travel-leg input shape shared by the web action and the MCP
// tool (both zod-parse into this before writing).
export type TravelLegWriteInput = {
  method: string;
  fromLocationId?: string | null;
  fromLabel?: string | null;
  toLocationId?: string | null;
  toLabel?: string | null;
  stops?: {
    locationId?: string | null;
    label?: string | null;
    dwellMinutes?: number | null;
    mealKind?: MealKind | null;
    mealProvision?: MealProvision | null;
  }[];
};

/**
 * Prisma nested create-data for a TravelLeg + its stops (GH #80) — the ONE
 * place input → row mapping lives, so the web editor and MCP write identically.
 */
export function travelLegCreateData(t: TravelLegWriteInput) {
  return {
    method: t.method as TravelMethod,
    fromLocationId: t.fromLocationId || null,
    fromLabel: t.fromLabel || null,
    toLocationId: t.toLocationId || null,
    toLabel: t.toLabel || null,
    stops: {
      create: (t.stops ?? []).map((s, i) => ({
        locationId: s.locationId || null,
        label: s.label || null,
        dwellMinutes: s.dwellMinutes ?? null,
        mealKind: s.mealKind ?? null,
        // A provision only means something on a meal.
        mealProvision: s.mealKind ? (s.mealProvision ?? null) : null,
        order: i,
      })),
    },
  };
}
