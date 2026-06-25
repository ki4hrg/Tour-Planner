import { describe, it, expect } from "vitest";
import { instantiateDays, type TemplateDay } from "./templates";

function stop(order: number, over: Partial<TemplateDay["stops"][number]> = {}) {
  return {
    siteId: null,
    title: `stop ${order}`,
    order,
    startTime: null,
    endTime: null,
    scheduleNotes: null,
    bookingNotes: null,
    ...over,
  };
}

const sample: TemplateDay[] = [
  {
    dayIndex: 2,
    title: "Second",
    logisticalNotes: "notes-2",
    stops: [stop(2, { siteId: "siteB" }), stop(1, { siteId: "siteA" })],
  },
  {
    dayIndex: 1,
    title: "First",
    logisticalNotes: null,
    stops: [
      stop(1, {
        siteId: "siteX",
        bookingNotes: "call ahead",
        scheduleNotes: "morning",
      }),
    ],
  },
];

describe("instantiateDays", () => {
  it("sorts and renumbers days 1..n by dayIndex", () => {
    const out = instantiateDays(sample, null);
    expect(out.map((d) => d.dayIndex)).toEqual([1, 2]);
    expect(out[0].title).toBe("First");
    expect(out[1].title).toBe("Second");
  });

  it("sorts and renumbers stop order within each day", () => {
    const out = instantiateDays(sample, null);
    const day2 = out[1];
    expect(day2.stops.create.map((s) => s.order)).toEqual([1, 2]);
    // Originally order 1 was siteA, order 2 siteB — preserved relative order.
    expect(day2.stops.create.map((s) => s.siteId)).toEqual(["siteA", "siteB"]);
  });

  it("derives dates from startDate (day 1 == start, +1 per day)", () => {
    const start = new Date("2026-07-06T00:00:00.000Z");
    const out = instantiateDays(sample, start);
    expect(out[0].date?.toISOString().slice(0, 10)).toBe("2026-07-06");
    expect(out[1].date?.toISOString().slice(0, 10)).toBe("2026-07-07");
  });

  it("leaves dates null when there is no startDate", () => {
    const out = instantiateDays(sample, null);
    expect(out[0].date).toBeNull();
  });

  it("resets booking status and carries over reusable planning text", () => {
    const out = instantiateDays(sample, null);
    const firstStop = out[0].stops.create[0];
    expect(firstStop.bookingStatus).toBe("NOT_BOOKED");
    expect(firstStop.bookingNotes).toBe("call ahead");
    expect(firstStop.scheduleNotes).toBe("morning");
    // Instance-specific actuals are dropped by omission.
    expect("bookedContactId" in firstStop).toBe(false);
    expect("confirmationRef" in firstStop).toBe(false);
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(sample);
    instantiateDays(sample, null);
    expect(JSON.stringify(sample)).toBe(before);
  });
});
