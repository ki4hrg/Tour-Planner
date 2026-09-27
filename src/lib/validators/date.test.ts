import { describe, expect, it } from "vitest";
import { isCalendarDate } from "./date";

describe("isCalendarDate", () => {
  it("accepts real dates, including leap days", () => {
    expect(isCalendarDate("2026-07-06")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
  });

  it("rejects impossible days that Date would roll over", () => {
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
  });

  it("rejects anything not shaped yyyy-mm-dd", () => {
    expect(isCalendarDate("")).toBe(false);
    expect(isCalendarDate("7/6/2026")).toBe(false);
    expect(isCalendarDate("2026-7-6")).toBe(false);
  });
});
