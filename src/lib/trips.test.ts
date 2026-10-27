import { describe, it, expect } from "vitest";
import {
  scheduleItemPrimaryLabel,
  groupItemsByVenue,
  effectivePresenters,
  summarizeDayLodging,
  deriveTripLifecycle,
  travelRoute,
  travelDetailLine,
  type SerializedScheduleItem,
  type SerializedTravelLeg,
} from "./trips";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// Minimal SerializedScheduleItem factory — only the fields the read-view helpers
// touch matter; the rest are filled with inert defaults.
let seq = 0;
function item(
  over: Partial<SerializedScheduleItem> & {
    venues?: string[];
    categoryName?: string;
  } = {},
): SerializedScheduleItem {
  const { venues, categoryName, ...rest } = over;
  return {
    id: rest.id ?? `i${seq++}`,
    dayId: "day1",
    categoryId: categoryName ? "c" : null,
    category: categoryName ? { id: "c", name: categoryName, color: null } : null,
    title: null,
    order: 0,
    startTime: null,
    endTime: null,
    notes: null,
    isBlock: false,
    fixedTime: false,
    presentationId: null,
    presentation: null,
    presenters: [],
    sites: (venues ?? []).map((name, i) => ({
      id: `s${i}`,
      locationId: name,
      order: i,
      location: { id: name, name },
    })),
    bookings: [],
    ...rest,
  };
}

describe("scheduleItemPrimaryLabel", () => {
  it("prefers an explicit title over everything", () => {
    const r = scheduleItemPrimaryLabel({
      title: "Morning briefing",
      presentation: { title: "A Talk" },
      category: { name: "Visit" },
    });
    expect(r).toEqual({
      primary: "Morning briefing",
      presentationIsPrimary: false,
      labelFromCategory: false,
    });
  });

  it("falls back to the talk title, flagging it primary", () => {
    const r = scheduleItemPrimaryLabel({
      title: null,
      presentation: { title: "Wesley & the Revival" },
      category: { name: "Presentation" },
    });
    expect(r.primary).toBe("Wesley & the Revival");
    expect(r.presentationIsPrimary).toBe(true);
    expect(r.labelFromCategory).toBe(false);
  });

  it("uses the category name when there's no title or talk (chip dropped)", () => {
    const r = scheduleItemPrimaryLabel({
      title: null,
      presentation: null,
      category: { name: "Free time" },
    });
    expect(r.primary).toBe("Free time");
    expect(r.labelFromCategory).toBe(true);
  });

  it("qualifies a bare category label with its venue(s)", () => {
    const r = scheduleItemPrimaryLabel({
      title: null,
      presentation: null,
      category: { name: "Visit" },
      sites: [{ location: { name: "The Old Rectory" } }],
    });
    expect(r.primary).toBe("Visit: The Old Rectory");
    expect(r.labelFromCategory).toBe(true);
  });

  it("joins multiple venues on a category-labelled block", () => {
    const r = scheduleItemPrimaryLabel({
      title: null,
      presentation: null,
      category: { name: "Visit" },
      sites: [
        { location: { name: "Close Walk" } },
        { location: { name: "Old Sarum" } },
      ],
    });
    expect(r.primary).toBe("Visit: Close Walk, Old Sarum");
  });

  it("names a category-less venue item after its venue", () => {
    const r = scheduleItemPrimaryLabel({
      title: null,
      presentation: null,
      category: null,
      sites: [{ location: { name: "Old Sarum" } }],
    });
    expect(r.primary).toBe("Old Sarum");
    expect(r.labelFromCategory).toBe(false);
  });

  it("reads 'Visit' where the venue is already the heading", () => {
    const r = scheduleItemPrimaryLabel(
      {
        title: null,
        presentation: null,
        category: null,
        sites: [{ location: { name: "Old Sarum" } }],
      },
      { venueInHeading: false },
    );
    expect(r.primary).toBe("Visit");
  });

  it("falls back to the notes, then 'Item', when nothing identifies it", () => {
    const base = { title: null, presentation: null, category: null };
    expect(scheduleItemPrimaryLabel({ ...base, notes: "Meet at gate\nbring id" }).primary).toBe("Meet at gate");
    expect(scheduleItemPrimaryLabel(base).primary).toBe("Item");
  });
});

