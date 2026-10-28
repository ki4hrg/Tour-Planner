import type { BookingStatus, PaymentOffsetUnit, StepActor } from "@prisma/client";
import { parseDateInput, toDateInput } from "./dates";
import { addUnits } from "./payment-schedule";
import { isBookingOff } from "./booking";

// Booking workflows (admin-defined milestone ladders) → a booking's coarse
// status + stage. Pure, so the server sync layer (booking-workflow-sync.ts) and
// the client control resolve progress the same way.
//
// A step names the coarse status a booking reaches once it is done; the
// booking's status is the furthest any completed step reaches. Steps are
// sequential: a step can be done only once every step before it is
// (stepGate), and undone only while no later step is — a venue that skips a
// step belongs on a workflow without it. The stage is the latest step done.

// How far up the master-status ladder a booking is. The off-ladder overrides
// rank lowest, so a merge keeps a booking that is actually in play.
export const BOOKING_STATUS_RANK: Record<BookingStatus, number> = {
  NOT_NEEDED: 0,
  CANCELLED: 0,
  PENDING: 1,
  IN_PROGRESS: 2,
  CONFIRMED: 3,
  FINALIZED: 4,
};

/** The master statuses a workflow step may reach (DB CHECK booking_workflow_step_status). */
export const STEP_STATUSES = ["IN_PROGRESS", "CONFIRMED", "FINALIZED"] as const;
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
  // When the step falls due: this many units BEFORE the trip's start date
  // (both or neither). Unset = due as soon as it is the upcoming step.
  dueOffsetValue?: number | null;
  dueOffsetUnit?: PaymentOffsetUnit | null;
};

/** The offset units a step's due date can be measured in. */
export const STEP_DUE_UNITS = ["DAY", "WEEK", "MONTH"] as const satisfies readonly PaymentOffsetUnit[];

/**
 * The date a step falls due on a trip — `dueOffsetValue` `dueOffsetUnit`s
 * before the trip's start. Null when the step has no offset (due whenever
 * it's next) or the trip has no start date yet (a template).
 */
export function stepDueDate(
  step: Pick<WorkflowStepLike, "dueOffsetValue" | "dueOffsetUnit">,
  tripStartDate: Date | null | undefined,
): Date | null {
  if (step.dueOffsetValue == null || !step.dueOffsetUnit || !tripStartDate) return null;
  return addUnits(tripStartDate, -step.dueOffsetValue, step.dueOffsetUnit);
}

/** "2 months before start" / "on start day" — the rule, for the admin UI. */
export function describeStepDue(step: {
  dueOffsetValue: number | null;
  dueOffsetUnit: PaymentOffsetUnit | null;
}): string | null {
  if (step.dueOffsetValue == null || !step.dueOffsetUnit) return null;
  const n = step.dueOffsetValue;
  if (n === 0) return "on start day";
  const unit = `${step.dueOffsetUnit.toLowerCase()}${Math.abs(n) === 1 ? "" : "s"}`;
  return n > 0 ? `${n} ${unit} before start` : `${-n} ${unit} after start`;
}

export type StepCompletionLike = { stepId: string; completedOn: Date };

export type BookingProgress = {
  status: BookingStatus;
  stageLabel: string | null;
  stageOn: Date | null;
};

/**
 * Resolve a workflow booking's stored status + stage from its completions.
 * `current` is the stored status: CANCELLED and NOT_NEEDED are manual
 * overrides that step changes never clear (the stage still tracks, so
 * reinstating the booking restores it).
 * Completions whose step isn't in `steps` (a stale row from another workflow)
 * are ignored.
 */
