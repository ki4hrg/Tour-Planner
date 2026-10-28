import { describe, it, expect } from "vitest";
import {
  agreedTotal,
  effectiveCosts,
  formatPriceBreakdown,
  hasAgreedPrice,
  listPriceLines,
  priceLineSums,
  rollUpCosts,
  serializePriceLines,
  tripHeadcount,
  type CostLike,
  type PriceLine,
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


const pp = (label: string, amount: number): PriceLine => ({ label, amount, unit: "PER_PERSON" });
const grp = (label: string, amount: number): PriceLine => ({ label, amount, unit: "PER_GROUP" });

describe("agreedTotal", () => {
  it("no lines is no agreed price", () => {
    expect(agreedTotal([], 40)).toBeNull();
    expect(hasAgreedPrice([])).toBe(false);
    expect(hasAgreedPrice([grp("Hall", 0)])).toBe(true);
  });

  it("per-group lines sum to the total, headcount or not", () => {
    expect(agreedTotal([grp("Hall", 600)], 40)).toBe(600);
    expect(agreedTotal([grp("Hall", 200), grp("Guide", 90)], null)).toBe(290);
  });

  it("per-person lines multiply by the headcount", () => {
    expect(agreedTotal([pp("Admission", 15)], 40)).toBe(600);
    expect(agreedTotal([pp("Admission", 12.5)], 3)).toBe(37.5);
    expect(agreedTotal([pp("A", 0.1)], 3)).toBe(0.3);
  });

  it("mixes per-person × headcount with per-group lines", () => {
    const lines = [pp("Admission", 12), pp("Lunch", 20), grp("Group charge", 90)];
    expect(agreedTotal(lines, 40)).toBe(1370);
    // follows the headcount
    expect(agreedTotal(lines, 30)).toBe(1050);
  });

  it("per-person lines with unknown headcount have no known total", () => {
    expect(agreedTotal([pp("Admission", 15)], null)).toBeNull();
    expect(agreedTotal([pp("Admission", 15), grp("Hall", 90)], null)).toBeNull();
  });
});

describe("priceLineSums", () => {
  it("splits per-person and per-group sums", () => {
    expect(priceLineSums([pp("A", 12), pp("L", 20.1), grp("G", 90)])).toEqual({
      perPerson: 32.1,
      perGroup: 90,
      hasPerPerson: true,
    });
    expect(priceLineSums([])).toEqual({ perPerson: 0, perGroup: 0, hasPerPerson: false });
  });
});

describe("serializePriceLines", () => {
  it("orders by `order` and converts amounts to numbers", () => {
    expect(
      serializePriceLines([
        { label: "B", amount: "20.00", unit: "PER_GROUP", order: 1 },
        { label: "A", amount: { valueOf: () => 12 }, unit: "PER_PERSON", order: 0 },
      ]),
    ).toEqual([pp("A", 12), grp("B", 20)]);
  });
});

describe("formatPriceBreakdown", () => {
  const lines = [pp("Admission", 12), pp("Lunch", 20), grp("Group", 90)];

  it("shows per-person lines × headcount, group lines and the total", () => {
    expect(formatPriceBreakdown(lines, "GBP", 40)).toBe(
      "Admission £12.00 + Lunch £20.00 /person × 40 + Group £90.00 = £1,370.00",
    );
  });

  it("drops the multiplier and total without a headcount", () => {
    expect(formatPriceBreakdown(lines, "GBP", null)).toBe(
      "Admission £12.00 + Lunch £20.00 /person + Group £90.00",
    );
  });

  it("a single per-group line is just its amount", () => {
    expect(formatPriceBreakdown([grp("Agreed price", 600)], "USD", null)).toBe("$600.00");
  });

  it("is empty for no lines", () => {
    expect(formatPriceBreakdown([], "USD", 10)).toBe("");
  });
});

describe("listPriceLines", () => {
  const cost = (label: string, amount: number, unit: "PER_PERSON" | "PER_GROUP", currency = "GBP") => ({
    label,
    amount,
    unit,
    currency,
  });

  it("copies the venue's lines 1:1, no collapsing", () => {
    const s = listPriceLines([
      cost("Admission", 12, "PER_PERSON"),
      cost("Lunch", 20, "PER_PERSON"),
      cost("Group charge", 90, "PER_GROUP"),
    ]);
    expect(s).toEqual({
      currency: "GBP",
      lines: [pp("Admission", 12), pp("Lunch", 20), grp("Group charge", 90)].map(
        (l) => ({ ...l, stale: false }),
      ),
      skipped: 0,
    });
  });

  it("takes the venue's main currency and skips the rest", () => {
    const s = listPriceLines([
      cost("Hall", 200, "PER_GROUP"),
      cost("Guide", 90, "PER_GROUP"),
      cost("Parking", 30, "PER_GROUP", "USD"),
    ]);
    expect(s).toMatchObject({ currency: "GBP", skipped: 1 });
    expect(s?.lines).toHaveLength(2);
  });

  it("prefers the booking's currency when the venue lists any in it", () => {
    const s = listPriceLines(
      [cost("Hall", 200, "PER_GROUP"), cost("Guide", 90, "PER_GROUP"), cost("Parking", 30, "PER_GROUP", "USD")],
      "USD",
    );
    expect(s).toMatchObject({ currency: "USD", lines: [grp("Parking", 30)], skipped: 2 });
    expect(listPriceLines([cost("Hall", 200, "PER_GROUP")], "EUR")?.currency).toBe("GBP");
  });

  it("is null for a venue with no list prices", () => {
    expect(listPriceLines([])).toBeNull();
  });

  it("flags lines whose list price is stale, and only those", () => {
    const s = listPriceLines([
      { ...cost("Admission", 12, "PER_PERSON"), confirmedAt: new Date() },
      { ...cost("Lunch", 20, "PER_PERSON"), confirmedAt: "2020-01-01T00:00:00.000Z" },
      { ...cost("Guide", 90, "PER_GROUP"), confirmedAt: null },
      cost("Parking", 5, "PER_GROUP"), // no confirmedAt at all — not flagged
    ]);
    expect(s?.lines.map((l) => [l.label, l.stale])).toEqual([
      ["Admission", false],
      ["Lunch", true],
      ["Guide", true],
      ["Parking", false],
    ]);
  });
});

describe("effectiveCosts (active dates)", () => {
  const on = new Date("2027-07-12T00:00:00.000Z");
  const line = (label: string, v: { validFrom?: string | null; validTo?: string | null }) => ({
    label,
    amount: 1,
    currency: "GBP",
    unit: "PER_PERSON" as const,
    ...v,
  });

  it("keeps undated lines and those whose window covers the date", () => {
    const costs = [
      line("always", {}),
      line("current", { validTo: "2027-12-31" }),
      line("next year", { validFrom: "2028-01-01" }),
      line("expired", { validTo: "2026-12-31" }),
      line("window", { validFrom: "2027-07-12", validTo: "2027-07-12" }),
    ];
    expect(effectiveCosts(costs, on).map((c) => c.label)).toEqual([
      "always",
      "current",
      "window",
    ]);
  });

  it("accepts Date bounds too", () => {
    expect(
      effectiveCosts(
        [{ ...line("d", {}), validFrom: new Date("2027-08-01T00:00:00.000Z") }],
        on,
      ),
    ).toEqual([]);
  });
});
