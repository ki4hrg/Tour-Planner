import { describe, it, expect } from "vitest";
import {
  resolveBookingProgress,
  nextStep,
  stepGate,
  stepGateError,
  upcomingStep,
  waitingOn,
  daysWaiting,
  waitingView,
  waitingFromView,
  stepDueDate,
  describeStepDue,
  isDue,
} from "./booking-workflow";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const steps = [
  { id: "contact", label: "Initial contact", sortOrder: 0, status: "IN_PROGRESS" as const },
  { id: "avail", label: "Availability confirmed", sortOrder: 1, status: "IN_PROGRESS" as const },
  { id: "form", label: "Booking submitted", sortOrder: 2, status: "IN_PROGRESS" as const },
  { id: "conf", label: "Confirmed", sortOrder: 3, status: "CONFIRMED" as const },
  { id: "meal", label: "Meal guarantee sent", sortOrder: 4, status: "IN_PROGRESS" as const },
];

describe("resolveBookingProgress", () => {
  it("is PLANNED with no stage when nothing is done", () => {
    expect(resolveBookingProgress(steps, [], "PLANNED")).toEqual({
      status: "PLANNED",
      stageLabel: null,
      stageOn: null,
    });
  });

  it("takes the stage from the latest step in workflow order", () => {
    const p = resolveBookingProgress(
      steps,
      [
        { stepId: "avail", completedOn: d("2026-11-03") },
        { stepId: "contact", completedOn: d("2026-10-20") },
      ],
      "PLANNED",
    );
    expect(p.status).toBe("IN_PROGRESS");
    expect(p.stageLabel).toBe("Availability confirmed");
    expect(p.stageOn).toEqual(d("2026-11-03"));
  });

  it("allows skipped steps and keeps the furthest status reached", () => {
    // Booking form never needed; a later IN_PROGRESS step doesn't demote CONFIRMED.
    const p = resolveBookingProgress(
      steps,
      [
        { stepId: "contact", completedOn: d("2026-10-01") },
        { stepId: "conf", completedOn: d("2026-10-10") },
        { stepId: "meal", completedOn: d("2027-05-01") },
      ],
      "IN_PROGRESS",
    );
    expect(p.status).toBe("CONFIRMED");
    expect(p.stageLabel).toBe("Meal guarantee sent");
  });

  it("keeps a NOT_NEEDED override but still tracks the stage", () => {
    const p = resolveBookingProgress(
      steps,
      [{ stepId: "contact", completedOn: d("2026-10-01") }],
      "NOT_NEEDED",
    );
    expect(p.status).toBe("NOT_NEEDED");
    expect(p.stageLabel).toBe("Initial contact");
  });

  it("ignores completions for steps outside the workflow", () => {
    const p = resolveBookingProgress(
      steps,
      [{ stepId: "other", completedOn: d("2026-10-01") }],
      "CONFIRMED",
    );
    expect(p).toEqual({ status: "PLANNED", stageLabel: null, stageOn: null });
  });
});

describe("nextStep", () => {
  it("returns the first step not done, in order", () => {
    expect(nextStep(steps, [{ stepId: "contact" }, { stepId: "form" }])?.id).toBe("avail");
  });
  it("is null when every step is done", () => {
    expect(nextStep(steps, steps.map((s) => ({ stepId: s.id })))).toBeNull();
  });
});

describe("upcomingStep", () => {
  const done = (...ids: string[]) => ids.map((stepId) => ({ stepId }));
  it("starts at the first step", () => {
    expect(upcomingStep(steps, [], "PLANNED")?.id).toBe("contact");
  });
  it("is the step after the latest done one", () => {
    expect(upcomingStep(steps, done("contact", "avail"), "IN_PROGRESS")?.label).toBe(
      "Booking submitted",
    );
  });
  it("leaves a skipped earlier step skipped", () => {
    expect(upcomingStep(steps, done("contact", "conf"), "CONFIRMED")?.id).toBe("meal");
  });
  it("orders by sortOrder, not array order", () => {
    expect(upcomingStep([...steps].reverse(), done("contact"), "IN_PROGRESS")?.id).toBe(
      "avail",
    );
  });
  it("is null once the last step is done, or when not needed", () => {
    expect(upcomingStep(steps, done("meal"), "IN_PROGRESS")).toBeNull();
    expect(upcomingStep(steps, [], "NOT_NEEDED")).toBeNull();
  });
});

