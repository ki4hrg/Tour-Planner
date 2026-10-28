import { describe, it, expect } from "vitest";
import { buildDashboardRows } from "./booking-dashboard";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const loc = (id: string, defaultWorkflowId: string | null = null) => ({
  id,
  name: id,
  bookable: true,
  bookingOpensLeadDays: null,
  costs: [],
  defaultWorkflowId,
});

describe("buildDashboardRows — planned visits + workflow progress", () => {
  it("surfaces a planned-only venue as an untimed session, not missing a time", () => {
    const { venueRows } = buildDashboardRows({
      days: [
        {
          dayIndex: 2,
          date: d("2027-06-02"),
          scheduleItems: [],
          plannedLocations: [{ locationId: "epworth" }],
        },
      ],
      engagements: [],
      stays: [],
      locations: [loc("epworth", "wf-agreement")],
    });
    expect(venueRows).toHaveLength(1);
    const row = venueRows[0];
    expect(row.sessions).toEqual([
      expect.objectContaining({ dayIndex: 2, planned: true, startTime: null }),
    ]);
    expect(row.isMissingTime).toBe(false);
    // Not engaged yet: the control previews the venue's default workflow.
    expect(row.progress).toMatchObject({
      exists: false,
      status: "PENDING",
      locationDefaultWorkflowId: "wf-agreement",
    });
  });

  it("skips a planned visit the same day's schedule already covers", () => {
    const { venueRows } = buildDashboardRows({
      days: [
        {
          dayIndex: 1,
          date: null,
          scheduleItems: [
            {
              id: "item",
              title: "Tour",
              startTime: "10:00",
              endTime: "11:00",
              category: null,
              presentation: null,
              sites: [{ locationId: "epworth" }],
              bookings: [],
            },
          ],
          plannedLocations: [{ locationId: "epworth" }],
        },
      ],
      engagements: [],
      stays: [],
      locations: [loc("epworth")],
    });
    expect(venueRows[0].sessions.map((s) => s.id)).toEqual(["item"]);
  });

  it("carries an engagement's workflow stage and completions", () => {
    const { venueRows } = buildDashboardRows({
      days: [
        {
          dayIndex: 1,
          date: null,
          scheduleItems: [],
          plannedLocations: [{ locationId: "epworth" }],
        },
      ],
      engagements: [
        {
          id: "b1",
          locationId: "epworth",
          label: null,
          status: "IN_PROGRESS",
          stageLabel: "Initial contact",
          stageOn: d("2026-10-20"),
          workflowId: "wf-agreement",
          stepCompletions: [{ stepId: "s1", completedOn: d("2026-10-20") }],
          confirmationRef: null,
          notes: null,
          bookedContactId: null,
          bookedContact: null,
        },
      ],
      stays: [],
      locations: [loc("epworth")],
    });
    expect(venueRows[0].progress).toEqual({
      exists: true,
      status: "IN_PROGRESS",
      stageLabel: "Initial contact",
      stageOn: "2026-10-20",
      workflowId: "wf-agreement",
      completions: [{ stepId: "s1", completedOn: "2026-10-20" }],
      openedOn: null,
      locationDefaultWorkflowId: null,
      tripStartDate: null,
    });
    // No workflow catalog passed: whose move stays unresolved.
    expect(venueRows[0].waiting).toBeNull();
  });

  it("resolves whose move from the workflow catalog, only once engaged", () => {
    const workflows = [
      {
        id: "wf-agreement",
        steps: [
          { id: "s1", label: "Initial contact", sortOrder: 0, status: "IN_PROGRESS" as const, actor: "US" as const },
          { id: "s2", label: "Availability confirmed", sortOrder: 1, status: "IN_PROGRESS" as const, actor: "VENUE" as const },
          { id: "s3", label: "Sign agreement", sortOrder: 2, status: "CONFIRMED" as const, actor: "US" as const },
        ],
      },
    ];
    const { venueRows } = buildDashboardRows({
      days: [
        {
          dayIndex: 1,
          date: null,
          scheduleItems: [],
          plannedLocations: [{ locationId: "epworth" }, { locationId: "oxford" }],
        },
      ],
      engagements: [
        {
          id: "b1",
          locationId: "epworth",
          label: null,
          status: "IN_PROGRESS",
          workflowId: "wf-agreement",
          stepCompletions: [{ stepId: "s1", completedOn: d("2026-10-20") }],
          createdAt: d("2026-10-01"),
          confirmationRef: null,
          notes: null,
          bookedContactId: null,
          bookedContact: null,
        },
      ],
      stays: [],
      locations: [loc("epworth"), loc("oxford", "wf-agreement")],
      workflows,
    });
    const epworth = venueRows.find((r) => r.locationId === "epworth")!;
    expect(epworth.progress.openedOn).toBe("2026-10-01");
    expect(epworth.waiting).toMatchObject({
      stepId: "s2",
      stepLabel: "Availability confirmed",
      actor: "VENUE",
      since: "2026-10-20",
    });
    expect(epworth.waiting?.days).toBeGreaterThanOrEqual(0);
    // Oxford has no engagement yet: no ball in play.
    expect(venueRows.find((r) => r.locationId === "oxford")!.waiting).toBeNull();
  });
});

