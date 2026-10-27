// Prisma-aware booking-workflow mutations shared by the web Server Actions and
// the MCP tools. No revalidatePath (MCP-safe) and no auth — each caller checks
// its own role first.
//
// `Booking.status` / `stageLabel` / `stageOn` are stored, derived from the
// booking's step completions (resolveBookingProgress). Every write that changes
// what they read — a step ticked, a workflow switched, a workflow's steps
// edited — ends in a recompute here so the stored values can't drift.

import type { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  resolveBookingProgress,
  stepGateError,
  WORKFLOW_STEP_SELECT,
} from "@/lib/booking-workflow";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const STEPS_ORDER = { orderBy: { sortOrder: "asc" as const } };

/**
 * The workflow a NEW booking starts on: the venue's default, else the global
 * default. Spread into a booking create (`{}` when there is none).
 */
export async function seedWorkflowFor(
  locationId: string | null | undefined,
  db: Db = prisma,
): Promise<{ workflowId: string } | Record<string, never>> {
  if (locationId) {
    const loc = await db.location.findUnique({
      where: { id: locationId },
      select: { defaultWorkflowId: true },
    });
    if (loc?.defaultWorkflowId) return { workflowId: loc.defaultWorkflowId };
  }
  const global = await db.bookingWorkflow.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  return global ? { workflowId: global.id } : {};
}

/** Re-derive one booking's stored status + stage from its completions. */
export async function recomputeBooking(bookingId: string, db: Db = prisma) {
  const b = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      status: true,
      workflow: { select: { steps: STEPS_ORDER } },
      stepCompletions: { select: { stepId: true, completedOn: true } },
    },
  });
  if (!b) return;
  if (!b.workflow) {
    // Hand-set status stays; there is no stage without a workflow.
    await db.booking.update({
      where: { id: bookingId },
      data: { stageLabel: null, stageOn: null },
    });
    return;
  }
  const p = resolveBookingProgress(b.workflow.steps, b.stepCompletions, b.status);
  await db.booking.update({ where: { id: bookingId }, data: p });
}

/** Recompute every booking on a workflow (after its steps were edited). */
export async function recomputeWorkflowBookings(workflowId: string, db: Db = prisma) {
  const wf = await db.bookingWorkflow.findUnique({
    where: { id: workflowId },
    select: {
      steps: STEPS_ORDER,
      bookings: {
        select: {
          id: true,
          status: true,
          stageLabel: true,
          stageOn: true,
          stepCompletions: { select: { stepId: true, completedOn: true } },
        },
      },
    },
  });
  if (!wf) return;
  for (const b of wf.bookings) {
    const p = resolveBookingProgress(wf.steps, b.stepCompletions, b.status);
    if (
      p.status === b.status &&
      p.stageLabel === b.stageLabel &&
      p.stageOn?.getTime() === b.stageOn?.getTime()
    ) {
      continue;
    }
    await db.booking.update({ where: { id: b.id }, data: p });
  }
}

/**
 * Mark a step done (dated `completedOn`) or not done on a booking. The step
 * must belong to the booking's current workflow, and the order holds: done
 * needs every earlier step done, undone needs no later step done (stepGate).
 * Re-marking a done step just re-dates it.
 */
export async function setBookingStep(
  args: {
    bookingId: string;
    stepId: string;
    done: boolean;
    completedOn: Date;
    userId?: string | null;
  },
  db: Db = prisma,
): Promise<{ error: string } | { ok: true }> {
  const { bookingId, stepId, done, completedOn, userId } = args;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      workflow: { select: { steps: STEPS_ORDER } },
      stepCompletions: { select: { stepId: true } },
    },
  });
  if (!booking) return { error: "Booking not found." };
  if (!booking.workflow) return { error: "This booking has no workflow." };
  const blocked = stepGateError(
    booking.workflow.steps,
    new Set(booking.stepCompletions.map((c) => c.stepId)),
    stepId,
    done,
  );
  if (blocked) return { error: blocked };
  if (done) {
    await db.bookingStepCompletion.upsert({
      where: { bookingId_stepId: { bookingId, stepId } },
      create: { bookingId, stepId, completedOn, completedById: userId ?? null },
      update: { completedOn },
    });
  } else {
    await db.bookingStepCompletion.deleteMany({ where: { bookingId, stepId } });
  }
  await recomputeBooking(bookingId, db);
  return { ok: true };
}

