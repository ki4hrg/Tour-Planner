import { describe, it, expect } from "vitest";
import {
  nightsBetween,
  stayTotal,
  rollUpStays,
  lodgingByNight,
  lodgingForDays,
  lodgingCoverage,
} from "./stays";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("nightsBetween", () => {
  it("counts [checkIn, checkOut) — checkout morning is not a night", () => {
    expect(nightsBetween(d("2026-07-06"), d("2026-07-08"))).toBe(2);
  });
  it("is 0 for same-day and reversed spans", () => {
    expect(nightsBetween(d("2026-07-06"), d("2026-07-06"))).toBe(0);
    expect(nightsBetween(d("2026-07-08"), d("2026-07-06"))).toBe(0);
  });
});

describe("stayTotal", () => {
  it("= perPersonPerNight × headcount × nights", () => {
    expect(
      stayTotal({
        checkIn: d("2026-07-06"),
        checkOut: d("2026-07-08"),
        headcount: 10,
        costPerPersonPerNight: 50,
      }),
    ).toBe(1000);
  });
  it("counts template stays by day number", () => {
    expect(
      stayTotal({
        checkIn: null,
        checkOut: null,
        checkInDayIndex: 2,
        checkOutDayIndex: 4,
        headcount: 10,
        costPerPersonPerNight: 50,
      }),
    ).toBe(1000);
  });
  it("is 0 when any factor is missing", () => {
    const span = { checkIn: d("2026-07-06"), checkOut: d("2026-07-08") };
    expect(stayTotal({ ...span, headcount: 10 })).toBe(0);
    expect(stayTotal({ ...span, costPerPersonPerNight: 50 })).toBe(0);
  });
});

describe("rollUpStays", () => {
  it("sums per currency and does NOT dedupe overlapping nights", () => {
    const base = {
      checkIn: d("2026-07-06"),
      checkOut: d("2026-07-16"),
      headcount: 10,
      costPerPersonPerNight: 50,
      currency: "GBP",
    }; // 10 nights × 10 × 50 = 5000
    const excursion = {
      checkIn: d("2026-07-09"),
      checkOut: d("2026-07-10"),
      headcount: 10,
      costPerPersonPerNight: 40,
      currency: "GBP",
    }; // 1 night × 10 × 40 = 400 — overlaps the base, still counted
    expect(rollUpStays([base, excursion])).toEqual([
      { currency: "GBP", total: 5400 },
    ]);
  });
  it("drops zero-cost stays", () => {
    expect(
      rollUpStays([{ checkIn: d("2026-07-06"), checkOut: d("2026-07-08") }]),
    ).toEqual([]);
  });
});

describe("lodgingByNight (overlap resolution)", () => {
  const base = { id: "sarum", checkIn: d("2026-07-06"), checkOut: d("2026-07-16"), priority: 0 };
  const excursion = { id: "hayes", checkIn: d("2026-07-09"), checkOut: d("2026-07-10"), priority: 1 };

  it("higher priority wins the overlapping night; base covers the rest", () => {
    const nights = [d("2026-07-08"), d("2026-07-09"), d("2026-07-10")];
    const out = lodgingByNight([base, excursion], nights).map((s) => s?.id ?? null);
    expect(out).toEqual(["sarum", "hayes", "sarum"]);
  });
  it("returns null for an uncovered night (checkout morning is exclusive)", () => {
    expect(lodgingByNight([base], [d("2026-07-16")])[0]).toBeNull();
  });
  it("breaks priority ties by the shorter span", () => {
    const long = { id: "long", checkIn: d("2026-07-06"), checkOut: d("2026-07-12"), priority: 0 };
    const short = { id: "short", checkIn: d("2026-07-08"), checkOut: d("2026-07-09"), priority: 0 };
    expect(lodgingByNight([long, short], [d("2026-07-08")])[0]?.id).toBe("short");
  });
});

