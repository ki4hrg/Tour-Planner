import { describe, it, expect } from "vitest";
import { buildTripEvents, type FeedTrip } from "./calendar-feed";
import type { SerializedDay, SerializedScheduleItem } from "./trips";

// Minimal schedule-item factory — only the fields the builder reads matter.
function item(over: Partial<SerializedScheduleItem>): SerializedScheduleItem {
  return {
    id: "i1",
    order: 1,
    title: null,
    notes: null,
    isBlock: false,
    startTime: null,
    endTime: null,
    category: null,
    presentation: null,
    presenters: [],
    sites: [],
    bookings: [],
    ...over,
  } as SerializedScheduleItem;
}

function day(over: Partial<SerializedDay>): SerializedDay {
  return {
    id: "d1",
    tripId: "t1",
    dayIndex: 1,
    date: "2026-07-06",
    title: null,
    logisticalNotes: null,
    participantNotes: null,
    primaryLocationId: null,
    items: [],
    ...over,
  } as SerializedDay;
}

function trip(over: Partial<FeedTrip>): FeedTrip {
  return {
    id: "t1",
    name: "Wesley 2026",
    notes: null,
    startDate: "2026-07-06",
    endDate: "2026-07-08",
    days: [],
    stays: [],
    ...over,
  };
}

const STAFF = { includeLogisticalNotes: true };
const PARTICIPANT = { includeLogisticalNotes: false };

