import { describe, it, expect } from "vitest";
import {
  cascadeFromEdit,
  describeShifts,
  fixedTimeOverlaps,
  gapAfterRemoval,
  overlappingItemIds,
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

describe("gapAfterRemoval", () => {
  // 09:00–10:00 · 10:30–11:00 · (untimed) · 12:00–12:30
  const items = [
    item("a", 1, "09:00", "10:00"),
    item("b", 2, "10:30", "11:00"),
    item("c", 3, null),
    item("d", 4, "12:00", "12:30"),
  ];

  it("names the next timed item and the gap from the removed item's start", () => {
    expect(gapAfterRemoval(items, "a")).toEqual({ nextId: "b", minutes: 90 });
    // Skips the untimed item in between.
    expect(gapAfterRemoval(items, "b")).toEqual({ nextId: "d", minutes: 90 });
  });

  it("is null when nothing follows, or the removed item is untimed", () => {
    expect(gapAfterRemoval(items, "d")).toBeNull();
    expect(gapAfterRemoval(items, "c")).toBeNull();
    expect(gapAfterRemoval(items, "zzz")).toBeNull();
  });

  it("is null when the next item is a fixed-time anchor", () => {
    const fixedNext = [
      item("a", 1, "09:00", "10:00"),
      { ...item("b", 2, "10:30", "11:00"), fixedTime: true },
    ];
    expect(gapAfterRemoval(fixedNext, "a")).toBeNull();
  });

  it("is null when the next item already starts no later (overlap)", () => {
    const overlapping = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "09:00", "09:30"),
    ];
    expect(gapAfterRemoval(overlapping, "a")).toBeNull();
  });

  it("pairs with shiftDayItems to close the hole and stop at the next anchor", () => {
    const day = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "10:30", "11:00"),
      item("c", 3, "11:15", "11:45"),
      { ...item("d", 4, "13:00", "14:00"), fixedTime: true },
      item("e", 5, "14:15", "15:00"),
    ];
    const gap = gapAfterRemoval(day, "a")!;
    const next = day.find((it) => it.id === gap.nextId)!;
    expect(shape(shiftDayItems(day, -gap.minutes, next.order))).toEqual([
      { id: "b", start: "09:00", end: "09:30" },
      { id: "c", start: "09:45", end: "10:15" },
    ]);
  });
});

describe("shiftDayItems from the day's lowest order", () => {
  it("moves an order-0 item when the whole day shifts from the minimum order", () => {
    // A renumbering race can leave a day starting at 0; "whole day" must
    // start from the lowest order present, not a hard-coded 1.
    const items = [
      item("a", 0, "09:00", "10:00"),
      item("b", 1, "10:30", "11:00"),
    ];
    const minOrder = Math.min(...items.map((it) => it.order));
    expect(shape(shiftDayItems(items, 15, minOrder))).toEqual([
      { id: "a", start: "09:15", end: "10:15" },
      { id: "b", start: "10:45", end: "11:15" },
    ]);
  });
});

describe("fixed-time anchors", () => {
  const fixed = (it: DayScheduleItem): DayScheduleItem => ({ ...it, fixedTime: true });

  it("stops the edit ripple at the first fixed item", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "10:30", "11:00"),
      fixed(item("parade", 3, "14:00", "15:00")),
      item("coach", 4, "15:30", "16:00"),
    ];
    expect(shape(cascadeFromEdit(items, "a", "09:00", "10:30"))).toEqual([
      { id: "b", start: "11:00", end: "11:30" },
    ]);
  });

  it("stops the day slide at the first fixed item after the start", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      fixed(item("p", 2, "11:00", "12:00")),
      item("b", 3, "13:00", "14:00"),
      fixed(item("q", 4, "15:00", "16:00")),
      item("c", 5, "17:00", "18:00"),
    ];
    expect(shape(shiftDayItems(items, 30))).toEqual([
      { id: "a", start: "09:30", end: "10:30" },
    ]);
    // Starting AT a fixed item skips it and runs to the next anchor.
    expect(shape(shiftDayItems(items, 30, 2))).toEqual([
      { id: "b", start: "13:30", end: "14:30" },
    ]);
  });

  it("reports a fixed item the shifted run now overlaps", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "12:00", "13:30"),
      fixed(item("p", 3, "14:00", "15:00")),
    ];
    const ok = shiftDayItems(items, 20);
    expect(fixedTimeOverlaps(items, ok)).toEqual([]);
    const late = shiftDayItems(items, 45);
    expect(fixedTimeOverlaps(items, late)).toEqual(["p"]);
  });
});

describe("describeShifts", () => {
  const items = [
    item("a", 1, "09:00", "10:00"),
    item("b", 2, "10:30", "11:00"),
    item("c", 3, "12:00", "12:30"),
  ];

  it("names the count and delta of a ripple", () => {
    const shifts = cascadeFromEdit(items, "a", "09:00", "10:30");
    expect(describeShifts(items, shifts)).toBe("2 later items moved 30 min later.");
  });

  it("singular item, earlier, and whole hours", () => {
    const shifts = cascadeFromEdit([items[0], items[1]], "a", "09:00", "09:00");
    expect(describeShifts(items, shifts)).toBe("1 later item moved 1 h earlier.");
    expect(
      describeShifts(items, cascadeFromEdit(items, "a", "09:00", "11:15")),
    ).toBe("2 later items moved 1 h 15 min later.");
  });

  it("is null when nothing moved", () => {
    expect(describeShifts(items, [])).toBeNull();
  });
});

describe("overlappingItemIds", () => {
  it("flags the later item of each pair whose start precedes the previous end", () => {
    const items = [
      item("a", 1, "09:00", "10:00"),
      item("b", 2, "09:45", "10:30"), // starts inside a
      item("c", 3, "10:30", "11:00"), // back-to-back is not an overlap
      item("d", 4, null), // untimed: skipped, doesn't break the chain
      item("e", 5, "10:50"), // point item before c's end
      item("f", 6, "10:40"), // before e's start (a point item's edge is its start)
    ];
    expect([...overlappingItemIds(items)].sort()).toEqual(["b", "e", "f"]);
  });

  it("is empty for a well-ordered day", () => {
    expect(
      overlappingItemIds([item("a", 1, "09:00", "10:00"), item("b", 2, "10:00")]).size,
    ).toBe(0);
  });
});
