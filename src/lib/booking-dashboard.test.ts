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
      status: "PLANNED",
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
      locationDefaultWorkflowId: null,
    });
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
