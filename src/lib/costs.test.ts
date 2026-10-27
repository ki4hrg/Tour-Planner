import { describe, it, expect } from "vitest";
import {
  agreedTotal,
  listPriceSuggestion,
  rollUpCosts,
  tripHeadcount,
  type CostLike,
} from "./costs";

const costs: CostLike[] = [
  { amount: 10, currency: "GBP", unit: "PER_PERSON" },
  { amount: 5, currency: "GBP", unit: "PER_PERSON" },
  { amount: 100, currency: "GBP", unit: "PER_GROUP" },
  { amount: 20, currency: "USD", unit: "PER_PERSON" },
];

describe("rollUpCosts", () => {
  it("groups by currency and totals per-person × heads + per-group", () => {
    const out = rollUpCosts(costs, 4);
    const gbp = out.find((r) => r.currency === "GBP")!;
    expect(gbp.perPersonPerHead).toBe(15);
    expect(gbp.perGroup).toBe(100);
    expect(gbp.total).toBe(15 * 4 + 100); // 160
    const usd = out.find((r) => r.currency === "USD")!;
    expect(usd.total).toBe(20 * 4); // 80
  });

  it("sorts currencies alphabetically", () => {
    expect(rollUpCosts(costs, 1).map((r) => r.currency)).toEqual(["GBP", "USD"]);
  });

  it("treats a null participant count as zero heads", () => {
    const gbp = rollUpCosts(costs, null).find((r) => r.currency === "GBP")!;
    expect(gbp.participantCount).toBe(0);
    expect(gbp.total).toBe(100); // only the per-group line
  });

  it("returns an empty array for no costs", () => {
    expect(rollUpCosts([], 10)).toEqual([]);
  });
});

describe("tripHeadcount", () => {
  it("prefers participants, falls back to capacity, else null", () => {
    expect(tripHeadcount({ participantCount: 32, capacity: 40 })).toBe(32);
    expect(tripHeadcount({ participantCount: null, capacity: 40 })).toBe(40);
    expect(tripHeadcount({ participantCount: 0, capacity: 40 })).toBe(0);
    expect(tripHeadcount({})).toBeNull();
  });
});

describe("agreedTotal", () => {
  it("null or PER_GROUP unit is already the total", () => {
    expect(agreedTotal({ agreedAmount: 600, agreedUnit: null }, 40)).toBe(600);
    expect(agreedTotal({ agreedAmount: 600 }, null)).toBe(600);
    expect(agreedTotal({ agreedAmount: 600, agreedUnit: "PER_GROUP" }, 40)).toBe(600);
  });

  it("PER_PERSON multiplies the rate by headcount", () => {
    expect(agreedTotal({ agreedAmount: 15, agreedUnit: "PER_PERSON" }, 40)).toBe(600);
    expect(agreedTotal({ agreedAmount: 12.5, agreedUnit: "PER_PERSON" }, 3)).toBe(37.5);
    expect(agreedTotal({ agreedAmount: 0.1, agreedUnit: "PER_PERSON" }, 3)).toBe(0.3);
  });

  it("PER_PERSON with unknown headcount has no known total", () => {
    expect(agreedTotal({ agreedAmount: 15, agreedUnit: "PER_PERSON" }, null)).toBeNull();
  });

  it("no agreed amount is no total", () => {
    expect(agreedTotal({ agreedAmount: null, agreedUnit: "PER_PERSON" }, 40)).toBeNull();
    expect(agreedTotal({ agreedAmount: null }, 40)).toBeNull();
  });
});

describe("listPriceSuggestion", () => {
  const cost = (label: string, amount: number, unit: "PER_PERSON" | "PER_GROUP", currency = "GBP") => ({
    label,
    amount,
    unit,
    currency,
  });

  it("sums per-person lines into a per-person rate", () => {
    const s = listPriceSuggestion([cost("Admission", 12, "PER_PERSON"), cost("Lunch", 20, "PER_PERSON")], 40);
    expect(s).toMatchObject({ amount: 32, perPerson: true, currency: "GBP" });
  });

  it("totals a mix of per-person and per-group lines with the headcount", () => {
    const s = listPriceSuggestion(
      [cost("Admission", 12, "PER_PERSON"), cost("Lunch", 20, "PER_PERSON"), cost("Group charge", 90, "PER_GROUP")],
      40,
    );
    expect(s).toMatchObject({ amount: 1370, perPerson: false });
    expect(s?.groupLines).toEqual([{ label: "Group charge", amount: 90 }]);
  });

  it("can't total a mixed set without a headcount", () => {
    expect(
      listPriceSuggestion([cost("Admission", 12, "PER_PERSON"), cost("Guide", 90, "PER_GROUP")], null),
    ).toBeNull();
  });

  it("sums per-group lines as a total and skips other currencies", () => {
    const s = listPriceSuggestion(
      [cost("Hall", 200, "PER_GROUP"), cost("Guide", 90, "PER_GROUP"), cost("Parking", 30, "PER_GROUP", "USD")],
      null,
    );
    expect(s).toMatchObject({ amount: 290, perPerson: false, currency: "GBP", skipped: 1 });
  });
});
