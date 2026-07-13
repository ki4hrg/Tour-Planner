import { describe, it, expect } from "vitest";
import {
  cascadeReorderedTimes,
  type ReorderableItem,
} from "./schedule-reorder";

const item = (
  id: string,
  startTime: string | null,
  endTime: string | null = null,
): ReorderableItem => ({ id, startTime, endTime });

// Compact view for assertions: id → order/start/end.
const times = (items: ReorderableItem[], order: string[]) =>
  cascadeReorderedTimes(items, order).map((r) => ({
    id: r.id,
    order: r.order,
    start: r.startTime,
    end: r.endTime,
  }));

describe("cascadeReorderedTimes", () => {
  it("keeps a moved item's own duration and preserves the gap (the core case)", () => {
    // 09:00–10:00 Museum (1h) · 10:30–12:30 Cathedral (2h); move Cathedral up.
    const items = [
      item("museum", "09:00", "10:00"),
      item("cathedral", "10:30", "12:30"),
    ];
    expect(times(items, ["cathedral", "museum"])).toEqual([
      { id: "cathedral", order: 1, start: "09:00", end: "11:00" }, // keeps its 2h
      { id: "museum", order: 2, start: "11:30", end: "12:30" }, // keeps its 1h; 30m gap survives
    ]);
  });

  it("is a no-op on times when order is unchanged", () => {
    const items = [
      item("a", "09:00", "10:00"),
      item("b", "10:00", "11:00"),
    ];
    expect(times(items, ["a", "b"])).toEqual([
      { id: "a", order: 1, start: "09:00", end: "10:00" },
      { id: "b", order: 2, start: "10:00", end: "11:00" },
    ]);
  });

  it("swapping two adjacent, back-to-back items swaps their durations correctly", () => {
    // 09:00–09:30 (30m) · 09:30–11:30 (2h), no gap.
    const items = [
      item("short", "09:00", "09:30"),
      item("long", "09:30", "11:30"),
    ];
    expect(times(items, ["long", "short"])).toEqual([
      { id: "long", order: 1, start: "09:00", end: "11:00" }, // 2h from anchor
      { id: "short", order: 2, start: "11:00", end: "11:30" }, // 30m, no gap
    ]);
  });

  it("preserves each position's gap when reordering three items", () => {
    // 09:00–10:00 (gap 30) 10:30–11:00 (gap 60) 12:00–12:30
    const items = [
      item("a", "09:00", "10:00"), // 60m
      item("b", "10:30", "11:00"), // 30m, gap 30 before
      item("c", "12:00", "12:30"), // 30m, gap 60 before
    ];
    // Move c to the front: durations follow items, gaps follow positions.
    expect(times(items, ["c", "a", "b"])).toEqual([
      { id: "c", order: 1, start: "09:00", end: "09:30" }, // c's 30m at anchor
      { id: "a", order: 2, start: "10:00", end: "11:00" }, // gap 30, a's 60m
      { id: "b", order: 3, start: "12:00", end: "12:30" }, // gap 60, b's 30m
    ]);
  });

  it("keeps a start-only point item as a point (null end) and cascades from its start", () => {
    // 10:00 Depart (point) · 11:00–12:00 Arrive-block (1h)
    const items = [
      item("depart", "10:00", null),
      item("event", "11:00", "12:00"),
    ];
    expect(times(items, ["event", "depart"])).toEqual([
      { id: "event", order: 1, start: "10:00", end: "11:00" }, // event's 1h at anchor
      { id: "depart", order: 2, start: "12:00", end: null }, // gap 60 preserved; stays a point
    ]);
  });

  it("leaves untimed items untimed and lets them take any order slot", () => {
    const items = [
      item("timed1", "09:00", "10:00"),
      item("untimed", null, null),
      item("timed2", "10:00", "11:00"),
    ];
    // Drop the untimed item between the two timed ones after a swap.
    const result = times(items, ["timed2", "untimed", "timed1"]);
    expect(result).toEqual([
      { id: "timed2", order: 1, start: "09:00", end: "10:00" },
      { id: "untimed", order: 2, start: null, end: null },
      { id: "timed1", order: 3, start: "10:00", end: "11:00" },
    ]);
  });

  it("changes only order when no item has a start time", () => {
    const items = [item("a", null, null), item("b", null, null)];
    expect(times(items, ["b", "a"])).toEqual([
      { id: "b", order: 1, start: null, end: null },
      { id: "a", order: 2, start: null, end: null },
    ]);
  });

  it("clamps overlapping originals to a non-negative gap (no backwards times)", () => {
    // b starts before a ends (overlap) → gap clamps to 0.
    const items = [
      item("a", "09:00", "10:00"),
      item("b", "09:30", "10:30"), // 60m, overlaps a
    ];
    expect(times(items, ["b", "a"])).toEqual([
      { id: "b", order: 1, start: "09:00", end: "10:00" }, // b's 60m at anchor
      { id: "a", order: 2, start: "10:00", end: "11:00" }, // gap 0, a's 60m
    ]);
  });

  it("derives the anchor from the earliest start even if input isn't sorted by order", () => {
    const items = [
      item("late", "14:00", "15:00"),
      item("early", "08:00", "09:00"),
    ];
    // Reverse them: earliest start stays the anchor.
    expect(times(items, ["late", "early"])).toEqual([
      { id: "late", order: 1, start: "08:00", end: "09:00" },
      // gap between the two original slots is 14:00 - 09:00 = 5h
      { id: "early", order: 2, start: "14:00", end: "15:00" },
    ]);
  });
});
