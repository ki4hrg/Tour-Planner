import { describe, it, expect } from "vitest";
import type { VenueBookingRow } from "./booking-dashboard";
import {
  ALL_ATTENTION_FILTERS,
  NO_ATTENTION_FILTERS,
  actionItems,
  buildVenueEmail,
  filterVenueGroups,
  formatSession,
  formatTripDates,
  groupRowsByVenue,
  rowMatchesFilters,
  rowNeedsAttention,
  type TripRef,
  type VenueMeta,
} from "./cross-trip-bookings";

function row(over: Partial<VenueBookingRow> = {}): VenueBookingRow {
  return {
    kind: "venue",
    locationId: "loc-a",
    locationName: "Epworth Rectory",
    bookable: true,
    bookingId: null,
    status: "PLANNED",
    progress: {
      exists: false,
      status: "PLANNED",
      stageLabel: null,
      stageOn: null,
      workflowId: null,
      completions: [],
    },
    label: null,
    confirmationRef: null,
    notes: null,
    bookedContactId: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    sessions: [],
    nightCount: 0,
    costs: [],
    bookedOn: null,
    agreedAmount: 100,
    agreedCurrency: "GBP",
    agreedUnit: null,
    agreedTotal: 100,
    headcount: null,
    payments: [],
    paidTotal: 0,
    unpaidBalance: 100,
    settled: false,
    schedule: [],
    overdueAmount: 0,
    nextDue: null,
    earliest: null,
    open: false,
    daysUntilOpen: null,
    isMissingCost: false,
    isMissingTime: false,
    needsInfo: false,
    ...over,
  };
}

const trip = (
  id: string,
  startDate: string | null,
  endDate: string | null = null,
): TripRef => ({
  id,
  name: `Trip ${id}`,
  tripTypeName: "Wesley",
  startDate,
  endDate,
});

const venues = new Map<string, VenueMeta>([
  [
    "loc-a",
    {
      id: "loc-a",
      name: "Epworth Rectory",
      regionPath: "England › Lincolnshire",
      primaryContact: {
        id: "c1",
        name: "Jane Warden",
        email: "jane@example.org",
        phone: "+441234",
      },
    },
  ],
  [
    "loc-b",
    {
      id: "loc-b",
      name: "New Room",
      regionPath: "England › Bristol",
      primaryContact: null,
    },
  ],
]);

describe("rowMatchesFilters / rowNeedsAttention", () => {
  it("ignores walk-by and not-needed rows", () => {
    expect(
      rowMatchesFilters(row({ bookable: false }), ALL_ATTENTION_FILTERS),
    ).toBe(false);
    expect(
      rowMatchesFilters(row({ status: "NOT_NEEDED" }), ALL_ATTENTION_FILTERS),
    ).toBe(false);
  });
  it("flags an open window only while unsecured", () => {
    const f = { ...NO_ATTENTION_FILTERS, windowOpen: true };
    expect(rowMatchesFilters(row({ open: true }), f)).toBe(true);
    expect(rowMatchesFilters(row({ open: true, status: "CONFIRMED" }), f)).toBe(
      false,
    );
  });
  it("attention = window open, overdue or missing price — not merely unconfirmed", () => {
    expect(rowNeedsAttention(row())).toBe(false);
    expect(
      rowNeedsAttention(row({ overdueAmount: 50, status: "CONFIRMED" })),
    ).toBe(true);
    expect(rowNeedsAttention(row({ isMissingCost: true }))).toBe(true);
  });
});

