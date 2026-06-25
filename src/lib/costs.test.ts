import { describe, it, expect } from "vitest";
import { rollUpCosts, type CostLike } from "./costs";

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
