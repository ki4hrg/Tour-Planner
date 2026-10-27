import { describe, it, expect } from "vitest";
import { resolveBookingProgress, nextStep, upcomingStep } from "./booking-workflow";

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
