import { describe, expect, it } from "vitest";
import {
  shiftStayDates,
  shiftStayIndicesForDeletedDay,
  startDateShiftDays,
} from "./stay-shift";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("startDateShiftDays", () => {
  it("counts whole days between the old and new start", () => {
    expect(startDateShiftDays(d("2026-07-06"), d("2026-07-09"))).toBe(3);
    expect(startDateShiftDays(d("2026-07-06"), d("2026-07-01"))).toBe(-5);
    expect(startDateShiftDays(d("2026-07-06"), d("2026-07-06"))).toBe(0);
  });

  it("spans month and year boundaries", () => {
    expect(startDateShiftDays(d("2026-12-30"), d("2027-01-02"))).toBe(3);
  });

  it("is 0 when either side is date-less", () => {
    expect(startDateShiftDays(null, d("2026-07-06"))).toBe(0);
    expect(startDateShiftDays(d("2026-07-06"), null)).toBe(0);
  });
});

describe("shiftStayDates", () => {
  it("moves both ends, preserving the stay's length", () => {
    expect(
      shiftStayDates({ checkIn: d("2026-07-06"), checkOut: d("2026-07-09") }, 7),
    ).toEqual({ checkIn: d("2026-07-13"), checkOut: d("2026-07-16") });
  });
});

describe("shiftStayIndicesForDeletedDay", () => {
  it("leaves a stay entirely before the deleted day alone", () => {
    expect(
      shiftStayIndicesForDeletedDay({ checkInDayIndex: 1, checkOutDayIndex: 3 }, 4),
    ).toEqual({ kind: "unchanged" });
  });

  it("pulls a later stay down by one day", () => {
    expect(
      shiftStayIndicesForDeletedDay({ checkInDayIndex: 5, checkOutDayIndex: 8 }, 3),
    ).toEqual({ kind: "shift", checkInDayIndex: 4, checkOutDayIndex: 7 });
  });

  it("shortens a stay that spans the deleted day by one night", () => {
    expect(
      shiftStayIndicesForDeletedDay({ checkInDayIndex: 2, checkOutDayIndex: 6 }, 4),
    ).toEqual({ kind: "shift", checkInDayIndex: 2, checkOutDayIndex: 5 });
  });

  it("keeps check-in when the deleted day is the check-in day", () => {
    // Nights 3,4 → the deleted day's night goes; the next day takes its place.
    expect(
      shiftStayIndicesForDeletedDay({ checkInDayIndex: 3, checkOutDayIndex: 5 }, 3),
    ).toEqual({ kind: "shift", checkInDayIndex: 3, checkOutDayIndex: 4 });
  });

  it("leaves a stay checking out on the deleted day alone", () => {
    expect(
      shiftStayIndicesForDeletedDay({ checkInDayIndex: 1, checkOutDayIndex: 3 }, 3),
    ).toEqual({ kind: "unchanged" });
  });

  it("reports (never drops) a one-night stay on only the deleted day", () => {
    expect(
      shiftStayIndicesForDeletedDay({ checkInDayIndex: 3, checkOutDayIndex: 4 }, 3),
    ).toEqual({ kind: "collapsed" });
  });
});
