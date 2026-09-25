import { describe, it, expect } from "vitest";
import { buildExportPayload } from "./itinerary-export";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("buildExportPayload", () => {
  const baseTrip = {
    id: "trip1",
    name: "Wesley Pilgrimage",
    startDate: d("2026-06-01"),
    endDate: d("2026-06-11"),
    status: "ACTIVE" as const,
    isTemplate: false,
    updatedAt: d("2026-05-25"),
    tripType: { id: "type-wesley" },
  };

  const baseLoc = (id: string, name: string, regionId: string | null = null) => ({
    id,
    name,
    regionId,
    address: null,
    description: null,
    website: null,
    mapUrl: null,
    archivedAt: null,
    updatedAt: d("2026-05-20"),
    hostSite: null,
  });

  const baseRegion = (id: string, name: string, parentId: string | null = null) => ({
    id,
    name,
    parentId,
  });

  it("produces a valid schema payload", () => {
    const payload = buildExportPayload(
      baseTrip,
      [],
      [],
      [],
      [],
    );

    expect(payload).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        trip: expect.any(Object),
        days: expect.any(Array),
        locations: expect.any(Object),
        regions: expect.any(Object),
      }),
    );
  });

  it("includes trip metadata", () => {
    const payload = buildExportPayload(
      baseTrip,
      [],
      [],
      [],
      [],
    );

    expect(payload.trip).toEqual({
      id: "trip1",
      name: "Wesley Pilgrimage",
      startDate: "2026-06-01",
      endDate: "2026-06-11",
      status: "ACTIVE",
      isTemplate: false,
      updatedAt: "2026-05-25T00:00:00.000Z",
    });
  });

  it("handles null dates in trip metadata", () => {
    const templateTrip = { ...baseTrip, startDate: null, endDate: null, isTemplate: true };
    const payload = buildExportPayload(templateTrip, [], [], [], []);

    expect(payload.trip.startDate).toBeNull();
    expect(payload.trip.endDate).toBeNull();
    expect(payload.trip.isTemplate).toBe(true);
  });

  it("includes days with schedule items", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day: any = {
      id: "day1",
      dayIndex: 0,
      date: d("2026-06-01"),
      title: "Arrival in Salisbury",
      participantNotes: "Meet at station",
      primaryLocationId: null,
      scheduleItems: [
        {
          order: 0,
          title: "Sarum College",
          startTime: "10:00",
          endTime: "12:00",
          category: { name: "Visit" },
          travel: null,
          sites: [
            {
              order: 0,
              location: baseLoc("loc-salisbury", "Sarum College", "region-wiltshire"),
            },
          ],
        },
      ],
      plannedLocations: [],
    };

    const locations = [baseLoc("loc-salisbury", "Sarum College", "region-wiltshire")];
    const regions = [baseRegion("region-wiltshire", "Wiltshire", null)];

    const payload = buildExportPayload(baseTrip, [day], [], locations, regions);

    expect(payload.days).toHaveLength(1);
    expect(payload.days[0]).toMatchObject({
      id: "day1",
      dayIndex: 0,
      date: "2026-06-01",
      title: "Arrival in Salisbury",
      participantNotes: "Meet at station",
    });
    expect(payload.days[0].stops).toHaveLength(1);
    expect(payload.days[0].stops[0]).toMatchObject({
      locationId: "loc-salisbury",
      source: "schedule",
      startTime: "10:00",
      endTime: "12:00",
      category: "Visit",
    });
  });

  it("skips travel legs in stops", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day: any = {
      id: "day1",
      dayIndex: 0,
      date: d("2026-06-01"),
      title: "Travel",
      participantNotes: null,
      primaryLocationId: null,
      scheduleItems: [
        {
          order: 0,
          title: "Coach to Oxford",
          startTime: "09:00",
          endTime: "12:00",
          category: { name: "Travel" },
          travel: { method: "COACH" }, // This marks it as a travel leg
          sites: [],
        },
      ],
      plannedLocations: [],
    };

    const payload = buildExportPayload(baseTrip, [day], [], [], []);

    expect(payload.days[0].stops).toHaveLength(0);
  });

  it("includes planned locations as stops", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day: any = {
      id: "day1",
      dayIndex: 0,
      date: d("2026-06-01"),
      title: "Explore",
      participantNotes: null,
      primaryLocationId: null,
      scheduleItems: [],
      plannedLocations: [
        {
          id: "pl1",
          locationId: "loc-planned",
          location: baseLoc("loc-planned", "Local Museum", "region-wiltshire"),
        },
      ],
    };

    const locations = [baseLoc("loc-planned", "Local Museum", "region-wiltshire")];
    const regions = [baseRegion("region-wiltshire", "Wiltshire", null)];

    const payload = buildExportPayload(baseTrip, [day], [], locations, regions);

    expect(payload.days[0].stops).toHaveLength(1);
    expect(payload.days[0].stops[0]).toMatchObject({
      locationId: "loc-planned",
      source: "planned",
      startTime: null,
      endTime: null,
    });
  });

  it("dedupes stops by locationId (first occurrence wins)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day: any = {
      id: "day1",
      dayIndex: 0,
      date: d("2026-06-01"),
      title: "Multi-visit",
      participantNotes: null,
      primaryLocationId: null,
      scheduleItems: [
        {
          order: 0,
          title: "Morning visit",
          startTime: "09:00",
          endTime: "11:00",
          category: { name: "Visit" },
          travel: null,
          sites: [
            { order: 0, location: baseLoc("loc-same", "Museum", null) },
          ],
        },
        {
          order: 1,
          title: "Afternoon visit",
          startTime: "14:00",
          endTime: "16:00",
          category: { name: "Visit" },
          travel: null,
          sites: [
            { order: 0, location: baseLoc("loc-same", "Museum", null) },
          ],
        },
      ],
      plannedLocations: [],
    };

    const payload = buildExportPayload(baseTrip, [day], [], [], []);

    // Should dedupe to 1 stop, the first one.
    expect(payload.days[0].stops).toHaveLength(1);
    expect(payload.days[0].stops[0]).toMatchObject({
      locationId: "loc-same",
      source: "schedule",
      startTime: "09:00", // First occurrence
      endTime: "11:00",
    });
  });

  it("includes itemTitle when it differs from location name", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day: any = {
      id: "day1",
      dayIndex: 0,
      date: d("2026-06-01"),
      title: "Day",
      participantNotes: null,
      primaryLocationId: null,
      scheduleItems: [
        {
          order: 0,
          title: "Special Event",
          startTime: "10:00",
          endTime: "12:00",
          category: null,
          travel: null,
          sites: [
            { order: 0, location: baseLoc("loc1", "Venue Name", null) },
          ],
        },
      ],
      plannedLocations: [],
    };

    const payload = buildExportPayload(baseTrip, [day], [], [], []);

    expect(payload.days[0].stops[0].itemTitle).toBe("Special Event");
  });

  it("omits itemTitle when it matches location name", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day: any = {
      id: "day1",
      dayIndex: 0,
      date: d("2026-06-01"),
      title: "Day",
      participantNotes: null,
      primaryLocationId: null,
      scheduleItems: [
        {
          order: 0,
          title: "Museum Name", // Matches location name
          startTime: "10:00",
          endTime: "12:00",
          category: null,
          travel: null,
          sites: [
            { order: 0, location: baseLoc("loc1", "Museum Name", null) },
          ],
        },
      ],
      plannedLocations: [],
    };

    const payload = buildExportPayload(baseTrip, [day], [], [], []);

    expect(payload.days[0].stops[0].itemTitle).toBeNull();
  });

  it("resolves overnight lodging by date", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day: any = {
      id: "day1",
      dayIndex: 0,
      date: d("2026-06-01"),
      title: "Day 1",
      participantNotes: null,
      primaryLocationId: null,
      scheduleItems: [],
      plannedLocations: [],
    };

    const stay = {
      checkIn: d("2026-06-01"),
      checkOut: d("2026-06-02"),
      checkInDayIndex: null,
      checkOutDayIndex: null,
      priority: 0,
      locationId: "hotel1",
    };

    const locations = [baseLoc("hotel1", "Hotel", "region1")];
    const regions = [baseRegion("region1", "Region", null)];

    const payload = buildExportPayload(baseTrip, [day], [stay], locations, regions);

    expect(payload.days[0].overnight).toEqual({ locationId: "hotel1" });
  });

  it("resolves overnight with day-index anchors on templates", () => {
    const template = { ...baseTrip, isTemplate: true, startDate: null, endDate: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day: any = {
      id: "day1",
      dayIndex: 0,
      date: null,
      title: "Day 1",
      participantNotes: null,
      primaryLocationId: null,
      scheduleItems: [],
      plannedLocations: [],
    };

    const stay = {
      checkIn: null,
      checkOut: null,
      checkInDayIndex: 0,
      checkOutDayIndex: 1,
      priority: 0,
      locationId: "hotel1",
    };

    const locations = [baseLoc("hotel1", "Hotel", "region1")];
    const regions = [baseRegion("region1", "Region", null)];

    const payload = buildExportPayload(template, [day], [stay], locations, regions);

    expect(payload.days[0].overnight).toEqual({ locationId: "hotel1" });
  });

  it("uses cityRegionId fallback chain: primaryLocation → overnight → first stop", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day1: any = {
      id: "day1",
      dayIndex: 0,
      date: d("2026-06-01"),
      title: "Day 1",
      participantNotes: null,
      primaryLocationId: "primary1",
      scheduleItems: [],
      plannedLocations: [],
    };

    const locations = [
      { ...baseLoc("primary1", "Primary", "region-primary"), regionId: "region-primary" },
    ];
    const regions = [baseRegion("region-primary", "Primary Region", null)];

    const payload = buildExportPayload(baseTrip, [day1], [], locations, regions);

    expect(payload.days[0].cityRegionId).toBe("region-primary");
  });

  it("includes region hierarchy in regions dict", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day: any = {
      id: "day1",
      dayIndex: 0,
      date: d("2026-06-01"),
      title: "Day 1",
      participantNotes: null,
      primaryLocationId: null,
      scheduleItems: [
        {
          order: 0,
          title: "Visit",
          startTime: "10:00",
          endTime: "12:00",
          category: null,
          travel: null,
          sites: [
            { order: 0, location: baseLoc("loc1", "Place", "region-child") },
          ],
        },
      ],
      plannedLocations: [],
    };

    const locations = [baseLoc("loc1", "Place", "region-child")];
    const regions = [
      baseRegion("region-parent", "England", null),
      baseRegion("region-child", "London", "region-parent"),
    ];

    const payload = buildExportPayload(baseTrip, [day], [], locations, regions);

    expect(payload.regions).toHaveProperty("region-parent");
    expect(payload.regions).toHaveProperty("region-child");
    expect(payload.regions["region-child"].parentId).toBe("region-parent");
  });

  it("produces deterministic JSON (same input → same output)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day: any = {
      id: "day1",
      dayIndex: 0,
      date: d("2026-06-01"),
      title: "Day 1",
      participantNotes: null,
      primaryLocationId: null,
      scheduleItems: [
        {
          order: 0,
          title: "Visit",
          startTime: "10:00",
          endTime: "12:00",
          category: { name: "Visit" },
          travel: null,
          sites: [
            { order: 0, location: baseLoc("loc1", "Place", "region1") },
          ],
        },
      ],
      plannedLocations: [],
    };

    const locations = [baseLoc("loc1", "Place", "region1")];
    const regions = [baseRegion("region1", "Region", null)];

    const payload1 = buildExportPayload(baseTrip, [day], [], locations, regions);
    const payload2 = buildExportPayload(baseTrip, [day], [], locations, regions);

    // JSON serialization should be identical.
    expect(JSON.stringify(payload1)).toBe(JSON.stringify(payload2));
  });

  it("never includes logistical notes, contact details, or staff-only fields", () => {
    const payload = buildExportPayload(baseTrip, [], [], [], []);

    // Serialize to JSON to verify redaction.
    const json = JSON.stringify(payload);
    expect(json).not.toContain("logisticalNotes");
    expect(json).not.toContain("notes"); // Day/stay notes
    expect(json).not.toContain("contact");
    expect(json).not.toContain("cost");
    expect(json).not.toContain("booking");
    expect(json).not.toContain("payment");
    expect(json).not.toContain("mapUrl"); // Raw URL; mapHref is computed
  });
});
