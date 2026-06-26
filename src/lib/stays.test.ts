import { describe, it, expect } from "vitest";
import {
  nightsBetween,
  stayTotal,
  rollUpStays,
  lodgingByNight,
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
