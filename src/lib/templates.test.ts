import { describe, it, expect } from "vitest";
import { instantiateDays, type TemplateScheduleItem } from "./templates";

function item(
  order: number,
  over: Partial<TemplateScheduleItem> = {},
): TemplateScheduleItem {
  return {
    categoryId: null,
    title: `item ${order}`,
    order,
    startTime: null,
    endTime: null,
    notes: null,
    isBlock: false,
    presentationId: null,
    sites: [],
    bookings: [],
    ...over,
  };
}

const sample = [
  {
    dayIndex: 2,
    title: "Second",
    logisticalNotes: "notes-2",
    scheduleItems: [
      item(2, { sites: [{ locationId: "locB", order: 0 }] }),
      item(1, { sites: [{ locationId: "locA", order: 0 }] }),
    ],
  },
  {
    dayIndex: 1,
    title: "First",
    logisticalNotes: null,
    scheduleItems: [
      item(1, {
        title: "Talk",
        notes: "morning",
        sites: [{ locationId: "locX", order: 0 }],
        bookings: [{ locationId: "locX", label: "Hall hire", notes: "call ahead" }],
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

  it("sorts and renumbers item order within each day", () => {
    const out = instantiateDays(sample, null);
    const day2 = out[1];
    expect(day2.scheduleItems.create.map((s) => s.order)).toEqual([1, 2]);
    // Originally order 1 was locA, order 2 locB — preserved relative order.
    expect(
      day2.scheduleItems.create.map((s) => s.sites.create[0]?.locationId),
    ).toEqual(["locA", "locB"]);
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

  it("carries over location links (renumbered) for each item", () => {
    const out = instantiateDays(sample, null);
    const firstItem = out[0].scheduleItems.create[0];
    expect(firstItem.sites.create).toEqual([{ locationId: "locX", order: 0 }]);
  });

  it("carries the catalogued talk link but resets per-occurrence presenters", () => {
    const days = [
      {
        dayIndex: 1,
        title: null,
        logisticalNotes: null,
        scheduleItems: [item(1, { presentationId: "talkA" })],
      },
    ];
    const out = instantiateDays(days, null);
    const firstItem = out[0].scheduleItems.create[0];
    expect(firstItem.presentationId).toBe("talkA");
    // presenters are NOT part of the instantiated create payload (reset to none).
    expect("presenters" in firstItem).toBe(false);
  });

  it("resets bookings to NOT_BOOKED and keeps reusable text", () => {
    const out = instantiateDays(sample, null);
    const firstItem = out[0].scheduleItems.create[0];
    const booking = firstItem.bookings.create[0];
    expect(booking.status).toBe("NOT_BOOKED");
    expect(booking.label).toBe("Hall hire");
    expect(booking.notes).toBe("call ahead");
    expect(booking.locationId).toBe("locX");
    // Instance-specific actuals are dropped by omission.
    expect("bookedContactId" in booking).toBe(false);
    expect("confirmationRef" in booking).toBe(false);
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(sample);
    instantiateDays(sample, null);
    expect(JSON.stringify(sample)).toBe(before);
  });
});
