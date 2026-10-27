import { describe, it, expect } from "vitest";
import { planCrossDayMove } from "./schedule-move";

const it_ = (id: string, order: number, startTime: string | null = null) => ({
  id,
  order,
  startTime,
});

describe("planCrossDayMove", () => {
  const target = [it_("t1", 1, "09:00"), it_("t2", 2, "13:00"), it_("t3", 3, null)];

  it("slots a timed item chronologically regardless of the drop spot", () => {
    const { index, updates } = planCrossDayMove(
      it_("m", 2, "11:00"),
      [it_("s1", 1, "08:00"), it_("m", 2, "11:00"), it_("s3", 3, "15:00")],
      target,
      "dayB",
      3,
    );
    expect(index).toBe(1);
    expect(updates).toEqual([
      { id: "s1", order: 1 },
      { id: "s3", order: 2 },
      { id: "t1", order: 1 },
      { id: "m", order: 2, dayId: "dayB" },
      { id: "t2", order: 3 },
      { id: "t3", order: 4 },
    ]);
  });

  it("places an untimed item at the drop index, clamped", () => {
    expect(planCrossDayMove(it_("m", 1), [it_("m", 1)], target, "dayB", 1).index).toBe(1);
    expect(planCrossDayMove(it_("m", 1), [it_("m", 1)], target, "dayB", 99).index).toBe(3);
    expect(planCrossDayMove(it_("m", 1), [it_("m", 1)], target, "dayB", -2).index).toBe(0);
  });

  it("lands first on an empty day", () => {
    const { updates } = planCrossDayMove(it_("m", 1, "10:00"), [it_("m", 1, "10:00")], [], "dayB", 0);
    expect(updates).toEqual([{ id: "m", order: 1, dayId: "dayB" }]);
  });
});
