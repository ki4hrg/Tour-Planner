import { describe, it, expect } from "vitest";
import { applyItineraryMove } from "./itinerary-moves";

const days = () => [
  {
    id: "d1",
    dayIndex: 1,
    date: "2027-06-01",
    items: [
      { id: "a", startTime: "09:00" },
      { id: "b", startTime: null },
    ],
    plannedLocations: [{ id: "p1", locationId: "L1" }],
  },
  {
    id: "d2",
    dayIndex: 2,
    date: "2027-06-02",
    items: [
      { id: "c", startTime: "08:00" },
      { id: "d", startTime: "12:00" },
    ],
    plannedLocations: [{ id: "p2", locationId: "L2" }],
  },
];

describe("applyItineraryMove", () => {
  it("reorders days; each slot keeps its date", () => {
    const out = applyItineraryMove(days(), { kind: "days", orderedIds: ["d2", "d1"] });
    expect(out.map((d) => [d.id, d.dayIndex, d.date])).toEqual([
      ["d2", 1, "2027-06-01"],
      ["d1", 2, "2027-06-02"],
    ]);
  });

  it("ignores a stale day list", () => {
    const before = days();
    expect(applyItineraryMove(before, { kind: "days", orderedIds: ["d2"] })).toBe(before);
  });

  it("reorders within a day", () => {
    const out = applyItineraryMove(days(), { kind: "item", itemId: "a", toDayId: "d1", toIndex: 1 });
    expect(out[0].items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("moves a timed item across days by its time", () => {
    const out = applyItineraryMove(days(), { kind: "item", itemId: "a", toDayId: "d2", toIndex: 0 });
    expect(out[0].items.map((i) => i.id)).toEqual(["b"]);
    expect(out[1].items.map((i) => i.id)).toEqual(["c", "a", "d"]);
  });

  it("moves a planned location, collapsing a duplicate", () => {
    const moved = applyItineraryMove(days(), { kind: "planned", id: "p1", toDayId: "d2" });
    expect(moved[0].plannedLocations).toEqual([]);
    expect(moved[1].plannedLocations!.map((p) => p.id)).toEqual(["p2", "p1"]);
    const dup = days();
    dup[1].plannedLocations.push({ id: "p3", locationId: "L1" });
    const collapsed = applyItineraryMove(dup, { kind: "planned", id: "p1", toDayId: "d2" });
    expect(collapsed[1].plannedLocations!.map((p) => p.id)).toEqual(["p2", "p3"]);
  });
});
