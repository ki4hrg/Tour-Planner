import { describe, it, expect } from "vitest";
import {
  bookedViaError,
  bookedViaMap,
  engagementLocationId,
  mergeBookedVia,
  withBookedViaParentsWhere,
} from "./booked-via";
import { buildDashboardRows } from "./booking-dashboard";
import { instantiateVenueBookings } from "./templates";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("engagement resolution", () => {
  const map = bookedViaMap([
    { id: "museum", bookedViaId: null },
    { id: "wing", bookedViaId: "museum" },
    { id: "self", bookedViaId: "self" }, // never maps to itself
  ]);

  it("maps a child to its parent and leaves everything else alone", () => {
    expect(engagementLocationId("wing", map)).toBe("museum");
    expect(engagementLocationId("museum", map)).toBe("museum");
    expect(engagementLocationId("unknown", map)).toBe("unknown");
    expect(engagementLocationId("self", map)).toBe("self");
  });

  it("loads parents alongside the touched sites in one where", () => {
    expect(withBookedViaParentsWhere(["wing"])).toEqual({
      OR: [
        { id: { in: ["wing"] } },
        { coveredSites: { some: { id: { in: ["wing"] } } } },
      ],
    });
  });
});

describe("bookedViaError", () => {
  const parent = { name: "Museum", bookedViaId: null, bookable: true };
  const ok = {
    locationId: "wing",
    parentId: "museum",
    hasCoveredSites: false,
    parent,
  };

  it("accepts a bookable top-level parent", () => {
    expect(bookedViaError(ok)).toBeNull();
    expect(bookedViaError({ ...ok, locationId: null })).toBeNull();
  });

  it("refuses itself, a missing parent, nesting either way, and not-bookable", () => {
    expect(bookedViaError({ ...ok, parentId: "wing" })).toMatch(/itself/);
    expect(bookedViaError({ ...ok, parent: null })).toMatch(/not found/);
    expect(bookedViaError({ ...ok, hasCoveredSites: true })).toMatch(
      /covers other sites/,
    );
    expect(
      bookedViaError({
        ...ok,
        parent: { ...parent, bookedViaId: "x", bookedViaName: "Trust" },
      }),
    ).toBe("Museum is itself booked via Trust.");
    expect(
      bookedViaError({ ...ok, parent: { ...parent, bookable: false } }),
    ).toMatch(/not bookable/);
  });
});

describe("mergeBookedVia", () => {
  const base = {
    sourceId: "s",
    targetId: "t",
    sourceBookedViaId: null,
    targetBookedViaId: null,
    sourceHasCoveredSites: false,
    targetHasCoveredSites: false,
  };

  it("keeps the target's parent", () => {
    expect(
      mergeBookedVia({ ...base, targetBookedViaId: "p", sourceBookedViaId: "q" }),
    ).toEqual({ targetBookedViaId: "p" });
  });

  it("fills the target's parent from the source when it has none", () => {
    expect(mergeBookedVia({ ...base, sourceBookedViaId: "q" })).toEqual({
      targetBookedViaId: "q",
    });
  });

  it("drops a parent pointing at the other half of the pair", () => {
    expect(mergeBookedVia({ ...base, targetBookedViaId: "s" })).toEqual({
      targetBookedViaId: null,
    });
    expect(mergeBookedVia({ ...base, sourceBookedViaId: "t" })).toEqual({
      targetBookedViaId: null,
    });
  });

  it("never gives a parent to a target that will cover sites", () => {
    expect(
      mergeBookedVia({
        ...base,
        sourceBookedViaId: "q",
        targetHasCoveredSites: true,
      }),
    ).toEqual({ targetBookedViaId: null });
    // Source's own children move to the target, which then covers them.
    expect(
      mergeBookedVia({
        ...base,
        sourceBookedViaId: null,
        sourceHasCoveredSites: true,
      }),
    ).toEqual({ targetBookedViaId: null });
  });

  it("refuses to nest the source's covered sites under a child target", () => {
    expect(
      mergeBookedVia({
        ...base,
        targetBookedViaId: "p",
        sourceHasCoveredSites: true,
      }),
    ).toHaveProperty("error");
  });

  it("a child merged into its own parent leaves the parent top-level", () => {
    // Source "s" was booked via the target "t".
    expect(
      mergeBookedVia({
        ...base,
        sourceBookedViaId: "t",
        targetHasCoveredSites: false,
      }),
    ).toEqual({ targetBookedViaId: null });
  });
});