/**
 * Switch a booking to another workflow (or to none). Completions belong to the
 * old workflow's steps, so they are cleared; status restarts at PLANNED unless
 * the booking is marked not needed. Switching to the workflow it already has
 * is a no-op.
 */
export async function setBookingWorkflow(
  bookingId: string,
  workflowId: string | null,
  db: Db = prisma,
): Promise<{ error: string } | { ok: true }> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { workflowId: true, status: true },
  });
  if (!booking) return { error: "Booking not found." };
  if (booking.workflowId === workflowId) return { ok: true };
  if (workflowId) {
    const wf = await db.bookingWorkflow.findUnique({
      where: { id: workflowId },
      select: { id: true },
    });
    if (!wf) return { error: "Workflow not found." };
  }
  await db.bookingStepCompletion.deleteMany({ where: { bookingId } });
  await db.booking.update({
    where: { id: bookingId },
    data: {
      workflowId,
      // Without a workflow the planner sets status by hand — keep what it was.
      ...(workflowId && booking.status !== "NOT_NEEDED" ? { status: "PLANNED" } : {}),
    },
  });
  await recomputeBooking(bookingId, db);
  return { ok: true };
}

/**
 * Set a booking's status directly. On a workflow booking only NOT_NEEDED (and
 * leaving it) is manual — any other value re-derives from the steps; without a
 * workflow the given status is stored as-is.
 */
export async function setBookingStatusDirect(
  bookingId: string,
  status: BookingStatus,
  db: Db = prisma,
): Promise<{ error: string } | { ok: true }> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { workflowId: true },
  });
  if (!booking) return { error: "Booking not found." };
  if (status === "NOT_NEEDED" || !booking.workflowId) {
    await db.booking.update({ where: { id: bookingId }, data: { status } });
  } else {
    // Clear the override, then let the steps decide.
    await db.booking.update({ where: { id: bookingId }, data: { status: "PLANNED" } });
    await recomputeBooking(bookingId, db);
  }
  return { ok: true };
}

/**
 * Move a booking to a stage in one go (the board's drag between step
 * columns): `stepId` and every step before it are done — steps already done
 * keep their dates, the rest are dated `completedOn` — and every LATER step is
 * cleared. `stepId: null` clears them all ("not started"). Moving a not-needed
 * booking onto a stage puts it back in play.
 */
export async function setBookingStage(
  args: { bookingId: string; stepId: string | null; completedOn: Date; userId?: string | null },
  db: Db = prisma,
): Promise<{ error: string } | { ok: true }> {
  const { bookingId, stepId, completedOn, userId } = args;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { status: true, workflow: { select: { steps: STEPS_ORDER } } },
  });
  if (!booking) return { error: "Booking not found." };
  if (!booking.workflow) return { error: "This booking has no workflow." };
  const steps = booking.workflow.steps;
  const at = stepId == null ? -1 : steps.findIndex((s) => s.id === stepId);
  if (stepId != null && at < 0) {
    return { error: "That step isn't part of this booking's workflow." };
  }
  await db.bookingStepCompletion.deleteMany({
    where: { bookingId, stepId: { in: steps.slice(at + 1).map((s) => s.id) } },
  });
  if (at >= 0) {
    await db.bookingStepCompletion.createMany({
      data: steps.slice(0, at + 1).map((s) => ({
        bookingId,
        stepId: s.id,
        completedOn,
        completedById: userId ?? null,
      })),
      skipDuplicates: true, // @@unique([bookingId, stepId]) keeps existing dates
    });
  }
  if (booking.status === "NOT_NEEDED") {
    await db.booking.update({ where: { id: bookingId }, data: { status: "PLANNED" } });
  }
  await recomputeBooking(bookingId, db);
  return { ok: true };
}

/**
 * The workflow catalog with each step's owner — what `buildDashboardRows`
 * (`workflows`) and the MCP tools resolve "whose move" against.
 */
export function loadWorkflowCatalog(db: Db = prisma) {
  return db.bookingWorkflow.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      isDefault: true,
      steps: { ...STEPS_ORDER, select: WORKFLOW_STEP_SELECT },
    },
  });
}
