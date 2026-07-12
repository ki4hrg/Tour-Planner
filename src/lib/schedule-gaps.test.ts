import { describe, it, expect } from "vitest";
import { computeScheduleGaps, formatDuration } from "./schedule-gaps";
import type { SerializedScheduleItem } from "./trips";

// Mock a schedule item with the minimum fields needed
function mockItem(
  overrides?: Partial<SerializedScheduleItem>,
): SerializedScheduleItem {
  return {
    id: "item-1",
    dayId: "day-1",
    categoryId: null,
    category: null,
    title: null,
    order: 0,
    startTime: null,
    endTime: null,
    notes: null,
    isBlock: false,
    presentationId: null,
    presentation: null,
    presenters: [],
    sites: [],
    bookings: [],
    ...overrides,
  };
}

describe("computeScheduleGaps", () => {
  it("returns no gaps for items without times", () => {
    const items = [
      mockItem({ title: "No times" }),
      mockItem({ title: "Also no times" }),
    ];
    expect(computeScheduleGaps(items)).toEqual([]);
  });

  it("returns no gaps when there is only one timed item", () => {
    const items = [mockItem({ startTime: "09:00", endTime: "10:00" })];
    expect(computeScheduleGaps(items)).toEqual([]);
  });

  it("detects a 45-minute gap between two items, anchored to the earlier one", () => {
    const items = [
      mockItem({ id: "a", order: 1, startTime: "09:00", endTime: "10:00" }),
      mockItem({ id: "b", order: 2, startTime: "10:45", endTime: "11:30" }),
    ];
    const gaps = computeScheduleGaps(items);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({
      startTime: "10:00",
      endTime: "10:45",
      durationMinutes: 45,
      afterItemId: "a",
    });
  });

  it("skips gaps smaller than 10 minutes", () => {
    const items = [
      mockItem({ order: 1, startTime: "09:00", endTime: "10:00" }),
      mockItem({ order: 2, startTime: "10:05", endTime: "11:00" }),
    ];
    expect(computeScheduleGaps(items)).toEqual([]);
  });

  it("includes a gap exactly 10 minutes long", () => {
    const items = [
      mockItem({ order: 1, startTime: "09:00", endTime: "10:00" }),
      mockItem({ order: 2, startTime: "10:10", endTime: "11:00" }),
    ];
    const gaps = computeScheduleGaps(items);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].durationMinutes).toBe(10);
  });

  it("skips overlapping items (next starts before current ends)", () => {
    const items = [
      mockItem({ order: 1, startTime: "09:00", endTime: "10:30" }),
      mockItem({ order: 2, startTime: "10:00", endTime: "11:00" }),
    ];
    expect(computeScheduleGaps(items)).toEqual([]);
  });

  it("skips gaps covered by a Free time system category", () => {
    const items = [
      mockItem({ order: 1, startTime: "09:00", endTime: "10:00" }),
      mockItem({
        order: 2,
        startTime: "10:00",
        endTime: "11:00",
        category: { id: "cat-1", name: "Free time", color: null },
      }),
      mockItem({ order: 3, startTime: "11:00", endTime: "12:00" }),
    ];
    expect(computeScheduleGaps(items)).toEqual([]);
  });

  it("skips gaps covered by a Break system category", () => {
    const items = [
      mockItem({ order: 1, startTime: "09:00", endTime: "10:00" }),
      mockItem({
        order: 2,
        startTime: "10:00",
        endTime: "10:45",
        category: { id: "cat-1", name: "Break", color: null },
      }),
      mockItem({ order: 3, startTime: "10:45", endTime: "11:00" }),
    ];
    expect(computeScheduleGaps(items)).toEqual([]);
  });

  it("includes gaps not covered by system categories", () => {
    const items = [
      mockItem({ order: 1, startTime: "09:00", endTime: "10:00" }),
      mockItem({
        order: 2,
        startTime: "10:00",
        endTime: "10:20",
        category: { id: "cat-1", name: "Break", color: null },
      }),
      mockItem({ order: 3, startTime: "10:50", endTime: "11:00" }),
    ];
    const gaps = computeScheduleGaps(items);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({
      startTime: "10:20",
      endTime: "10:50",
      durationMinutes: 30,
      afterItemId: "item-1",
    });
  });

  it("detects multiple gaps in a day, each anchored to its own item", () => {
    const items = [
      mockItem({ id: "a", order: 1, startTime: "09:00", endTime: "10:00" }),
      mockItem({ id: "b", order: 2, startTime: "11:00", endTime: "12:00" }),
      mockItem({ id: "c", order: 3, startTime: "13:00", endTime: "14:00" }),
    ];
    const gaps = computeScheduleGaps(items);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toEqual({
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
      afterItemId: "a",
    });
    expect(gaps[1]).toEqual({
      startTime: "12:00",
      endTime: "13:00",
      durationMinutes: 60,
      afterItemId: "b",
    });
  });

  it("a start-only item closes the gap before it but opens none after it", () => {
    // "10:00 Depart for Bristol" style item: the free time after breakfast ends
    // at 10:00 (1 h, not until the next fully-timed item), and no gap is
    // claimed between the open-ended departure and the next item.
    const items = [
      mockItem({ id: "breakfast", order: 1, startTime: "08:00", endTime: "09:00" }),
      mockItem({ id: "depart", order: 2, startTime: "10:00", endTime: null }),
      mockItem({ id: "arrive", order: 3, startTime: "12:15", endTime: "12:45" }),
    ];
    const gaps = computeScheduleGaps(items);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({
      startTime: "09:00",
      endTime: "10:00",
      durationMinutes: 60,
      afterItemId: "breakfast",
    });
  });

  it("ignores items with no times at all when computing gaps", () => {
    const items = [
      mockItem({ id: "a", order: 1, startTime: "09:00", endTime: "10:00" }),
      mockItem({ order: 2, startTime: null, endTime: null }),
      mockItem({ order: 3, startTime: "11:00", endTime: "12:00" }),
    ];
    const gaps = computeScheduleGaps(items);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
      afterItemId: "a",
    });
  });

  it("sorts items by start time before computing gaps", () => {
    const items = [
      mockItem({ id: "late", order: 2, startTime: "11:00", endTime: "12:00" }),
      mockItem({ id: "early", order: 1, startTime: "09:00", endTime: "10:00" }),
    ];
    const gaps = computeScheduleGaps(items);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
      afterItemId: "early",
    });
  });

  it("handles edge cases with single-digit hours (9:05, not 09:05)", () => {
    const items = [
      mockItem({ order: 1, startTime: "9:00", endTime: "10:00" }),
      mockItem({ order: 2, startTime: "10:30", endTime: "11:00" }),
    ];
    const gaps = computeScheduleGaps(items);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].durationMinutes).toBe(30);
  });
});

describe("formatDuration", () => {
  it("formats minutes under 60", () => {
    expect(formatDuration(45)).toBe("45 min free");
    expect(formatDuration(1)).toBe("1 min free");
    expect(formatDuration(59)).toBe("59 min free");
  });

  it("formats an hour exactly", () => {
    expect(formatDuration(60)).toBe("1 h free");
    expect(formatDuration(120)).toBe("2 h free");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(75)).toBe("1 h 15 min free");
    expect(formatDuration(90)).toBe("1 h 30 min free");
    expect(formatDuration(135)).toBe("2 h 15 min free");
  });

  it("supports custom labels", () => {
    expect(formatDuration(45, "available")).toBe("45 min available");
    expect(formatDuration(60, "break")).toBe("1 h break");
  });
});