describe("groupRowsByVenue", () => {
  it("pivots trips into one group per venue, attention first, rows by date", () => {
    const groups = groupRowsByVenue(
      [
        {
          trip: trip("2027", "2027-07-01"),
          venueRows: [
            row(),
            row({ locationId: "loc-b", locationName: "New Room", open: true }),
          ],
        },
        {
          trip: trip("2026", "2026-07-01"),
          venueRows: [
            row({
              bookedContactId: "c2",
              contactName: "Bob Booker",
              contactEmail: "bob@example.org",
            }),
            row({ locationId: "walk", bookable: false }),
          ],
        },
      ],
      venues,
    );
    expect(groups.map((g) => g.locationId)).toEqual(["loc-b", "loc-a"]);
    const a = groups[1];
    expect(a.regionPath).toBe("England › Lincolnshire");
    expect(a.rows.map((r) => r.trip.id)).toEqual(["2026", "2027"]);
    expect(a.contacts.map((c) => [c.name, c.primary])).toEqual([
      ["Jane Warden", true],
      ["Bob Booker", false],
    ]);
    expect(groups[0].attentionCount).toBe(1);
  });

  it("dedupes a booked contact who is also the primary", () => {
    const [g] = groupRowsByVenue(
      [
        {
          trip: trip("x", null),
          venueRows: [
            row({ bookedContactId: "c1", contactName: "Jane Warden" }),
          ],
        },
      ],
      venues,
    );
    expect(g.contacts).toHaveLength(1);
  });

  it("orders non-attention venues by soonest trip, then name", () => {
    const groups = groupRowsByVenue(
      [
        { trip: trip("late", "2027-01-01"), venueRows: [row()] },
        {
          trip: trip("soon", "2026-10-01"),
          venueRows: [row({ locationId: "loc-b", locationName: "New Room" })],
        },
      ],
      venues,
    );
    expect(groups.map((g) => g.locationId)).toEqual(["loc-b", "loc-a"]);
  });
});

describe("filterVenueGroups", () => {
  const groups = groupRowsByVenue(
    [
      {
        trip: trip("t", "2026-10-01"),
        venueRows: [
          row({ status: "CONFIRMED" }),
          row({ locationId: "loc-b", locationName: "New Room" }),
        ],
      },
    ],
    venues,
  );
  it("keeps venues with any matching row", () => {
    expect(
      filterVenueGroups(groups, ALL_ATTENTION_FILTERS).map((g) => g.locationId),
    ).toEqual(["loc-b"]);
  });
  it("shows everything with no filter on", () => {
    expect(filterVenueGroups(groups, NO_ATTENTION_FILTERS)).toHaveLength(2);
  });
  it("searches venue name and region", () => {
    expect(
      filterVenueGroups(groups, NO_ATTENTION_FILTERS, "epworth"),
    ).toHaveLength(1);
    expect(
      filterVenueGroups(groups, NO_ATTENTION_FILTERS, "bristol")[0].locationId,
    ).toBe("loc-b");
  });
});

describe("formatting", () => {
  it("formats trip date ranges", () => {
    expect(
      formatTripDates({ startDate: "2026-07-06", endDate: "2026-07-12" }),
    ).toBe("6 Jul – 12 Jul 2026");
    expect(
      formatTripDates({ startDate: "2026-12-30", endDate: "2027-01-03" }),
    ).toBe("30 Dec 2026 – 3 Jan 2027");
    expect(formatTripDates({ startDate: null, endDate: null })).toBe(
      "Dates TBC",
    );
  });
  it("formats sessions with date or day number", () => {
    expect(
      formatSession({
        id: "i",
        dayIndex: 2,
        date: "2026-07-07",
        startTime: "10:00",
        endTime: "12:00",
        label: "Visit",
      }),
    ).toBe("Tue 7 Jul, 10:00–12:00: Visit");
    expect(
      formatSession({
        id: "i",
        dayIndex: 3,
        date: null,
        startTime: null,
        endTime: null,
        label: "Tour",
      }),
    ).toBe("Day 3: Tour");
  });
});