describe("waitingOn", () => {
  const owned = steps.map((s) => ({
    ...s,
    actor: s.id === "avail" || s.id === "conf" ? ("VENUE" as const) : ("US" as const),
  }));
  const at = (stepId: string, on: string) => ({ stepId, completedOn: d(on) });

  it("is our move on the first step, waiting since the booking opened", () => {
    expect(waitingOn(owned, [], "PLANNED", d("2026-10-01"))).toMatchObject({
      step: { id: "contact" },
      actor: "US",
      since: d("2026-10-01"),
    });
  });
  it("waits on the venue since the latest tick", () => {
    const w = waitingOn(
      owned,
      [at("contact", "2026-10-05"), at("form", "2026-10-12")],
      "IN_PROGRESS",
      d("2026-10-01"),
    );
    // "form" done leaves "avail" skipped (upcoming = after the latest done in order).
    expect(w?.step.id).toBe("conf");
    expect(w?.actor).toBe("VENUE");
    expect(w?.since).toEqual(d("2026-10-12"));
  });
  it("uses the most recent completedOn even when ticked out of order", () => {
    const w = waitingOn(
      owned,
      [at("avail", "2026-10-20"), at("contact", "2026-10-02")],
      "IN_PROGRESS",
      null,
    );
    expect(w?.step.id).toBe("form");
    expect(w?.actor).toBe("US");
    expect(w?.since).toEqual(d("2026-10-20"));
  });
  it("ignores completions from another workflow; a missing actor reads as US", () => {
    const w = waitingOn(steps, [at("stale", "2026-10-25")], "PLANNED", null);
    expect(w).toEqual({ step: steps[0], actor: "US", since: null, dueOn: null });
  });
  it("is null when nothing is pending", () => {
    expect(waitingOn(owned, [at("meal", "2026-10-01")], "CONFIRMED", null)).toBeNull();
    expect(waitingOn(owned, [], "NOT_NEEDED", d("2026-10-01"))).toBeNull();
  });
});

describe("daysWaiting / waitingView", () => {
  it("counts whole days, never negative", () => {
    expect(daysWaiting(d("2026-10-15"), d("2026-10-27"))).toBe(12);
    expect(daysWaiting(d("2026-10-27"), d("2026-10-27"))).toBe(0);
    expect(daysWaiting(d("2026-10-30"), d("2026-10-27"))).toBe(0);
  });
  it("serializes the state against today", () => {
    const step = { ...steps[1], actor: "VENUE" as const };
    expect(
      waitingView(
        { step, actor: "VENUE", since: d("2026-10-15"), dueOn: null },
        d("2026-10-27"),
      ),
    ).toEqual({
      stepId: "avail",
      stepLabel: "Availability confirmed",
      actor: "VENUE",
      since: "2026-10-15",
      days: 12,
      dueOn: null,
      due: true,
    });
    expect(
      waitingView(
        { step, actor: "VENUE", since: null, dueOn: null },
        d("2026-10-27"),
      )?.days,
    ).toBeNull();
    expect(waitingView(null, d("2026-10-27"))).toBeNull();
  });
  it("says whether the step's due date has arrived", () => {
    const step = { ...steps[1] };
    const w = (dueOn: Date | null) =>
      waitingView({ step, actor: "US", since: null, dueOn }, d("2026-10-27"));
    expect(w(d("2027-03-01"))).toMatchObject({ dueOn: "2027-03-01", due: false });
    expect(w(d("2026-10-27"))).toMatchObject({ dueOn: "2026-10-27", due: true });
    expect(w(d("2026-10-01"))).toMatchObject({ due: true });
  });
});

