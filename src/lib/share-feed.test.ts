import { describe, it, expect } from "vitest";
import { buildShareFeedEvents, type ShareFeedTrip } from "./share-feed";
import type { SerializedDay, SerializedScheduleItem } from "./trips";

// Minimal schedule-item factory — only the fields the feed builder reads matter.
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

function site(locationId: string, name: string) {
  return {
    id: `s-${locationId}`,
    locationId,
    order: 0,
    location: { id: locationId, name },
  } as SerializedScheduleItem["sites"][number];
}

function booking(locationId: string, ref: string) {
  return {
    id: `b-${locationId}`,
    scheduleItemId: "i1",
    tripId: "t1",
    stayId: null,
    locationId,
    label: null,
    status: "CONFIRMED",
    bookedContactId: null,
    bookedContact: null,
    confirmationRef: ref,
    notes: null,
  } as unknown as SerializedScheduleItem["bookings"][number];
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

function trip(over: Partial<ShareFeedTrip>): ShareFeedTrip {
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

// A trip carrying staff-only data at every layer: trip notes, day logistical
// notes, a booking with a confirmation ref, and a stay note.
function loadedTrip(): ShareFeedTrip {
  return trip({
    notes: "Internal: invoice via head office",
    days: [
      day({
        logisticalNotes: "Coach parks on Broadmead",
        participantNotes: "Theme: the New Room",
        items: [
          item({
            id: "iNR",
            title: "Visit New Room",
            startTime: "09:30",
            endTime: "11:00",
            sites: [site("newroom", "New Room")],
            bookings: [booking("newroom", "NR-4471")],
          }),
          item({
            id: "iCath",
            title: "Cathedral tour",
            startTime: "14:00",
            sites: [site("cathedral", "Cathedral")],
          }),
        ],
      }),
    ],
    stays: [
      {
        id: "stay-nr",
        locationId: "newroom",
        locationName: "Sarum College",
        checkIn: "2026-07-06",
        checkOut: "2026-07-08",
        notes: "Pay balance on arrival",
      },
    ],
  });
}

describe("buildShareFeedEvents", () => {
  it("STAFF feed carries the full detail (trip/day/stay notes)", () => {
    const events = buildShareFeedEvents("STAFF", loadedTrip(), null);
    const blob = JSON.stringify(events);
    expect(blob).toContain("Coach parks on Broadmead"); // day logistical
    expect(blob).toContain("invoice via head office"); // trip notes
    expect(blob).toContain("Pay balance on arrival"); // stay notes
    // Both venue items present, unscoped.
    expect(events.some((e) => e.summary === "Visit New Room")).toBe(true);
    expect(events.some((e) => e.summary === "Cathedral tour")).toBe(true);
  });

  it("PARTICIPANT feed strips every layer of staff logistics", () => {
    const events = buildShareFeedEvents("PARTICIPANT", loadedTrip(), null);
    const blob = JSON.stringify(events);
    // No internal logistics anywhere in the payload.
    expect(blob).not.toContain("Broadmead");
    expect(blob).not.toContain("invoice via head office");
    expect(blob).not.toContain("Pay balance on arrival");
    // Confirmation refs never ride along (bookings are stripped pre-build).
    expect(blob).not.toContain("NR-4471");
    // But the participant still gets the itinerary + participant notes.
    expect(blob).toContain("Theme: the New Room");
    expect(events.some((e) => e.summary === "Visit New Room")).toBe(true);
    // Lodging is still shown, just without its note.
    const stay = events.find((e) => e.uid.startsWith("stay-"));
    expect(stay?.summary).toBe("Lodging: Sarum College");
    expect(stay?.description).toBeUndefined();
  });

  it("HOST_SITE feed scopes the itinerary and lodging to the one site", () => {
    const events = buildShareFeedEvents("HOST_SITE", loadedTrip(), "newroom");
    // Only the New Room item survives; the Cathedral item is dropped.
    expect(events.some((e) => e.summary === "Visit New Room")).toBe(true);
    expect(events.some((e) => e.summary === "Cathedral tour")).toBe(false);
    // Its stay is at newroom, so it stays; no logistical notes for this audience.
    const blob = JSON.stringify(events);
    expect(blob).not.toContain("Broadmead");
    expect(blob).not.toContain("Pay balance on arrival");
    const stay = events.find((e) => e.uid.startsWith("stay-"));
    expect(stay?.summary).toBe("Lodging: Sarum College");
  });

  it("HOST_SITE feed whose venue was deleted fails closed (no events)", () => {
    // ShareLink.locationId is SET NULL on venue delete — that must never read as
    // "unscoped, whole trip".
    expect(buildShareFeedEvents("HOST_SITE", loadedTrip(), null)).toEqual([]);
  });

  it("HOST_SITE feed drops lodging at other sites", () => {
    const t = loadedTrip();
    const events = buildShareFeedEvents("HOST_SITE", t, "cathedral");
    // The only stay anchors to newroom, so a cathedral-scoped feed has none.
    expect(events.some((e) => e.uid.startsWith("stay-"))).toBe(false);
    // The cathedral item survives, the New Room one is dropped.
    expect(events.some((e) => e.summary === "Cathedral tour")).toBe(true);
    expect(events.some((e) => e.summary === "Visit New Room")).toBe(false);
  });
});
