import { describe, it, expect } from "vitest";
import {
  instantiateDays,
  instantiateVenueBookings,
  templatizeStays,
  instantiateStays,
  type TemplateScheduleInstallment,
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

describe("instantiateVenueBookings", () => {
  const inst = (
    over: Partial<TemplateScheduleInstallment> = {},
  ): TemplateScheduleInstallment => ({
    label: "Deposit",
    percent: 20,
    fixedAmount: null,
    dueOffsetDays: 180,
    sortOrder: 0,
    ...over,
  });

  it("skips bookings without a location and resets status to NOT_BOOKED", () => {
    const out = instantiateVenueBookings([
      { locationId: null, label: "x", notes: null },
      { locationId: "locX", label: "Hall", notes: "n" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].locationId).toBe("locX");
    expect(out[0].status).toBe("NOT_BOOKED");
  });

  it("keeps the source booking's own schedule (template beats location default)", () => {
    const defaults = new Map<string, TemplateScheduleInstallment[]>([
      ["locX", [inst({ label: "Default", percent: 50 })]],
    ]);
    const out = instantiateVenueBookings(
      [{ locationId: "locX", label: null, notes: null, paymentSchedule: [inst()] }],
      defaults,
    );
    expect(out[0].paymentSchedule?.create).toHaveLength(1);
    expect(out[0].paymentSchedule?.create[0].label).toBe("Deposit");
    expect(out[0].paymentSchedule?.create[0].percent).toBe(20);
  });

  it("falls back to the location default when the booking has no schedule", () => {
    const defaults = new Map<string, TemplateScheduleInstallment[]>([
      ["locX", [inst({ label: "Default", percent: 25 }), inst({ label: "Balance", percent: 75, dueOffsetDays: 30 })]],
    ]);
    const out = instantiateVenueBookings(
      [{ locationId: "locX", label: null, notes: null }],
      defaults,
    );
    expect(out[0].paymentSchedule?.create).toHaveLength(2);
    expect(out[0].paymentSchedule?.create[0].label).toBe("Default");
    // sortOrder is renumbered 0..n regardless of source order.
    expect(out[0].paymentSchedule?.create.map((i) => i.sortOrder)).toEqual([0, 1]);
  });

  it("leaves the engagement scheduleless when neither source nor default has one", () => {
    const out = instantiateVenueBookings([
      { locationId: "locX", label: null, notes: null },
    ]);
    expect(out[0].paymentSchedule).toBeUndefined();
  });

  it("does not apply a default meant for a different location", () => {
    const defaults = new Map<string, TemplateScheduleInstallment[]>([
      ["locOTHER", [inst()]],
    ]);
    const out = instantiateVenueBookings(
      [{ locationId: "locX", label: null, notes: null }],
      defaults,
    );
    expect(out[0].paymentSchedule).toBeUndefined();
  });
});

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

  it("copies a travel leg verbatim, stops renumbered 0..n (GH #80)", () => {
    const days = instantiateDays(
      [
        {
          dayIndex: 1,
          title: null,
          logisticalNotes: null,
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
      [{ dayIndex: 1, title: null, logisticalNotes: null, scheduleItems: [item(1)] }],
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