describe("buildDashboardRows — sites booked via a parent", () => {
  const loc = (id: string, name: string, bookedViaId: string | null = null) => ({
    id,
    name,
    bookedViaId,
    bookable: true,
    bookingOpensLeadDays: null,
    costs: [],
  });
  const item = (id: string, sites: string[], startTime = "10:00") => ({
    id,
    title: null,
    startTime,
    endTime: null,
    category: { name: "Visit" },
    presentation: null,
    sites: sites.map((locationId) => ({ locationId })),
    bookings: [],
  });

  it("folds a child's sessions, planned visits and nights into the parent row", () => {
    const { venueRows } = buildDashboardRows({
      days: [
        {
          dayIndex: 1,
          date: d("2027-06-01"),
          scheduleItems: [
            item("a", ["museum"], "09:00"),
            item("b", ["wing"], "11:00"),
            // A block visiting parent + child counts once.
            item("c", ["museum", "wing"], "14:00"),
          ],
          plannedLocations: [{ locationId: "garden" }],
        },
      ],
      engagements: [
        {
          id: "eng",
          locationId: "museum",
          status: "IN_PROGRESS",
          label: null,
          confirmationRef: null,
          notes: null,
          bookedContactId: null,
          bookedContact: null,
        },
      ],
      stays: [
        {
          locationId: "wing",
          checkIn: d("2027-06-01"),
          checkOut: d("2027-06-03"),
        },
      ],
      locations: [
        loc("museum", "Museum"),
        loc("wing", "Science Wing", "museum"),
        loc("garden", "Garden", "museum"),
      ],
    });
    expect(venueRows).toHaveLength(1);
    const row = venueRows[0];
    expect(row.locationId).toBe("museum");
    expect(row.bookingId).toBe("eng");
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.nightCount).toBe(2);
    // Untimed (planned) sorts ahead of the day's timed sessions.
    expect(row.sessions.map((s) => [s.id, s.label])).toEqual([
      ["planned:1:garden", "Planned · Garden"],
      ["a", "Visit"],
      ["b", "Visit · Science Wing"],
      ["c", "Visit"],
    ]);
  });

  it("keeps a child on its own row when its parent wasn't loaded", () => {
    const { venueRows } = buildDashboardRows({
      days: [
        {
          dayIndex: 1,
          date: null,
          scheduleItems: [item("b", ["wing"])],
        },
      ],
      engagements: [],
      stays: [],
      locations: [loc("wing", "Science Wing", "museum")],
    });
    expect(venueRows.map((r) => r.locationId)).toEqual(["wing"]);
    expect(venueRows[0].sessions[0].label).toBe("Visit");
  });
});

describe("instantiateVenueBookings — child engagements land on the parent", () => {
  const b = (locationId: string, label: string) => ({
    locationId,
    label,
    notes: null,
  });
  const venue = (id: string) => (id === "wing" ? "museum" : id);

  it("repoints a child's engagement to its parent", () => {
    const out = instantiateVenueBookings([b("wing", "w")], venue);
    expect(out.map((x) => [x.locationId, x.label])).toEqual([["museum", "w"]]);
  });

  it("keeps the parent's own engagement over a child's", () => {
    const out = instantiateVenueBookings(
      [b("wing", "w"), b("museum", "m"), b("other", "o")],
      venue,
    );
    expect(out.map((x) => [x.locationId, x.label])).toEqual([
      ["museum", "m"],
      ["other", "o"],
    ]);
  });
});
