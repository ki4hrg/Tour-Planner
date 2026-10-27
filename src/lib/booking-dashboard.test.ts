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
      openedOn: null,
      locationDefaultWorkflowId: null,
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

describe("buildDashboardRows — per-person agreed price", () => {
  const build = (
    agreedUnit: "PER_PERSON" | "PER_GROUP" | null,
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
          agreedAmount: 15,
          agreedCurrency: "GBP",
          agreedUnit,
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

  it("multiplies a per-person rate by headcount for balance + settled", () => {
    const row = build("PER_PERSON", 40, 15);
    expect(row.agreedAmount).toBe(15);
    expect(row.agreedTotal).toBe(600);
    expect(row.unpaidBalance).toBe(585);
    expect(row.settled).toBe(false);
    expect(build("PER_PERSON", 40, 600).settled).toBe(true);
  });

  it("leaves the total unknown without a headcount", () => {
    const row = build("PER_PERSON", null, 15);
    expect(row.agreedTotal).toBeNull();
    expect(row.unpaidBalance).toBeNull();
    expect(row.settled).toBe(false);
    expect(row.isMissingCost).toBe(false);
  });

  it("treats PER_GROUP and null as the total", () => {
    expect(build("PER_GROUP", 40, 15).settled).toBe(true);
    expect(build(null, 40, 0).agreedTotal).toBe(15);
  });
});