describe("buildDashboardRows — itemized agreed price", () => {
  type Line = { label: string; amount: number; unit: "PER_PERSON" | "PER_GROUP"; order?: number };
  const pp15: Line[] = [{ label: "Admission", amount: 15, unit: "PER_PERSON" }];
  const build = (
    priceLines: Line[],
    headcount: number | null,
    paid: number,
  ) =>
    buildDashboardRows({
      days: [],
      engagements: [
        {
          id: "b1",
          locationId: "epworth",
          label: null,
          status: "IN_PROGRESS",
          confirmationRef: null,
          notes: null,
          bookedContactId: null,
          bookedContact: null,
          agreedCurrency: "GBP",
          priceLines,
          payments: paid
            ? [
                {
                  id: "p1",
                  bookingId: "b1",
                  amount: paid,
                  currency: "GBP",
                  paidOn: d("2026-10-01"),
                  method: null,
                  note: null,
                  createdAt: d("2026-10-01"),
                } as never,
              ]
            : [],
        },
      ],
      stays: [],
      locations: [loc("epworth")],
      headcount,
    }).venueRows[0];

  it("multiplies per-person lines by headcount for balance + settled", () => {
    const row = build(pp15, 40, 15);
    expect(row.priceLines).toEqual(pp15);
    expect(row.agreedTotal).toBe(600);
    expect(row.unpaidBalance).toBe(585);
    expect(row.settled).toBe(false);
    expect(build(pp15, 40, 600).settled).toBe(true);
  });

  it("mixes per-person × headcount with per-group lines", () => {
    const mixed: Line[] = [
      { label: "Group charge", amount: 90, unit: "PER_GROUP", order: 2 },
      { label: "Admission", amount: 12, unit: "PER_PERSON", order: 0 },
      { label: "Lunch", amount: 20, unit: "PER_PERSON", order: 1 },
    ];
    const row = build(mixed, 40, 0);
    expect(row.agreedTotal).toBe(1370);
    expect(row.priceLines.map((l) => l.label)).toEqual(["Admission", "Lunch", "Group charge"]);
    expect(build(mixed, 30, 0).agreedTotal).toBe(1050);
  });

  it("leaves the total unknown without a headcount", () => {
    const row = build(pp15, null, 15);
    expect(row.agreedTotal).toBeNull();
    expect(row.unpaidBalance).toBeNull();
    expect(row.settled).toBe(false);
    expect(row.isMissingCost).toBe(false);
  });

  it("per-group lines are the total; no lines is a missing price", () => {
    expect(build([{ label: "Hall", amount: 15, unit: "PER_GROUP" }], 40, 15).settled).toBe(true);
    const none = build([], 40, 0);
    expect(none.agreedTotal).toBeNull();
    expect(none.isMissingCost).toBe(true);
  });
});