// Minimal travel-leg factory for the label/route helpers (GH #80).
function leg(over: Partial<SerializedTravelLeg> = {}): SerializedTravelLeg {
  return {
    id: "t1",
    method: "COACH",
    fromLocation: null,
    fromLabel: null,
    toLocation: null,
    toLabel: null,
    stops: [],
    ...over,
  };
}

describe("travel labels (GH #80)", () => {
  it("labels a travel item by method + destination", () => {
    const r = scheduleItemPrimaryLabel({
      title: null,
      presentation: null,
      category: { name: "Travel" },
      travel: leg({ toLocation: { id: "b", name: "Bristol" } }),
    });
    expect(r.primary).toBe("Coach to Bristol");
    expect(r.labelFromCategory).toBe(false);
  });

  it("prefers the free-text destination when no location is catalogued", () => {
    const r = scheduleItemPrimaryLabel({
      title: null,
      presentation: null,
      category: null,
      travel: leg({ method: "TRAIN", toLabel: "London Paddington" }),
    });
    expect(r.primary).toBe("Train to London Paddington");
  });

  it("falls back to the bare method label without a destination", () => {
    const r = scheduleItemPrimaryLabel({
      title: null,
      presentation: null,
      category: null,
      travel: leg({ method: "WALK" }),
    });
    expect(r.primary).toBe("Walk");
  });

  it("still lets an explicit title override the travel label", () => {
    const r = scheduleItemPrimaryLabel({
      title: "Scenic transfer",
      presentation: null,
      category: null,
      travel: leg({ toLabel: "Bristol" }),
    });
    expect(r.primary).toBe("Scenic transfer");
  });

  it("travelRoute renders origin → destination, or the known endpoint", () => {
    expect(
      travelRoute(
        leg({
          fromLocation: { id: "a", name: "Old Sarum" },
          toLocation: { id: "b", name: "Bristol" },
        }),
      ),
    ).toBe("Old Sarum → Bristol");
    expect(travelRoute(leg({ fromLabel: "Salisbury" }))).toBe("Salisbury");
    expect(travelRoute(leg())).toBeNull();
  });

  it("travelDetailLine appends stops with dwell times", () => {
    const detail = travelDetailLine(
      leg({
        fromLocation: { id: "a", name: "Old Sarum" },
        toLocation: { id: "b", name: "Bristol" },
        stops: [
          { id: "s1", location: null, label: "M5 services", dwellMinutes: 15, order: 0 },
          { id: "s2", location: { id: "st", name: "Stonehenge" }, label: null, dwellMinutes: null, order: 1 },
        ],
      }),
    );
    expect(detail).toBe("Old Sarum → Bristol · via M5 services (15 min), Stonehenge");
    expect(travelDetailLine(leg())).toBeNull();
  });
});

