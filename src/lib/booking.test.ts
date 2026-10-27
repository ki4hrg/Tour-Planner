import { describe, it, expect } from "vitest";
import {
  earliestBookable,
  windowStatus,
  earliestCoveredDate,
  bookingNeedsInfo,
} from "./booking";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("earliestBookable", () => {
  it("subtracts lead days from the start date", () => {
    expect(earliestBookable(d("2026-07-06"), 180)?.toISOString().slice(0, 10)).toBe(
      "2026-01-07",
    );
  });
  it("is null when start date is missing", () => {
    expect(earliestBookable(null, 180)).toBeNull();
  });
  it("is null when lead days is missing", () => {
    expect(earliestBookable(d("2026-07-06"), null)).toBeNull();
  });
  it("equals the start date when lead days is 0", () => {
    expect(earliestBookable(d("2026-07-06"), 0)?.toISOString().slice(0, 10)).toBe(
      "2026-07-06",
    );
  });
});

describe("windowStatus", () => {
  const today = d("2026-06-25");

  it("reports null window when no earliest date", () => {
    expect(windowStatus(null, today)).toEqual({ open: false, daysUntilOpen: null });
  });
  it("is open when earliest is in the past", () => {
    expect(windowStatus(d("2026-01-07"), today)).toEqual({
      open: true,
      daysUntilOpen: expect.any(Number),
    });
    expect(windowStatus(d("2026-01-07"), today).daysUntilOpen).toBeLessThan(0);
  });
  it("is open when earliest is exactly today", () => {
    expect(windowStatus(today, today)).toEqual({ open: true, daysUntilOpen: 0 });
  });
  it("is closed and counts days when earliest is in the future", () => {
    expect(windowStatus(d("2026-07-05"), today)).toEqual({
      open: false,
      daysUntilOpen: 10,
    });
  });
});

describe("earliestCoveredDate", () => {
  it("returns null when nothing has a date", () => {
    expect(earliestCoveredDate([])).toBeNull();
    expect(earliestCoveredDate([null, undefined])).toBeNull();
  });
  it("returns the minimum, ignoring nulls (e.g. an excursion mid-trip)", () => {
    const min = earliestCoveredDate([
      d("2026-07-10"),
      null,
      d("2026-07-06"),
      d("2026-07-08"),
    ]);
    expect(min?.toISOString().slice(0, 10)).toBe("2026-07-06");
  });
});

describe("bookingNeedsInfo", () => {
  const base = {
    status: "PLANNED" as const,
    windowOpen: false,
    hasRef: true,
    isMissingCost: false,
    isMissingTime: false,
    paymentOverdue: false,
  };

  it("flags an open window that is not yet secured", () => {
    expect(bookingNeedsInfo({ ...base, windowOpen: true })).toBe(true);
    expect(
      bookingNeedsInfo({ ...base, status: "IN_PROGRESS", windowOpen: true }),
    ).toBe(true);
  });
  it("does not flag an open window that is already secured", () => {
    expect(
      bookingNeedsInfo({ ...base, status: "CONFIRMED", windowOpen: true }),
    ).toBe(false);
    expect(
      bookingNeedsInfo({ ...base, status: "CONFIRMED", windowOpen: true }),
    ).toBe(false);
  });
  it("flags secured bookings missing a reference", () => {
    expect(bookingNeedsInfo({ ...base, status: "CONFIRMED", hasRef: false })).toBe(
      true,
    );
    expect(bookingNeedsInfo({ ...base, status: "CONFIRMED", hasRef: true })).toBe(
      false,
    );
    expect(bookingNeedsInfo({ ...base, status: "CONFIRMED", hasRef: false })).toBe(
      true,
    );
    expect(bookingNeedsInfo({ ...base, status: "CONFIRMED", hasRef: true })).toBe(
      false,
    );
  });
  it("flags missing price or time regardless of status", () => {
    expect(bookingNeedsInfo({ ...base, isMissingCost: true })).toBe(true);
    expect(bookingNeedsInfo({ ...base, isMissingTime: true })).toBe(true);
  });
  it("flags an overdue scheduled installment regardless of status", () => {
    expect(bookingNeedsInfo({ ...base, paymentOverdue: true })).toBe(true);
    expect(
      bookingNeedsInfo({ ...base, status: "CONFIRMED", paymentOverdue: true }),
    ).toBe(true);
  });
  it("is quiet when everything is in order", () => {
    expect(bookingNeedsInfo({ ...base, status: "CONFIRMED" })).toBe(false);
  });
});
