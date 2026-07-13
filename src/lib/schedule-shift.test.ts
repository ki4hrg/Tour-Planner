import { describe, it, expect } from "vitest";
import {
  cascadeFromEdit,
  shiftDayItems,
  type DayScheduleItem,
} from "./schedule-shift";

const item = (
  id: string,
  order: number,
  startTime: string | null,
  endTime: string | null = null,
): DayScheduleItem => ({ id, order, startTime, endTime });

// Compact view for assertions: id → start/end.
const shape = (items: ReturnType<typeof cascadeFromEdit>) =>
  items.map((s) => ({ id: s.id, start: s.startTime, end: s.endTime }));

describe("cascadeFromEdit", () => {
  it("ripples a lengthened item forward, preserving downstream gaps", () => {
    // 09:00–10:00 · 10:30–11:00 · 12:00–12:30; stretch the first to 11:00 (+1h).
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "10:30", "11:00"),
      item("c", 3, "12:00", "12:30"),
    ];
    expect(shape(cascadeFromEdit(items, "a", "09:00", "11:00"))).toEqual([
      { id: "b", start: "11:30", end: "12:00" }, // +1h, 30m gap after a survives
      { id: "c", start: "13:00", end: "13:30" }, // +1h, 60m gap before c survives
    ]);
  });

  it("ripples a shortened item forward (negative delta pulls the day earlier)", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "10:30", "11:00"),
    ];
    // Trim a to end 09:30 (−30m).
    expect(shape(cascadeFromEdit(items, "a", "09:00", "09:30"))).toEqual([
      { id: "b", start: "10:00", end: "10:30" },
    ]);
  });

  it("uses the end delta, so pulling only the start in (shrinking) ripples nothing", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "10:00", "11:00"),
    ];
    // Start moves 09:00→09:30 but end stays 10:00: trailing edge unmoved → no ripple.
    expect(cascadeFromEdit(items, "a", "09:30", "10:00")).toEqual([]);
  });

  it("shifts by the end delta when the whole item moves later", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "10:15", "10:45"),
    ];
    // Move a to 09:20–10:20 (+20m at the end).
    expect(shape(cascadeFromEdit(items, "a", "09:20", "10:20"))).toEqual([
      { id: "b", start: "10:35", end: "11:05" },
    ]);
  });

  it("only touches items ordered AFTER the edited one", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "10:00", "11:00"), // the edited one
      item("c", 3, "11:00", "12:00"),
    ];
    const result = cascadeFromEdit(items, "b", "10:00", "11:30");
    expect(result.map((s) => s.id)).toEqual(["c"]);
    expect(result[0]).toMatchObject({ startTime: "11:30", endTime: "12:30" });
  });

  it("moves a downstream point item by its start, keeping the null end", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("depart", 2, "11:00", null),
    ];
    expect(shape(cascadeFromEdit(items, "a", "09:00", "10:30"))).toEqual([
      { id: "depart", start: "11:30", end: null },
    ]);
  });

  it("leaves untimed downstream items untouched", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("todo", 2, null, null),
      item("c", 3, "11:00", "12:00"),
    ];
    expect(shape(cascadeFromEdit(items, "a", "09:00", "10:30"))).toEqual([
      { id: "c", start: "11:30", end: "12:30" },
    ]);
  });

  it("does not ripple when the edited item had no start time", () => {
    const items = [item("a", 1, null, null), item("b", 2, "11:00", "12:00")];
    expect(cascadeFromEdit(items, "a", "09:00", "10:00")).toEqual([]);
  });

  it("does not ripple when the edited item's time is being cleared", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "11:00", "12:00"),
    ];
    expect(cascadeFromEdit(items, "a", null, null)).toEqual([]);
  });

  it("is a no-op when the trailing edge doesn't move", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "11:00", "12:00"),
    ];
    expect(cascadeFromEdit(items, "a", "09:00", "10:00")).toEqual([]);
  });

  it("clamps a downstream shift to the end of the day", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "23:00", "23:30"),
    ];
    // +2h would push b past midnight; clamp to 23:59.
    expect(shape(cascadeFromEdit(items, "a", "09:00", "12:00"))).toEqual([
      { id: "b", start: "23:59", end: "23:59" },
    ]);
  });
});

describe("shiftDayItems", () => {
  it("slides every timed item in the day by the delta", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "10:30", "11:00"),
    ];
    expect(shape(shiftDayItems(items, 20))).toEqual([
      { id: "a", start: "09:20", end: "10:20" },
      { id: "b", start: "10:50", end: "11:20" },
    ]);
  });

  it("shifts only from the given order onward (rest of the day)", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "10:30", "11:00"),
      item("c", 3, "11:30", "12:00"),
    ];
    expect(shape(shiftDayItems(items, 30, 2))).toEqual([
      { id: "b", start: "11:00", end: "11:30" },
      { id: "c", start: "12:00", end: "12:30" },
    ]);
  });

  it("shifts earlier on a negative delta and skips untimed items", () => {
    const items = [
      item("a", 1, "09:30", "10:00"),
      item("todo", 2, null, null),
      item("b", 3, "10:30", "11:00"),
    ];
    expect(shape(shiftDayItems(items, -30))).toEqual([
      { id: "a", start: "09:00", end: "09:30" },
      { id: "b", start: "10:00", end: "10:30" },
    ]);
  });

  it("is a no-op for a zero delta", () => {
    const items = [item("a", 1, "09:00", "10:00")];
    expect(shiftDayItems(items, 0)).toEqual([]);
  });

  it("clamps at the start of the day when shifting earlier past midnight", () => {
    const items = [item("a", 1, "00:30", "01:00")];
    expect(shape(shiftDayItems(items, -60))).toEqual([
      { id: "a", start: "00:00", end: "00:00" },
    ]);
  });
});
