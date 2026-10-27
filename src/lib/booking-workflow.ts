import type { BookingStatus, StepActor } from "@prisma/client";
import { parseDateInput, toDateInput } from "./dates";

// Booking workflows (admin-defined milestone ladders) → a booking's coarse
// status + stage. Pure, so the server sync layer (booking-workflow-sync.ts) and
// the client control resolve progress the same way.
//
// A step names the coarse status a booking reaches once it is done; the
// booking's status is the furthest any completed step reaches, so steps may be
// ticked out of order (a "Booking submitted" that this venue never needed can
// simply be skipped). The stage is the latest step done, by workflow order.

export const BOOKING_STATUS_RANK: Record<BookingStatus, number> = {
  NOT_NEEDED: 0,
  PLANNED: 1,
  IN_PROGRESS: 2,
  CONFIRMED: 3,
};

/** The coarse statuses a workflow step may reach (DB CHECK booking_workflow_step_status). */
export const STEP_STATUSES = ["IN_PROGRESS", "CONFIRMED"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** Whose move a step is (BookingWorkflowStep.actor). */
export const STEP_ACTORS = ["US", "VENUE"] as const satisfies readonly StepActor[];
export type { StepActor };

export type WorkflowStepLike = {
  id: string;
  label: string;
  sortOrder: number;
  status: BookingStatus;
  // Who completes the step; absent (a caller that didn't load it) reads as US.
  actor?: StepActor;
};

export type StepCompletionLike = { stepId: string; completedOn: Date };

export type BookingProgress = {
  status: BookingStatus;
  stageLabel: string | null;
  stageOn: Date | null;
};

/**
 * Resolve a workflow booking's stored status + stage from its completions.
 * `current` is the stored status: NOT_NEEDED is a manual override that step
 * changes never clear (the stage still tracks, so un-skipping restores it).
 * Completions whose step isn't in `steps` (a stale row from another workflow)
 * are ignored.
 */
export function resolveBookingProgress(
  steps: WorkflowStepLike[],
  completions: StepCompletionLike[],
  current: BookingStatus,
): BookingProgress {
  const doneOn = new Map(completions.map((c) => [c.stepId, c.completedOn]));
  let status: BookingStatus = "PLANNED";
  let stage: { step: WorkflowStepLike; on: Date } | null = null;
  for (const step of steps) {
    const on = doneOn.get(step.id);
    if (!on) continue;
    if (BOOKING_STATUS_RANK[step.status] > BOOKING_STATUS_RANK[status]) {
      status = step.status;
    }
    if (!stage || step.sortOrder >= stage.step.sortOrder) stage = { step, on };
  }
  return {
    status: current === "NOT_NEEDED" ? "NOT_NEEDED" : status,
    stageLabel: stage?.step.label ?? null,
    stageOn: stage?.on ?? null,
  };
}

/** The next step not yet done, in workflow order (null when all are done). */
export function nextStep<S extends WorkflowStepLike>(
  steps: S[],
  completions: { stepId: string }[],
): S | null {
  const done = new Set(completions.map((c) => c.stepId));
  return [...steps].sort((a, b) => a.sortOrder - b.sortOrder).find((s) => !done.has(s.id)) ?? null;
}

/**
 * The step a booking is waiting on — what "Next: …" shows. The first step not
 * done AFTER the latest done one (workflow order), so a step skipped on the way
 * stays skipped, matching how the stage is the latest step done. Null when the
 * booking is not needed or its last step is done.
 */
export function upcomingStep<S extends WorkflowStepLike>(
  steps: S[],
  completions: { stepId: string }[],
  status: BookingStatus,
): S | null {
  if (status === "NOT_NEEDED") return null;
  const done = new Set(completions.map((c) => c.stepId));
  const ordered = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
  let last = -1;
  ordered.forEach((s, i) => {
    if (done.has(s.id)) last = i;
  });
  return ordered.slice(last + 1).find((s) => !done.has(s.id)) ?? null;
}

/**
 * Whose move a booking is: the upcoming step (see `upcomingStep`), who owns
 * it, and since when the ball has sat there — the latest tick on the booking,
 * else `opened` (the booking's bookedOn ?? createdAt; null for an engagement
 * not created yet). Null when nothing is pending.
 */
export type WaitingState<S extends WorkflowStepLike = WorkflowStepLike> = {
  step: S;
  actor: StepActor;
  since: Date | null;
};

export function waitingOn<S extends WorkflowStepLike>(
  steps: S[],
  completions: StepCompletionLike[],
  status: BookingStatus,
  opened: Date | null,
): WaitingState<S> | null {
  const step = upcomingStep(steps, completions, status);
  if (!step) return null;
  const ids = new Set(steps.map((s) => s.id));
  let since: Date | null = null;
  for (const c of completions) {
    if (!ids.has(c.stepId)) continue;
    if (!since || c.completedOn.getTime() > since.getTime()) since = c.completedOn;
  }
  return { step, actor: step.actor ?? "US", since: since ?? opened };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `since` to `today` (both date-only); never negative. */
export function daysWaiting(since: Date, today: Date): number {
  return Math.max(0, Math.round((today.getTime() - since.getTime()) / DAY_MS));
}

/** Client-safe waiting state as the dashboard rows / MCP carry it. */
export type WaitingView = {
  stepId: string;
  stepLabel: string;
  actor: StepActor;
  since: string | null; // "yyyy-mm-dd"
  days: number | null; // days waiting as of the server's today
};

export function waitingView(w: WaitingState | null, today: Date): WaitingView | null {
  if (!w) return null;
  return {
    stepId: w.step.id,
    stepLabel: w.step.label,
    actor: w.actor,
    since: w.since ? toDateInput(w.since) : null,
    days: w.since ? daysWaiting(w.since, today) : null,
  };
}

/**
 * The waiting state from a serialized `BookingProgressView` (dates as
 * yyyy-mm-dd) against the workflow it follows — what the client controls use.
 * `doneIds` overrides the completions (optimistic ticks); a tick not yet in
 * `progress` is dated `today`.
 */
export function waitingFromView<S extends WorkflowStepLike>(
  steps: S[],
  progress: Pick<BookingProgressView, "status" | "completions" | "openedOn">,
  today: Date,
  doneIds?: Set<string>,
): WaitingState<S> | null {
  const dated = new Map(
    progress.completions.map((c) => [c.stepId, parseDateInput(c.completedOn) ?? today]),
  );
  const ids = doneIds ?? new Set(dated.keys());
  const completions = [...ids].map((stepId) => ({
    stepId,
    completedOn: dated.get(stepId) ?? today,
  }));
  return waitingOn(steps, completions, progress.status, parseDateInput(progress.openedOn));
}

/** A booking's workflow state as the control needs it (client-safe). */
export type BookingProgressView = {
  // False for a venue engagement not created yet — the first touch creates it.
  exists: boolean;
  status: BookingStatus;
  stageLabel: string | null;
  stageOn: string | null; // "yyyy-mm-dd"
  workflowId: string | null;
  completions: { stepId: string; completedOn: string }[];
  // bookedOn ?? createdAt ("yyyy-mm-dd") — how long the ball has sat with
  // someone when no step is ticked yet. Null for a not-yet-created engagement.
  openedOn?: string | null;
  // The venue's default workflow (seeds a not-yet-created engagement).
  locationDefaultWorkflowId?: string | null;
};

/** Prisma booking → BookingProgressView fields (dates as yyyy-mm-dd). */
export function progressView(
  b: {
    status: BookingStatus;
    stageLabel: string | null;
    stageOn: Date | null;
    workflowId: string | null;
    stepCompletions?: { stepId: string; completedOn: Date }[];
    bookedOn?: Date | null;
    createdAt?: Date | null;
  } | null,
  locationDefaultWorkflowId?: string | null,
): BookingProgressView {
  return {
    exists: b != null,
    status: b?.status ?? "PLANNED",
    stageLabel: b?.stageLabel ?? null,
    stageOn: b?.stageOn ? toDateInput(b.stageOn) : null,
    workflowId: b?.workflowId ?? null,
    completions: (b?.stepCompletions ?? []).map((c) => ({
      stepId: c.stepId,
      completedOn: toDateInput(c.completedOn),
    })),
    openedOn: b?.bookedOn
      ? toDateInput(b.bookedOn)
      : b?.createdAt
        ? toDateInput(b.createdAt)
        : null,
    locationDefaultWorkflowId: locationDefaultWorkflowId ?? null,
  };
}


/** Prisma select fragment every query feeding a status control spreads. */
export const BOOKING_PROGRESS_SELECT = {
  status: true,
  stageLabel: true,
  stageOn: true,
  workflowId: true,
  stepCompletions: { select: { stepId: true, completedOn: true } },
  bookedOn: true,
  createdAt: true,
} as const;

/** Prisma select for a workflow's steps as the resolver needs them. */
export const WORKFLOW_STEP_SELECT = {
  id: true,
  label: true,
  sortOrder: true,
  status: true,
  actor: true,
} as const;