describe("groupItemsByVenue", () => {
  it("gives a travel item its own location-less run (the seam between venues)", () => {
    const runs = groupItemsByVenue([
      item({ venues: ["Old Sarum"] }),
      item({ travel: leg({ toLocation: { id: "b", name: "Bristol" } }) }),
      item({ venues: ["New Room"] }),
    ]);
    expect(runs.map((r) => r.kind)).toEqual(["single", "none", "single"]);
    expect(runs[1].items).toHaveLength(1);
  });

  it("merges consecutive items at the same single venue into one run", () => {
    const runs = groupItemsByVenue([
      item({ venues: ["Sarum"] }),
      item({ venues: ["Sarum"] }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      kind: "single",
      venues: [{ id: "Sarum", name: "Sarum" }],
    });
    expect(runs[0].items).toHaveLength(2);
  });

  it("starts a fresh run when the same venue is revisited later", () => {
    const runs = groupItemsByVenue([
      item({ venues: ["Sarum"] }),
      item({ venues: ["Cathedral"] }),
      item({ venues: ["Sarum"] }),
    ]);
    expect(runs.map((r) => r.venues[0]?.name)).toEqual([
      "Sarum",
      "Cathedral",
      "Sarum",
    ]);
  });

  it("treats a multi-site item as its own 'multi' run", () => {
    const runs = groupItemsByVenue([
      item({ venues: ["Old Sarum", "Cathedral Close"], isBlock: true }),
    ]);
    expect(runs[0].kind).toBe("multi");
    expect(runs[0].venues).toHaveLength(2);
  });

  it("folds an on-site Break into the preceding single-venue run", () => {
    const runs = groupItemsByVenue([
      item({ venues: ["Sarum"] }),
      item({ categoryName: "Break" }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].items).toHaveLength(2);
  });

  it("keeps Free time as its own headerless run (it implies leaving)", () => {
    const runs = groupItemsByVenue([
      item({ venues: ["Sarum"] }),
      item({ categoryName: "Free time" }),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({ kind: "none", venues: [] });
  });

  it("never tucks a location-less item under a multi-site run", () => {
    const runs = groupItemsByVenue([
      item({ venues: ["A", "B"], isBlock: true }),
      item({ categoryName: "Break" }),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[1].kind).toBe("none");
  });
});

describe("effectivePresenters", () => {
  const ada = { id: "ada", name: "Ada" };
  const grace = { id: "grace", name: "Grace" };

  it("uses the per-occurrence override when present", () => {
    expect(
      effectivePresenters({
        presenters: [grace],
        presentation: { defaultPresenters: [ada] },
      }),
    ).toEqual([grace]);
  });

  it("falls back to the talk's default presenters", () => {
    expect(
      effectivePresenters({
        presenters: [],
        presentation: { defaultPresenters: [ada] },
      }),
    ).toEqual([ada]);
  });

  it("is empty when neither override nor talk supplies speakers", () => {
    expect(
      effectivePresenters({ presenters: [], presentation: null }),
    ).toEqual([]);
  });
});

describe("summarizeDayLodging", () => {
  it("produces a client-safe summary keyed by day id", () => {
    const days = [{ id: "day6", date: d("2026-07-06") }];
    const stays = [
      {
        checkIn: d("2026-07-06"),
        checkOut: d("2026-07-08"),
        priority: 0,
        location: { name: "Sarum College" },
      },
    ];
    expect(summarizeDayLodging(days, stays)).toEqual({
      day6: { locationName: "Sarum College" },
    });
  });

  it("maps a night with no stay to null", () => {
    const days = [{ id: "day9", date: d("2026-07-09") }];
    expect(summarizeDayLodging(days, [])).toEqual({ day9: null });
  });
});

describe("deriveTripLifecycle", () => {
  const today = d("2026-07-12");
  const active = (startDate: Date | null, endDate: Date | null) =>
    ({ status: "ACTIVE", startDate, endDate }) as const;

  it("is PLANNING before the start date", () => {
    expect(deriveTripLifecycle(active(d("2026-07-13"), d("2026-07-20")), today))
      .toBe("PLANNING");
  });

  it("is PLANNING when dates are unset", () => {
    expect(deriveTripLifecycle(active(null, null), today)).toBe("PLANNING");
  });

  it("is IN_PROGRESS between start and end inclusive", () => {
    expect(deriveTripLifecycle(active(d("2026-07-10"), d("2026-07-12")), today))
      .toBe("IN_PROGRESS");
    expect(deriveTripLifecycle(active(d("2026-07-12"), d("2026-07-15")), today))
      .toBe("IN_PROGRESS");
  });

  it("treats a missing end date as single-day (mirrors isOngoing)", () => {
    expect(deriveTripLifecycle(active(d("2026-07-12"), null), today)).toBe(
      "IN_PROGRESS",
    );
    expect(deriveTripLifecycle(active(d("2026-07-11"), null), today)).toBe(
      "COMPLETE",
    );
  });

  it("is COMPLETE after the end date", () => {
    expect(deriveTripLifecycle(active(d("2026-07-01"), d("2026-07-11")), today))
      .toBe("COMPLETE");
  });

  it("manual overrides win regardless of dates", () => {
    expect(
      deriveTripLifecycle(
        { status: "ARCHIVED", startDate: d("2026-07-12"), endDate: d("2026-07-15") },
        today,
      ),
    ).toBe("ARCHIVED");
    expect(
      deriveTripLifecycle({ status: "CANCELLED", startDate: null, endDate: null }, today),
    ).toBe("CANCELLED");
  });
});
