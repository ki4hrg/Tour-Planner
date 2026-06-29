import { describe, it, expect } from "vitest";
import {
  parseDateInput,
  toDateInput,
  addDays,
  computeDayDate,
  isOngoing,
  todayUtc,
  formatDate,
} from "./dates";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("parseDateInput", () => {
  it("parses yyyy-mm-dd to UTC midnight", () => {
    expect(parseDateInput("2026-07-06")?.toISOString()).toBe(
      "2026-07-06T00:00:00.000Z",
    );
  });
  it("trims surrounding whitespace", () => {
    expect(parseDateInput("  2026-07-06  ")?.toISOString()).toBe(
      "2026-07-06T00:00:00.000Z",
    );
  });
  it("returns null for empty or malformed input", () => {
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput(null)).toBeNull();
    expect(parseDateInput("07/06/2026")).toBeNull();
    expect(parseDateInput("2026-13-40")).toBeNull();
  });
});

describe("toDateInput", () => {
  it("formats a Date to yyyy-mm-dd in UTC", () => {
    expect(toDateInput(d("2026-07-06"))).toBe("2026-07-06");
  });
  it("is empty for null/invalid", () => {
    expect(toDateInput(null)).toBe("");
    expect(toDateInput("not a date")).toBe("");
  });
});

describe("addDays / computeDayDate", () => {
  it("adds days staying on UTC midnight", () => {
    expect(addDays(d("2026-07-06"), 2).toISOString()).toBe(
      "2026-07-08T00:00:00.000Z",
    );
  });
  it("computeDayDate is 1-based: day 1 is the start date", () => {
    expect(computeDayDate(d("2026-07-06"), 1)?.toISOString()).toBe(
      "2026-07-06T00:00:00.000Z",
    );
    expect(computeDayDate(d("2026-07-06"), 3)?.toISOString()).toBe(
      "2026-07-08T00:00:00.000Z",
    );
  });
  it("computeDayDate is null without a start date", () => {
    expect(computeDayDate(null, 1)).toBeNull();
  });
});

describe("isOngoing", () => {
  it("is false without a start date", () => {
    expect(isOngoing(null, null)).toBe(false);
  });
  it("brackets today: a span around now is ongoing, a past span is not", () => {
    const today = todayUtc();
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);
    expect(isOngoing(yesterday, tomorrow)).toBe(true);
    expect(isOngoing(addDays(today, -10), addDays(today, -5))).toBe(false);
  });
  it("treats a single day (no end) as ongoing only on that day", () => {
    const today = todayUtc();
    expect(isOngoing(today, null)).toBe(true);
    expect(isOngoing(addDays(today, 1), null)).toBe(false);
  });
});

describe("todayUtc", () => {
  it("returns a UTC-midnight date (no time component)", () => {
    const t = todayUtc();
    expect(t.getUTCHours()).toBe(0);
    expect(t.getUTCMinutes()).toBe(0);
    expect(t.getUTCSeconds()).toBe(0);
    expect(t.getUTCMilliseconds()).toBe(0);
  });
});

describe("formatDate", () => {
  it("renders a human-readable UTC date", () => {
    expect(formatDate(d("2026-07-06"))).toBe("Mon, 6 Jul 2026");
  });
  it("is empty for null", () => {
    expect(formatDate(null)).toBe("");
  });
});
