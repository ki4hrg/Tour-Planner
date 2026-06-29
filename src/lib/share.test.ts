import { describe, it, expect } from "vitest";
import {
  audienceView,
  isShareLinkActive,
  redactDaysForShare,
  scopeDaysToLocation,
} from "./share";
import type { SerializedDay, SerializedScheduleItem } from "./trips";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("audienceView", () => {
  it("STAFF sees everything", () => {
    expect(audienceView("STAFF")).toEqual({
      showBookings: true,
      showLogisticalNotes: true,
      showLodging: true,
      scopeToLocation: false,
    });
  });

  it("PARTICIPANT hides bookings and internal logistics", () => {
    const v = audienceView("PARTICIPANT");
    expect(v.showBookings).toBe(false);
    expect(v.showLogisticalNotes).toBe(false);
    expect(v.showLodging).toBe(true);
    expect(v.scopeToLocation).toBe(false);
  });

  it("HOST_SITE scopes to a location but still sees its bookings", () => {
    const v = audienceView("HOST_SITE");
    expect(v.scopeToLocation).toBe(true);
    expect(v.showBookings).toBe(true);
    expect(v.showLogisticalNotes).toBe(false);
  });
});

describe("isShareLinkActive", () => {
  const now = d("2026-06-29");
  it("is false when disabled", () => {
    expect(isShareLinkActive({ enabled: false, expiresAt: null }, now)).toBe(
      false,
    );
  });
  it("is true when enabled with no expiry", () => {
    expect(isShareLinkActive({ enabled: true, expiresAt: null }, now)).toBe(
      true,
    );
  });
  it("stays valid through the expiry date and dies the day after", () => {
    expect(
      isShareLinkActive({ enabled: true, expiresAt: d("2026-06-29") }, now),
    ).toBe(true);
    expect(
      isShareLinkActive({ enabled: true, expiresAt: d("2026-06-28") }, now),
    ).toBe(false);
  });
});

describe("scopeDaysToLocation", () => {
  function item(locationIds: string[]): SerializedScheduleItem {
    return {
      id: `i${locationIds.join("-")}`,
      dayId: "day1",
      categoryId: null,
      category: null,
      title: "x",
      order: 0,
      startTime: null,
      endTime: null,
      notes: null,
      isBlock: false,
      presentationId: null,
      presentation: null,
      presenters: [],
      sites: locationIds.map((id, i) => ({
        id: `s${i}`,
        locationId: id,
        order: i,
        location: { id, name: id },
      })),
      bookings: [],
    };
  }
  const day = (id: string, items: SerializedScheduleItem[]): SerializedDay =>
    ({
      id,
      tripId: "t",
      dayIndex: 1,
      date: null,
      title: null,
      logisticalNotes: null,
      participantNotes: null,
      items,
    }) as unknown as SerializedDay;

  it("keeps only items visiting the location and drops emptied days", () => {
    const days = [
      day("d1", [item(["sarum"]), item(["cathedral"])]),
      day("d2", [item(["cathedral"])]),
      day("d3", [item(["sarum", "close"])]), // multi-site including target
    ];
    const scoped = scopeDaysToLocation(days, "sarum");
    expect(scoped.map((d) => d.id)).toEqual(["d1", "d3"]);
    expect(scoped[0].items).toHaveLength(1);
    expect(scoped[0].items[0].sites[0].locationId).toBe("sarum");
  });
});

describe("redactDaysForShare", () => {
  function booking(locationId: string | null) {
    return {
      id: `b${locationId}`,
      scheduleItemId: "i",
      stayId: null,
      locationId,
      label: null,
      status: "CONFIRMED" as const,
      bookedContactId: null,
      bookedContact: null,
      confirmationRef: "SC-4471",
      notes: null,
    };
  }
  const itemWith = (locationIds: string[], bookings: ReturnType<typeof booking>[]) =>
    ({
      id: "i",
      dayId: "day1",
      categoryId: null,
      category: null,
      title: "x",
      order: 0,
      startTime: null,
      endTime: null,
      notes: null,
      isBlock: false,
      presentationId: null,
      presentation: null,
      presenters: [],
      sites: locationIds.map((id, i) => ({
        id: `s${i}`,
        locationId: id,
        order: i,
        location: { id, name: id },
      })),
      bookings,
    }) as unknown as SerializedScheduleItem;
  const wrap = (items: SerializedScheduleItem[]) =>
    [{ id: "d1", items } as unknown as SerializedDay];

  it("strips ALL bookings when the audience can't see them (no payload leak)", () => {
    const out = redactDaysForShare(
      wrap([itemWith(["sarum"], [booking("sarum")])]),
      audienceView("PARTICIPANT"),
      null,
    );
    expect(out[0].items[0].bookings).toEqual([]);
  });

  it("passes bookings through untouched for an unscoped staff view", () => {
    const days = wrap([itemWith(["sarum"], [booking("sarum")])]);
    expect(redactDaysForShare(days, audienceView("STAFF"), null)).toBe(days);
  });

  it("for a host-site link keeps only that site's (or unscoped) bookings", () => {
    const out = redactDaysForShare(
      wrap([itemWith(["sarum"], [booking("sarum"), booking("cathedral"), booking(null)])]),
      audienceView("HOST_SITE"),
      "sarum",
    );
    expect(out[0].items[0].bookings.map((b) => b.locationId)).toEqual([
      "sarum",
      null,
    ]);
  });
});
