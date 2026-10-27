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
