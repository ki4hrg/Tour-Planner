import type { BookingStatus } from "@prisma/client";
import { toDateInput } from "./dates";

// Booking workflows (admin-defined milestone ladders) → a booking's coarse
// status + stage. Pure, so the server sync layer (booking-workflow-sync.ts) and
// the client control resolve progress the same way.
//
// A step names the coarse status a booking reaches once it is done; the
// booking's status is the furthest any completed step reaches. Steps are
// sequential: a step can be done only once every step before it is
// (stepGate), and undone only while no later step is — a venue that skips a
// step belongs on a workflow without it. The stage is the latest step done.

export const BOOKING_STATUS_RANK: Record<BookingStatus, number> = {
  NOT_NEEDED: 0,
  PLANNED: 1,
  IN_PROGRESS: 2,
  CONFIRMED: 3,
};

/** The coarse statuses a workflow step may reach (DB CHECK booking_workflow_step_status). */
export const STEP_STATUSES = ["IN_PROGRESS", "CONFIRMED"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export type WorkflowStepLike = {
  id: string;
  label: string;
  sortOrder: number;
  status: BookingStatus;
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
} as const;