export function resolveBookingProgress(
  steps: WorkflowStepLike[],
  completions: StepCompletionLike[],
  current: BookingStatus,
): BookingProgress {
  const doneOn = new Map(completions.map((c) => [c.stepId, c.completedOn]));
  let status: BookingStatus = "PENDING";
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
    status: isBookingOff(current) ? current : status,
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
 * booking is cancelled / not needed or its last step is done.
 */
export function upcomingStep<S extends WorkflowStepLike>(
  steps: S[],
  completions: { stepId: string }[],
  status: BookingStatus,
): S | null {
  if (isBookingOff(status)) return null;
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
 * it, since when the ball has sat there — the latest tick on the booking,
 * else `opened` (the booking's bookedOn ?? createdAt; null for an engagement
 * not created yet) — and when the step falls due (`stepDueDate`; null = now).
 * Null when nothing is pending.
 */
export type WaitingState<S extends WorkflowStepLike = WorkflowStepLike> = {
  step: S;
  actor: StepActor;
  since: Date | null;
  dueOn: Date | null;
};

export function waitingOn<S extends WorkflowStepLike>(
  steps: S[],
  completions: StepCompletionLike[],
  status: BookingStatus,
  opened: Date | null,
  tripStartDate: Date | null = null,
): WaitingState<S> | null {
  const step = upcomingStep(steps, completions, status);
  if (!step) return null;
  const ids = new Set(steps.map((s) => s.id));
  let since: Date | null = null;
  for (const c of completions) {
    if (!ids.has(c.stepId)) continue;
    if (!since || c.completedOn.getTime() > since.getTime()) since = c.completedOn;
  }
  return {
    step,
    actor: step.actor ?? "US",
    since: since ?? opened,
    dueOn: stepDueDate(step, tripStartDate),
  };
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
  // When the step falls due ("yyyy-mm-dd"; null = no set date) and whether
  // that is now. A step not yet due is nobody's move yet: "Finalized" on a
  // trip two years out is information, not a to-do.
  dueOn: string | null;
  due: boolean;
};

export function waitingView(w: WaitingState | null, today: Date): WaitingView | null {
  if (!w) return null;
  return {
    stepId: w.step.id,
    stepLabel: w.step.label,
    actor: w.actor,
    since: w.since ? toDateInput(w.since) : null,
    days: w.since ? daysWaiting(w.since, today) : null,
    dueOn: w.dueOn ? toDateInput(w.dueOn) : null,
    due: w.dueOn == null || w.dueOn.getTime() <= today.getTime(),
  };
}

/** Whether a waiting state is due as of `today` (no date = due now). */
export function isDue(w: { dueOn: Date | null } | null, today: Date): boolean {
  return w == null || w.dueOn == null || w.dueOn.getTime() <= today.getTime();
}

/**
 * The waiting state from a serialized `BookingProgressView` (dates as
 * yyyy-mm-dd) against the workflow it follows — what the client controls use.
 * `doneIds` overrides the completions (optimistic ticks); a tick not yet in
 * `progress` is dated `today`.
 */
export function waitingFromView<S extends WorkflowStepLike>(
  steps: S[],
  progress: Pick<
    BookingProgressView,
    "status" | "completions" | "openedOn" | "tripStartDate"
  >,
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
  return waitingOn(
    steps,
    completions,
    progress.status,
    parseDateInput(progress.openedOn),
    parseDateInput(progress.tripStartDate ?? null),
  );
}

export type StepGate = { canComplete: boolean; canUndo: boolean };

/**
 * What each step allows given the steps already done: complete = not done and
 * every earlier step done (the prerequisites); undo = done and no later step
 * done (undo from the top down). Re-dating a done step is always allowed.
 */
export function stepGate<S extends { id: string; sortOrder: number }>(
  steps: S[],
  done: ReadonlySet<string>,
): Map<string, StepGate> {
  const ordered = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
  const gate = new Map<string, StepGate>();
  ordered.forEach((s, i) => {
    const isDone = done.has(s.id);
    gate.set(s.id, {
      canComplete: !isDone && ordered.slice(0, i).every((p) => done.has(p.id)),
      canUndo: isDone && ordered.slice(i + 1).every((n) => !done.has(n.id)),
    });
  });
  return gate;
}

/** Why a step can't be set — null when it can (client + server share it). */
export function stepGateError<S extends { id: string; label: string; sortOrder: number }>(
  steps: S[],
  done: ReadonlySet<string>,
  stepId: string,
  markDone: boolean,
): string | null {
  const ordered = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
  const i = ordered.findIndex((s) => s.id === stepId);
  if (i < 0) return "That step isn't part of this booking's workflow.";
  if (markDone) {
    if (done.has(stepId)) return null; // re-dating
    const open = ordered.slice(0, i).find((p) => !done.has(p.id));
    return open ? `"${open.label}" isn't done yet.` : null;
  }
  const later = ordered.slice(i + 1).findLast((n) => done.has(n.id));
  return later ? `"${later.label}" is done — undo it first.` : null;
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
  // The trip's start date ("yyyy-mm-dd"), which step due offsets count back
  // from; null/absent (a template) leaves every step due whenever it's next.
  tripStartDate?: string | null;
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
  tripStartDate?: Date | null,
): BookingProgressView {
  return {
    exists: b != null,
    status: b?.status ?? "PENDING",
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
    tripStartDate: tripStartDate ? toDateInput(tripStartDate) : null,
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
  dueOffsetValue: true,
  dueOffsetUnit: true,
} as const;