describe("buildVenueEmail", () => {
  const [group] = groupRowsByVenue(
    [
      {
        trip: trip("a", "2026-07-06", "2026-07-12"),
        venueRows: [
          row({
            status: "IN_PROGRESS",
            // The workflow stage is what the venue email reports.
            progress: {
              exists: true,
              status: "IN_PROGRESS",
              stageLabel: "Requested",
              stageOn: "2026-05-01",
              workflowId: "wf",
              completions: [],
            },
            confirmationRef: "R-1",
            nightCount: 2,
            sessions: [
              {
                id: "s",
                dayIndex: 2,
                date: "2026-07-07",
                startTime: "10:00",
                endTime: null,
                label: "Visit",
              },
            ],
          }),
        ],
      },
      { trip: trip("b", "2027-07-05", "2027-07-11"), venueRows: [row()] },
      {
        trip: trip("skip", "2027-09-01"),
        venueRows: [row({ status: "NOT_NEEDED" })],
      },
    ],
    venues,
  );

  it("addresses the venue about every in-play trip", () => {
    const email = buildVenueEmail(group);
    expect(email.tripCount).toBe(2);
    expect(email.to).toEqual(["jane@example.org"]);
    expect(email.subject).toBe(
      "Epworth Rectory: 2 upcoming groups (Trip a, Trip b)",
    );
    expect(email.body).toContain("Hello Jane,");
    expect(email.body).toContain("1. Trip a (6 Jul – 12 Jul 2026)");
    expect(email.body).toContain("   - Tue 7 Jul, 10:00: Visit");
    expect(email.body).toContain("   - Lodging: 2 nights");
    expect(email.body).toContain("   Status: Requested (ref R-1)");
    expect(email.body).toContain("2. Trip b (5 Jul – 11 Jul 2027)");
    expect(email.body).not.toContain("Trip skip");
  });

  it("builds an encoded mailto link", () => {
    const { href, body, subject } = buildVenueEmail(group);
    expect(href.startsWith("mailto:jane@example.org?subject=")).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe(subject);
    expect(url.searchParams.get("body")).toBe(body);
    expect(href).not.toContain(" ");
  });

  it("greets generically without a contact email", () => {
    const [g] = groupRowsByVenue(
      [
        {
          trip: trip("a", "2026-07-06"),
          venueRows: [row({ locationId: "loc-b", locationName: "New Room" })],
        },
      ],
      venues,
    );
    const email = buildVenueEmail(g);
    expect(email.to).toEqual([]);
    expect(email.href.startsWith("mailto:?subject=")).toBe(true);
    expect(email.subject).toBe("New Room: Trip a (6 Jul 2026)");
    expect(email.body).toContain("Hello there,");
  });
});

describe("actionItems", () => {
  const groups = groupRowsByVenue(
    [
      {
        trip: trip("t1", "2026-10-01"),
        venueRows: [
          row({ open: true, earliest: "2026-05-01" }),
          row({
            locationId: "loc-b",
            locationName: "New Room",
            isMissingCost: true,
            status: "CONFIRMED",
          }),
        ],
      },
      {
        trip: trip("t2", "2027-07-01"),
        venueRows: [
          row({
            open: true,
            earliest: "2026-02-01",
            overdueAmount: 40,
            agreedCurrency: "GBP",
          }),
          row({
            locationId: "loc-b",
            locationName: "New Room",
            open: true,
            earliest: "2026-01-15",
          }),
          row({
            locationId: "loc-c",
            locationName: "Quiet",
            status: "IN_PROGRESS",
          }),
          row({
            locationId: "loc-d",
            locationName: "Skipped",
            status: "NOT_NEEDED",
            open: true,
          }),
        ],
      },
    ],
    venues,
  );

  it("exposes per-row flags", () => {
    const g = groups.find((x) => x.locationId === "loc-a")!;
    expect(g.rows.find((r) => r.trip.id === "t2")!.flags).toEqual({
      windowOpen: true,
      missingPrice: false,
      paymentOverdue: true,
      unconfirmed: true,
    });
  });

  it("orders overdue, then open windows by date, then missing price; one per row", () => {
    const items = actionItems(groups);
    expect(items.map((i) => [i.reason, i.key])).toEqual([
      ["paymentOverdue", "t2:loc-a"],
      ["windowOpen", "t2:loc-b"],
      ["windowOpen", "t1:loc-a"],
      ["missingPrice", "t1:loc-b"],
    ]);
    expect(items[0].text).toBe("£40.00 overdue");
    expect(items[1].text).toBe(
      "Booking window open since Thu, 15 Jan 2026 · planned",
    );
    expect(items[3].text).toBe("No price agreed");
    expect(items[0].href).toBe("/trips/t2/booking?venue=loc-a");
  });
});