describe("step due offsets", () => {
  const start = d("2027-07-12");
  it("resolves a step's due date as the offset before trip start", () => {
    expect(stepDueDate({ dueOffsetValue: 2, dueOffsetUnit: "MONTH" }, start)).toEqual(
      d("2027-05-12"),
    );
    expect(stepDueDate({ dueOffsetValue: 3, dueOffsetUnit: "WEEK" }, start)).toEqual(
      d("2027-06-21"),
    );
    expect(stepDueDate({ dueOffsetValue: 0, dueOffsetUnit: "DAY" }, start)).toEqual(start);
    // No offset, or no start date yet (a template): due whenever it's next.
    expect(stepDueDate({ dueOffsetValue: null, dueOffsetUnit: null }, start)).toBeNull();
    expect(stepDueDate({ dueOffsetValue: 2, dueOffsetUnit: "MONTH" }, null)).toBeNull();
  });
  it("describes the rule for the admin editor", () => {
    expect(describeStepDue({ dueOffsetValue: 2, dueOffsetUnit: "MONTH" })).toBe(
      "2 months before start",
    );
    expect(describeStepDue({ dueOffsetValue: 1, dueOffsetUnit: "WEEK" })).toBe(
      "1 week before start",
    );
    expect(describeStepDue({ dueOffsetValue: 0, dueOffsetUnit: "DAY" })).toBe("on start day");
    expect(describeStepDue({ dueOffsetValue: null, dueOffsetUnit: null })).toBeNull();
  });
  it("waitingOn carries the upcoming step's due date; isDue compares it to today", () => {
    const dated = steps.map((s) =>
      s.id === "form" ? { ...s, dueOffsetValue: 2, dueOffsetUnit: "MONTH" as const } : s,
    );
    const w = waitingOn(
      dated,
      [
        { stepId: "contact", completedOn: d("2026-10-01") },
        { stepId: "avail", completedOn: d("2026-10-05") },
      ],
      "IN_PROGRESS",
      null,
      start,
    );
    expect(w?.step.id).toBe("form");
    expect(w?.dueOn).toEqual(d("2027-05-12"));
    expect(isDue(w, d("2026-10-27"))).toBe(false);
    expect(isDue(w, d("2027-05-12"))).toBe(true);
    // Without a trip start the offset can't resolve: due now.
    expect(waitingOn(dated, [], "PLANNED", null, null)?.dueOn).toBeNull();
    expect(isDue(null, d("2026-10-27"))).toBe(true);
  });
  it("waitingFromView reads the start date off the progress view", () => {
    const dated = steps.map((s) =>
      s.id === "contact" ? { ...s, dueOffsetValue: 12, dueOffsetUnit: "MONTH" as const } : s,
    );
    const w = waitingFromView(
      dated,
      { status: "PLANNED", completions: [], openedOn: null, tripStartDate: "2028-07-10" },
      d("2026-10-27"),
    );
    expect(w?.dueOn).toEqual(d("2027-07-10"));
  });
});

describe("waitingFromView", () => {
  const view = {
    status: "IN_PROGRESS" as const,
    completions: [{ stepId: "contact", completedOn: "2026-10-05" }],
    openedOn: "2026-10-01",
  };
  it("parses the serialized dates", () => {
    const w = waitingFromView(steps, view, d("2026-10-27"));
    expect(w?.step.id).toBe("avail");
    expect(w?.since).toEqual(d("2026-10-05"));
  });
  it("dates an optimistic tick today", () => {
    const w = waitingFromView(steps, view, d("2026-10-27"), new Set(["contact", "avail"]));
    expect(w?.step.id).toBe("form");
    expect(w?.since).toEqual(d("2026-10-27"));
  });
});

describe("stepGate", () => {
  const done = new Set(["contact", "avail"]);
  const gate = stepGate(steps, done);
  it("opens only the next step for completion", () => {
    expect(steps.filter((s) => gate.get(s.id)!.canComplete).map((s) => s.id)).toEqual(["form"]);
  });
  it("opens only the last done step for undo", () => {
    expect(steps.filter((s) => gate.get(s.id)!.canUndo).map((s) => s.id)).toEqual(["avail"]);
  });
  it("opens the first step on a fresh booking, nothing to undo", () => {
    const fresh = stepGate(steps, new Set());
    expect(steps.filter((s) => fresh.get(s.id)!.canComplete).map((s) => s.id)).toEqual(["contact"]);
    expect(steps.some((s) => fresh.get(s.id)!.canUndo)).toBe(false);
  });
  it("lets a gap (a step inserted after bookings moved on) be filled", () => {
    const gap = stepGate(steps, new Set(["contact", "form"]));
    expect(gap.get("avail")!.canComplete).toBe(true);
    expect(gap.get("conf")!.canComplete).toBe(false);
  });
});

describe("stepGateError", () => {
  const done = new Set(["contact"]);
  it("names the first open prerequisite", () => {
    expect(stepGateError(steps, done, "conf", true)).toBe('"Availability confirmed" isn\'t done yet.');
  });
  it("names the latest later step done when undoing", () => {
    expect(stepGateError(steps, new Set(["contact", "avail", "form"]), "contact", false)).toBe(
      '"Booking submitted" is done — undo it first.',
    );
  });
  it("allows the next step, undoing the last, and re-dating a done step", () => {
    expect(stepGateError(steps, done, "avail", true)).toBeNull();
    expect(stepGateError(steps, done, "contact", false)).toBeNull();
    expect(stepGateError(steps, new Set(["contact", "avail"]), "contact", true)).toBeNull();
  });
  it("rejects a step from another workflow", () => {
    expect(stepGateError(steps, done, "nope", true)).toMatch(/isn't part/);
  });
});