describe("buildTripEvents", () => {
  it("emits a whole-trip banner with an exclusive all-day end", () => {
    const events = buildTripEvents(trip({}), STAFF);
    const banner = events.find((e) => e.uid.startsWith("trip-"));
    expect(banner).toMatchObject({
      summary: "Wesley 2026",
      start: "20260706",
      end: "20260709", // endDate 07-08 + 1 (exclusive)
      allDay: true,
    });
  });

  it("skips the banner for a date-less template trip", () => {
    const events = buildTripEvents(
      trip({ startDate: null, endDate: null, days: [day({ date: null })] }),
      STAFF,
    );
    expect(events).toHaveLength(0);
  });

  it("builds a floating timed event for a timed item", () => {
    const events = buildTripEvents(
      trip({
        startDate: null,
        endDate: null,
        days: [
          day({
            items: [
              item({
                title: "Visit New Room",
                startTime: "09:30",
                endTime: "11:00",
                sites: [
                  { id: "s1", locationId: "l1", order: 1, location: { id: "l1", name: "New Room" } },
                ] as SerializedScheduleItem["sites"],
              }),
            ],
          }),
        ],
      }),
      STAFF,
    );
    expect(events).toEqual([
      {
        uid: "item-i1@tour-planner",
        summary: "Visit New Room",
        location: "New Room",
        description: undefined,
        start: "20260706T093000",
        end: "20260706T110000",
        allDay: false,
      },
    ]);
  });

  it("puts the room before the venue in the event location", () => {
    const events = buildTripEvents(
      trip({
        startDate: null,
        endDate: null,
        days: [
          day({
            items: [
              item({
                title: "Evening Prayer",
                startTime: "16:00",
                room: "Chapel",
                sites: [
                  { id: "s1", locationId: "l1", order: 1, location: { id: "l1", name: "New Room" } },
                ] as SerializedScheduleItem["sites"],
              }),
            ],
          }),
        ],
      }),
      STAFF,
    );
    expect(events[0].location).toBe("Chapel, New Room");
  });

  it("maps a travel span to a timed event with its route as the location (GH #80)", () => {
    const events = buildTripEvents(
      trip({
        startDate: null,
        endDate: null,
        days: [
          day({
            items: [
              item({
                startTime: "10:00",
                endTime: "12:00",
                travel: {
                  id: "tl1",
                  method: "COACH",
                  fromLocation: { id: "a", name: "Old Sarum" },
                  fromLabel: null,
                  toLocation: null,
                  toLabel: "Bristol",
                  stops: [
                    { id: "st1", location: null, label: "M5 services", dwellMinutes: 15, mealKind: null, mealProvision: null, order: 0 },
                  ],
                },
              }),
            ],
          }),
        ],
      }),
      STAFF,
    );
    expect(events).toEqual([
      {
        uid: "item-i1@tour-planner",
        summary: "Coach to Bristol",
        location: "Old Sarum → Bristol",
        description: "Via: M5 services",
        start: "20260706T100000",
        end: "20260706T120000",
        allDay: false,
      },
    ]);
  });

  it("treats an item with a start but no end as a point in time", () => {
    const events = buildTripEvents(
      trip({
        startDate: null,
        endDate: null,
        days: [day({ items: [item({ title: "Depart", startTime: "10:00" })] })],
      }),
      STAFF,
    );
    const ev = events[0];
    expect(ev.start).toBe("20260706T100000");
    expect(ev.end).toBeUndefined();
    expect(ev.allDay).toBe(false);
  });

  it("makes an untimed item an all-day event", () => {
    const events = buildTripEvents(
      trip({
        startDate: null,
        endDate: null,
        days: [day({ items: [item({ title: "Free afternoon" })] })],
      }),
      STAFF,
    );
    expect(events[0]).toMatchObject({
      summary: "Free afternoon",
      start: "20260706",
      end: "20260707",
      allDay: true,
    });
  });

  it("adds a day-note event, and gates logistical notes on the staff flag", () => {
    const d = day({
      title: "Bristol",
      participantNotes: "Theme: the New Room",
      logisticalNotes: "Coach parks on Broadmead",
    });
    const staff = buildTripEvents(trip({ startDate: null, endDate: null, days: [d] }), STAFF);
    const staffNote = staff.find((e) => e.uid.startsWith("day-"));
    expect(staffNote?.summary).toBe("Day 1: Bristol");
    expect(staffNote?.description).toContain("Theme: the New Room");
    expect(staffNote?.description).toContain("Coach parks on Broadmead");

    const participant = buildTripEvents(
      trip({ startDate: null, endDate: null, days: [d] }),
      PARTICIPANT,
    );
    const partNote = participant.find((e) => e.uid.startsWith("day-"));
    expect(partNote?.description).toContain("Theme: the New Room");
    expect(partNote?.description).not.toContain("Broadmead");
  });

  it("does not emit a day-note event for a day with no notes", () => {
    const events = buildTripEvents(
      trip({ startDate: null, endDate: null, days: [day({ title: "Bristol" })] }),
      STAFF,
    );
    expect(events.some((e) => e.uid.startsWith("day-"))).toBe(false);
  });

  it("maps a lodging stay to a multi-day all-day event (checkout exclusive)", () => {
    const events = buildTripEvents(
      trip({
        startDate: null,
        endDate: null,
        stays: [
          { id: "st1", locationName: "Sarum College", checkIn: "2026-07-06", checkOut: "2026-07-08", notes: "2 nights" },
        ],
      }),
      STAFF,
    );
    const stay = events.find((e) => e.uid.startsWith("stay-"));
    expect(stay).toMatchObject({
      summary: "Lodging: Sarum College",
      start: "20260706",
      end: "20260708", // checkout morning, already exclusive
      allDay: true,
    });
  });

  it("includes the speaker in a talk's description", () => {
    const events = buildTripEvents(
      trip({
        startDate: null,
        endDate: null,
        days: [
          day({
            items: [
              item({
                startTime: "14:00",
                presentation: { id: "p1", title: "Aldersgate", defaultPresenters: [] } as SerializedScheduleItem["presentation"],
                presenters: [{ id: "c1", name: "Jane Doe" }],
              }),
            ],
          }),
        ],
      }),
      STAFF,
    );
    expect(events[0].summary).toBe("Aldersgate");
    expect(events[0].description).toContain("Speaker: Jane Doe");
  });
});
