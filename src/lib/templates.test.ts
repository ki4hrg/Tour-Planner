import { describe, it, expect } from "vitest";
import {
  instantiateDays,
  templatizeStays,
  instantiateStays,
  copyStays,
  fitDaysToRange,
  describeDayFit,
  type TemplateScheduleItem,
  type SourceStay,
} from "./templates";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function stay(over: Partial<SourceStay> = {}): SourceStay {
  return {
    locationId: "locH",
    checkIn: null,
    checkOut: null,
    checkInDayIndex: null,
    checkOutDayIndex: null,
    arrivalTime: null,
    departureTime: null,
    headcount: 10,
    costPerPersonPerNight: null,
    currency: "USD",
    priority: 0,
    notes: null,
    ...over,
  };
}

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
    cityRegionId: "region-oxford",
    // Out of order + with a note, to exercise sort/renumber/carry-over.
    plannedLocations: [
      { locationId: "plB", order: 1, note: null },
      { locationId: "plA", order: 0, note: "am" },
    ],
    scheduleItems: [
      item(2, { sites: [{ locationId: "locB", order: 0 }] }),
      item(1, { sites: [{ locationId: "locA", order: 0 }] }),
    ],
  },
  {
    dayIndex: 1,
    title: "First",
    logisticalNotes: null,
    plannedLocations: [],
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

  it("carries over each day's city", () => {
    const out = instantiateDays(sample, null);
    expect(out.map((d) => d.cityRegionId)).toEqual([null, "region-oxford"]);
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

  it("carries rough-plan locations verbatim, sorted + renumbered 0..n (GH #9)", () => {
    const out = instantiateDays(sample, null);
    // Day 1 (First) had none; day 2 (Second) had two, given out of order.
    expect(out[0].plannedLocations.create).toEqual([]);
    expect(out[1].plannedLocations.create).toEqual([
      { locationId: "plA", order: 0, note: "am" },
      { locationId: "plB", order: 1, note: null },
    ]);
  });

  it("carries the room and meal fields", () => {
    const out = instantiateDays(
      [
        {
          dayIndex: 1,
          title: null,
          logisticalNotes: null,
          plannedLocations: [],
          scheduleItems: [
            item(1, { room: "Refectory", mealKind: "LUNCH", mealProvision: "VENUE" }),
          ],
        },
      ],
      null,
    );
    const first = out[0].scheduleItems.create[0];
    expect(first.room).toBe("Refectory");
    expect(first.mealKind).toBe("LUNCH");
    expect(first.mealProvision).toBe("VENUE");
  });

  it("carries the catalogued talk link but resets per-occurrence presenters", () => {
    const days = [
      {
        dayIndex: 1,
        title: null,
        logisticalNotes: null,
        plannedLocations: [],
        scheduleItems: [item(1, { presentationId: "talkA" })],
      },
    ];
    const out = instantiateDays(days, null);
    const firstItem = out[0].scheduleItems.create[0];
    expect(firstItem.presentationId).toBe("talkA");
    // presenters are NOT part of the instantiated create payload (reset to none).
    expect("presenters" in firstItem).toBe(false);
  });

  it("drops item bookings on venue items (the venue engagement covers them)", () => {
    const out = instantiateDays(sample, null);
    const firstItem = out[0].scheduleItems.create[0];
    expect(firstItem.sites.create).toHaveLength(1);
    expect(firstItem.bookings).toBeUndefined();
  });

  it("resets site-less item bookings to PENDING and keeps reusable text", () => {
    const out = instantiateDays(
      [
        {
          dayIndex: 1,
          title: null,
          logisticalNotes: null,
          plannedLocations: [],
          scheduleItems: [
            item(1, {
              title: "Coach",
              bookings: [{ locationId: null, label: "Hall hire", notes: "call ahead" }],
            }),
          ],
        },
      ],
      null,
    );
    const booking = out[0].scheduleItems.create[0].bookings!.create[0];
    expect(booking.status).toBe("PENDING");
    expect(booking.label).toBe("Hall hire");
    expect(booking.notes).toBe("call ahead");
    // Instance-specific actuals are dropped by omission.
    expect("bookedContactId" in booking).toBe(false);
    expect("confirmationRef" in booking).toBe(false);
  });

  it("copies a travel leg verbatim, stops renumbered 0..n (GH #80)", () => {
    const days = instantiateDays(
      [
        {
          dayIndex: 1,
          title: null,
          logisticalNotes: null,
          plannedLocations: [],
          scheduleItems: [
            item(1, {
              title: null,
              travel: {
                method: "COACH",
                fromLocationId: "locA",
                fromLabel: null,
                toLocationId: null,
                toLabel: "Bristol",
                stops: [
                  { locationId: null, label: "M5 services", dwellMinutes: 15, order: 5 },
                  { locationId: "locS", label: null, dwellMinutes: null, order: 2 },
                ],
              },
            }),
          ],
        },
      ],
      null,
    );
    const created = days[0].scheduleItems.create[0];
    expect(created.travel?.create).toMatchObject({
      method: "COACH",
      fromLocationId: "locA",
      toLabel: "Bristol",
    });
    // Stops sort by source order, then renumber.
    expect(created.travel?.create.stops.create).toEqual([
      { locationId: "locS", label: null, dwellMinutes: null, order: 0 },
      { locationId: null, label: "M5 services", dwellMinutes: 15, order: 1 },
    ]);
    // Items without a leg omit the key entirely.
    const plain = instantiateDays(
      [
        {
          dayIndex: 1,
          title: null,
          logisticalNotes: null,
          plannedLocations: [],
          scheduleItems: [item(1)],
        },
      ],
      null,
    );
    expect(plain[0].scheduleItems.create[0].travel).toBeUndefined();
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(sample);
    instantiateDays(sample, null);
    expect(JSON.stringify(sample)).toBe(before);
  });
});

describe("templatizeStays", () => {
  const start = d("2026-07-06"); // trip day 1

  it("converts absolute dates to 1-based day indices from startDate", () => {
    // Check in day 1 (Jul 6), out the morning of day 11 (Jul 16) → 10 nights.
    const out = templatizeStays(
      [stay({ checkIn: d("2026-07-06"), checkOut: d("2026-07-16") })],
      start,
    );
    expect(out).toHaveLength(1);
    expect(out[0].checkInDayIndex).toBe(1);
    expect(out[0].checkOutDayIndex).toBe(11);
    expect(out[0].checkIn).toBeNull();
    expect(out[0].checkOut).toBeNull();
  });

  it("carries over the reusable attributes unchanged", () => {
    const out = templatizeStays(
      [stay({ checkIn: d("2026-07-08"), checkOut: d("2026-07-09"), notes: "Inn", priority: 1 })],
      start,
    );
    expect(out[0].notes).toBe("Inn");
    expect(out[0].priority).toBe(1);
    expect(out[0].checkInDayIndex).toBe(3);
    expect(out[0].checkOutDayIndex).toBe(4);
  });

  it("drops stays that can't be anchored (no startDate to measure from)", () => {
    const out = templatizeStays(
      [stay({ checkIn: d("2026-07-06"), checkOut: d("2026-07-08") })],
      null,
    );
    expect(out).toEqual([]);
  });
});

describe("instantiateStays", () => {
  it("resolves day indices to dates against the new startDate", () => {
    const out = instantiateStays(
      [stay({ checkInDayIndex: 1, checkOutDayIndex: 11 })],
      d("2026-08-01"),
    );
    expect(out[0].checkIn?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(out[0].checkOut?.toISOString().slice(0, 10)).toBe("2026-08-11");
    expect(out[0].checkInDayIndex).toBeNull();
    expect(out[0].checkOutDayIndex).toBeNull();
  });

  it("keeps day indices when the target is itself date-less", () => {
    const out = instantiateStays(
      [stay({ checkInDayIndex: 2, checkOutDayIndex: 4 })],
      null,
    );
    expect(out[0].checkIn).toBeNull();
    expect(out[0].checkOut).toBeNull();
    expect(out[0].checkInDayIndex).toBe(2);
    expect(out[0].checkOutDayIndex).toBe(4);
  });

  it("carries an already-dated source stay through unchanged", () => {
    const out = instantiateStays(
      [stay({ checkIn: d("2026-07-06"), checkOut: d("2026-07-08") })],
      d("2026-08-01"),
    );
    expect(out[0].checkIn?.toISOString().slice(0, 10)).toBe("2026-07-06");
    expect(out[0].checkOutDayIndex).toBeNull();
  });

  it("round-trips: templatize then instantiate lands on the same offsets", () => {
    const source = stay({ checkIn: d("2026-07-08"), checkOut: d("2026-07-11") });
    const templated = templatizeStays([source], d("2026-07-06")); // days 3 → 6
    const instantiated = instantiateStays(
      templated.map((t) => ({ ...t })),
      d("2026-09-10"), // new day 1
    );
    // day 3 == Sep 12, day 6 == Sep 15
    expect(instantiated[0].checkIn?.toISOString().slice(0, 10)).toBe("2026-09-12");
    expect(instantiated[0].checkOut?.toISOString().slice(0, 10)).toBe("2026-09-15");
  });
});

describe("instantiateDays — duplicating a trip (bookings: false, presenters: true)", () => {
  const dup = { bookings: false, presenters: true };

  it("omits item bookings entirely", () => {
    const out = instantiateDays(sample, d("2026-11-01"), dup);
    const first = out[0].scheduleItems.create[0];
    expect("bookings" in first).toBe(false);
    // Everything else still carries over.
    expect(first.title).toBe("Talk");
    expect(first.sites.create).toEqual([{ locationId: "locX", order: 0 }]);
  });

  it("connects each item's own speakers", () => {
    const days = [
      {
        dayIndex: 1,
        title: null,
        logisticalNotes: null,
        plannedLocations: [],
        scheduleItems: [
          item(1, { presentationId: "talkA", presenters: [{ id: "c1" }, { id: "c2" }] }),
          item(2, { presenters: [] }),
        ],
      },
    ];
    const [day] = instantiateDays(days, null, dup);
    expect(day.scheduleItems.create[0].presenters).toEqual({
      connect: [{ id: "c1" }, { id: "c2" }],
    });
    expect("presenters" in day.scheduleItems.create[1]).toBe(false);
  });

  it("keeps the template defaults when no options are passed", () => {
    const [day] = instantiateDays(
      [
        {
          dayIndex: 1,
          title: null,
          logisticalNotes: null,
          plannedLocations: [],
          scheduleItems: [item(1, { presenters: [{ id: "c1" }], bookings: [{ locationId: null, label: "Coach", notes: null }] })],
        },
      ],
      null,
    );
    const first = day.scheduleItems.create[0];
    expect("presenters" in first).toBe(false);
    expect(first.bookings?.create).toHaveLength(1);
  });
});

describe("copyStays", () => {
  it("re-anchors a dated trip's stays onto the new dates by trip day", () => {
    // Last year: nights 2–4 of a trip starting 1 Jul 2025.
    const src = [stay({ checkIn: d("2025-07-02"), checkOut: d("2025-07-04") })];
    const out = copyStays(src, { isTemplate: false, startDate: d("2025-07-01") }, d("2026-10-26"));
    expect(out[0].checkIn).toEqual(d("2026-10-27"));
    expect(out[0].checkOut).toEqual(d("2026-10-29"));
    expect(out[0].checkInDayIndex).toBeNull();
    expect(out[0].checkOutDayIndex).toBeNull();
  });

  it("instantiates a template's day-relative stays directly", () => {
    const src = [stay({ checkInDayIndex: 1, checkOutDayIndex: 3 })];
    const out = copyStays(src, { isTemplate: true, startDate: null }, d("2026-10-26"));
    expect(out[0].checkIn).toEqual(d("2026-10-26"));
    expect(out[0].checkOut).toEqual(d("2026-10-28"));
  });

  it("copies a dated trip into a date-less template as day indices", () => {
    const src = [stay({ checkIn: d("2025-07-02"), checkOut: d("2025-07-04") })];
    const out = copyStays(src, { isTemplate: false, startDate: d("2025-07-01") }, null);
    expect(out[0]).toMatchObject({ checkIn: null, checkOut: null, checkInDayIndex: 2, checkOutDayIndex: 4 });
  });

  it("drops stays a date-less source trip cannot anchor", () => {
    const src = [stay({ checkIn: d("2025-07-02"), checkOut: d("2025-07-04") })];
    expect(copyStays(src, { isTemplate: false, startDate: null }, d("2026-10-26"))).toEqual([]);
  });
});

describe("fitDaysToRange", () => {
  const three = instantiateDays(
    [1, 2, 3].map((i) => ({
      dayIndex: i,
      title: `Day ${i}`,
      logisticalNotes: null,
      plannedLocations: [],
      scheduleItems: [],
    })),
    d("2026-11-01"),
  );

  it("pads empty dated days up to a longer endDate", () => {
    const fit = fitDaysToRange(three, d("2026-11-01"), d("2026-11-07"));
    expect(fit.days).toHaveLength(7);
    expect(fit.padded).toBe(4);
    expect(fit.endDateMoved).toBe(false);
    expect(fit.endDate).toEqual(d("2026-11-07"));
    expect(fit.days[3]).toMatchObject({ dayIndex: 4, date: d("2026-11-04"), title: null });
    expect(fit.days[6]).toMatchObject({ dayIndex: 7, date: d("2026-11-07") });
    expect(fit.days[6].scheduleItems.create).toEqual([]);
    // Copied days are untouched.
    expect(fit.days[2].title).toBe("Day 3");
    expect(describeDayFit(fit)).toBe("Created with 7 days.");
  });

  it("keeps every day and moves endDate out when the range is shorter", () => {
    const fit = fitDaysToRange(three, d("2026-11-01"), d("2026-11-02"));
    expect(fit.days).toHaveLength(3);
    expect(fit.endDateMoved).toBe(true);
    expect(fit.endDate).toEqual(d("2026-11-03"));
    expect(describeDayFit(fit)).toBe("Created with 3 days; end date moved to 3 Nov.");
  });

  it("sets a missing endDate to the last day", () => {
    const fit = fitDaysToRange(three, d("2026-11-01"), null);
    expect(fit.endDate).toEqual(d("2026-11-03"));
    expect(fit.endDateMoved).toBe(true);
  });

  it("is a no-op when the range matches, or there is no startDate / no days", () => {
    const exact = fitDaysToRange(three, d("2026-11-01"), d("2026-11-03"));
    expect(exact).toMatchObject({ padded: 0, endDateMoved: false, endDate: d("2026-11-03") });
    expect(exact.days).toBe(three);
    const dateless = fitDaysToRange(three, null, null);
    expect(dateless.days).toBe(three);
    expect(describeDayFit(dateless)).toBe("Created with 3 days.");
    const empty = fitDaysToRange([], d("2026-11-01"), d("2026-11-07"));
    expect(empty.days).toEqual([]);
    expect(empty.endDate).toEqual(d("2026-11-07"));
  });
});
