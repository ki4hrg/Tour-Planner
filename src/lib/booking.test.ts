import { describe, it, expect } from "vitest";
import { earliestBookable, windowStatus } from "./booking";

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