describe("lodgingForDays", () => {
  const base = { id: "sarum", checkIn: d("2026-07-06"), checkOut: d("2026-07-08"), priority: 0 };

  it("keys each day's covering stay by the day id", () => {
    const days = [
      { id: "day6", date: d("2026-07-06") },
      { id: "day7", date: d("2026-07-07") },
      { id: "day8", date: d("2026-07-08") }, // checkout morning — no night
    ];
    const out = lodgingForDays(days, [base]);
    expect(out.get("day6")?.id).toBe("sarum");
    expect(out.get("day7")?.id).toBe("sarum");
    expect(out.get("day8")).toBeNull();
  });

  it("maps dateless days to null without consuming a night slot", () => {
    const days = [
      { id: "undated", date: null },
      { id: "day6", date: d("2026-07-06") },
    ];
    const out = lodgingForDays(days, [base]);
    expect(out.get("undated")).toBeNull();
    expect(out.get("day6")?.id).toBe("sarum");
  });

  it("resolves template days by 1-based day index (no dates)", () => {
    // A date-less template: days carry a dayIndex, stays carry day-index anchors.
    const templateStay = {
      id: "sarum",
      checkIn: null,
      checkOut: null,
      checkInDayIndex: 1,
      checkOutDayIndex: 3, // checkout the morning of day 3 — nights on days 1 & 2
      priority: 0,
    };
    const days = [
      { id: "d1", date: null, dayIndex: 1 },
      { id: "d2", date: null, dayIndex: 2 },
      { id: "d3", date: null, dayIndex: 3 }, // checkout morning — no night
    ];
    const out = lodgingForDays(days, [templateStay]);
    expect(out.get("d1")?.id).toBe("sarum");
    expect(out.get("d2")?.id).toBe("sarum");
    expect(out.get("d3")).toBeNull();
  });

  it("higher priority wins on template day-index overlap", () => {
    const baseStay = { id: "base", checkIn: null, checkOut: null, checkInDayIndex: 1, checkOutDayIndex: 4, priority: 0 };
    const excursion = { id: "exc", checkIn: null, checkOut: null, checkInDayIndex: 2, checkOutDayIndex: 3, priority: 1 };
    const days = [{ id: "d2", date: null, dayIndex: 2 }];
    const out = lodgingForDays(days, [baseStay, excursion]);
    expect(out.get("d2")?.id).toBe("exc");
  });
});

describe("lodgingCoverage", () => {
  it("has one entry per night (the departure day has none), flagging gaps + overlaps", () => {
    const days = [
      { id: "d1", date: d("2026-07-06") },
      { id: "d2", date: d("2026-07-07") },
      { id: "d3", date: d("2026-07-08") },
      { id: "d4", date: d("2026-07-09") }, // departure — no night
    ];
    const base = { id: "base", checkIn: d("2026-07-06"), checkOut: d("2026-07-08"), priority: 0 };
    const excursion = { id: "exc", checkIn: d("2026-07-07"), checkOut: d("2026-07-08"), priority: 0 };
    const out = lodgingCoverage(days, [base, excursion]);
    expect(out.map((n) => n.dayId)).toEqual(["d1", "d2", "d3"]);
    expect(out.map((n) => n.stay?.id ?? null)).toEqual(["base", "exc", null]);
    expect(out.map((n) => n.covering)).toEqual([1, 2, 0]);
  });

  it("matches date-less template days by day index", () => {
    const days = [
      { id: "t1", date: null, dayIndex: 1 },
      { id: "t2", date: null, dayIndex: 2 },
      { id: "t3", date: null, dayIndex: 3 },
    ];
    const stay = { id: "s", checkIn: null, checkOut: null, checkInDayIndex: 1, checkOutDayIndex: 2 };
    const out = lodgingCoverage(days, [stay]);
    expect(out.map((n) => n.stay?.id ?? null)).toEqual(["s", null]);
  });

  it("is empty for a one-day (or empty) trip", () => {
    expect(lodgingCoverage([{ id: "x", date: d("2026-07-06") }], [])).toEqual([]);
    expect(lodgingCoverage([], [])).toEqual([]);
  });
});