describe("buildDashboardRows — venue price default, lodging, grouping fields", () => {
  const cost = (
    label: string,
    amount: number,
    over: Partial<{
      unit: "PER_PERSON" | "PER_GROUP";
      currency: string;
      validFrom: Date | null;
      validTo: Date | null;
      confirmedAt: Date | null;
    }> = {},
  ) => ({
    id: label,
    locationId: "hall",
    label,
    amount: amount as unknown as import("@prisma/client").Cost["amount"],
    currency: over.currency ?? "GBP",
    unit: over.unit ?? ("PER_PERSON" as const),
    confirmedAt: over.confirmedAt ?? new Date(),
    validFrom: over.validFrom ?? null,
    validTo: over.validTo ?? null,
    notes: null,
  });

  it("prices an unagreed engagement at the venue's list price valid for the trip", () => {
    const { venueRows } = buildDashboardRows({
      days: [
        {
          dayIndex: 1,
          date: d("2027-07-12"),
          scheduleItems: [
            {
              id: "i1",
              title: null,
              startTime: "10:00",
              endTime: "11:00",
              category: { name: "Talk" },
              presentation: null,
              sites: [{ locationId: "hall" }],
              bookings: [],
            },
          ],
        },
      ],
      engagements: [],
      stays: [],
      locations: [
        {
          ...loc("hall"),
          region: { name: "Wiltshire" },
          costs: [
            cost("Admission", 10, { validTo: d("2027-06-30") }),
            cost("Admission", 12, { validFrom: d("2027-07-01") }),
            cost("Guide", 50, { unit: "PER_GROUP" }),
          ],
        },
      ],
      tripStartDate: d("2027-07-12"),
      headcount: 40,
      defaultCurrency: "GBP",
    });
    const row = venueRows[0];
    expect(row.priceSource).toBe("venue");
    expect(row.priceLines).toEqual([]);
    expect(row.effectiveLines.map((l) => [l.label, l.amount])).toEqual([
      ["Admission", 12],
      ["Guide", 50],
    ]);
    expect(row.agreedTotal).toBe(12 * 40 + 50);
    expect(row.agreedCurrency).toBe("GBP");
    expect(row.isMissingCost).toBe(false);
    // Only the lines in force for the trip's start are offered as list prices.
    expect(row.costs.map((c) => c.amount)).toEqual([12, 50]);
    expect(row.regionName).toBe("Wiltshire");
    expect(row.visitType).toBe("Talk");
    expect(row.firstDayIndex).toBe(1);
  });

  it("an agreed price overrides the venue price", () => {
    const { venueRows } = buildDashboardRows({
      days: [],
      engagements: [
        {
          id: "b",
          locationId: "hall",
          label: null,
          status: "IN_PROGRESS",
          confirmationRef: null,
          notes: null,
          bookedContactId: null,
          bookedContact: null,
          agreedCurrency: "GBP",
          priceLines: [{ label: "Deal", amount: 300, unit: "PER_GROUP", order: 0 }],
        },
      ],
      stays: [],
      locations: [{ ...loc("hall"), costs: [cost("Admission", 12)] }],
      headcount: 40,
    });
    expect(venueRows[0].priceSource).toBe("agreed");
    expect(venueRows[0].agreedTotal).toBe(300);
    expect(venueRows[0].effectiveLines).toEqual(venueRows[0].priceLines);
  });

  it("lists the stays an engagement covers and types the venue as lodging", () => {
    const { venueRows } = buildDashboardRows({
      days: [
        { dayIndex: 1, date: d("2027-07-12"), scheduleItems: [] },
        { dayIndex: 2, date: d("2027-07-13"), scheduleItems: [] },
        { dayIndex: 3, date: d("2027-07-14"), scheduleItems: [] },
      ],
      engagements: [],
      stays: [
        {
          id: "s1",
          locationId: "hall",
          checkIn: d("2027-07-13"),
          checkOut: d("2027-07-14"),
        },
      ],
      locations: [loc("hall")],
      tripStartDate: d("2027-07-12"),
    });
    const row = venueRows[0];
    expect(row.visitType).toBe("Lodging");
    expect(row.firstDayIndex).toBe(2);
    expect(row.stays).toEqual([
      {
        id: "s1",
        checkIn: "2027-07-13",
        checkOut: "2027-07-14",
        checkInDayIndex: null,
        checkOutDayIndex: null,
        nights: 1,
        siteName: null,
      },
    ]);
    expect(row.priceSource).toBeNull();
  });
});
