import { describe, expect, it } from "vitest";
import {
  buildMealPlan,
  guessMealKind,
  isMealCategoryName,
  mealText,
  type MealDayLike,
  type MealItemLike,
} from "./meals";

const sarum = { id: "sarum", name: "Sarum College" };
const services = { id: "services", name: "Motorway Services" };

function meal(id: string, over: Partial<MealItemLike>): MealItemLike {
  return {
    id,
    title: null,
    startTime: null,
    mealKind: "LUNCH",
    mealProvision: null,
    sites: [],
    ...over,
  };
}

describe("guessMealKind", () => {
  it("reads the meal from the title", () => {
    expect(guessMealKind("Packed Breakfast & Take-Away Coffee")).toBe("BREAKFAST");
    expect(guessMealKind("Sunday Roast")).toBe("LUNCH");
    expect(guessMealKind("Supper en route")).toBe("DINNER");
    expect(guessMealKind("Banquet")).toBe("DINNER");
    expect(guessMealKind("Drinks Reception")).toBe("REFRESHMENTS");
    expect(guessMealKind("Orientation")).toBeNull();
    expect(guessMealKind(null)).toBeNull();
  });
});

describe("isMealCategoryName", () => {
  it("matches meal-like categories only", () => {
    expect(isMealCategoryName("Meal")).toBe(true);
    expect(isMealCategoryName("Lunch")).toBe(true);
    expect(isMealCategoryName("Worship")).toBe(false);
    expect(isMealCategoryName(null)).toBe(false);
  });
});

describe("mealText", () => {
  it("names the meal and how it is provided", () => {
    expect(mealText({ mealKind: "LUNCH", mealProvision: "ON_OWN" })).toBe("Lunch · On own");
    expect(mealText({ mealKind: "DINNER", mealProvision: null })).toBe("Dinner");
    expect(mealText({ mealKind: null, mealProvision: "VENUE" })).toBeNull();
  });
});

describe("buildMealPlan", () => {
  const days: MealDayLike[] = [
    {
      id: "d1",
      dayIndex: 1,
      date: "2026-07-06",
      title: "Arrival",
      items: [
        meal("i1", { mealKind: "LUNCH", mealProvision: "VENUE", sites: [{ location: sarum }] }),
        meal("i2", { mealKind: "DINNER", mealProvision: "VENUE", sites: [{ location: sarum }] }),
        // Not a meal.
        meal("i3", { mealKind: null, sites: [{ location: sarum }] }),
      ],
    },
    {
      id: "d2",
      dayIndex: 2,
      date: "2026-07-07",
      title: null,
      items: [
        // Site-less packed breakfast: provided by last night's lodging.
        meal("i4", { mealKind: "BREAKFAST", mealProvision: "TAKEAWAY" }),
        meal("i5", { mealKind: "LUNCH", mealProvision: "ON_OWN" }),
        meal("i6", { mealKind: "DINNER", mealProvision: null, sites: [{ location: services }] }),
      ],
    },
  ];
  const lodging = {
    d1: { locationId: "sarum", locationName: "Sarum College" },
    d2: null,
  };

  it("lists each day's meals with their provider", () => {
    const plan = buildMealPlan(days, lodging);
    expect(plan.total).toBe(5);
    expect(plan.days[0].meals.map((m) => m.itemId)).toEqual(["i1", "i2"]);
    expect(plan.days[1].meals[0]).toEqual({
      itemId: "i4",
      kind: "BREAKFAST",
      provision: "TAKEAWAY",
      venue: sarum,
    });
    // A meal on own has no provider.
    expect(plan.days[1].meals[1].venue).toBeNull();
  });

  it("counts venue-provided meals per venue and the rest by provision", () => {
    const plan = buildMealPlan(days, lodging);
    expect(plan.byVenue).toEqual([
      {
        venue: sarum,
        counts: { BREAKFAST: 1, LUNCH: 1, DINNER: 1, REFRESHMENTS: 0 },
        total: 3,
      },
    ]);
    expect(plan.byProvision).toEqual({ VENUE: 2, TAKEAWAY: 1, RESTAURANT: 0, ON_OWN: 1 });
    // The services supper has no provision yet — not counted for the venue.
    expect(plan.unset).toBe(1);
  });

  it("is empty without meal items", () => {
    const plan = buildMealPlan([{ ...days[0], items: [meal("x", { mealKind: null })] }]);
    expect(plan.total).toBe(0);
    expect(plan.byVenue).toEqual([]);
  });
});
