"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import {
  bookingWorkflowSchema,
  type BookingWorkflowInput,
} from "@/lib/validators/booking-workflow";
import { recomputeWorkflowBookings } from "@/lib/booking-workflow-sync";

// Workflow DEFINITIONS are admin-managed; moving a booking through one is a
// PLANNER action (trips/actions.ts). Every booking pill reads the workflow, so
// revalidate the whole app layout rather than guess which pages show one.
function revalidateAll() {
  revalidatePath("/", "layout");
}

export async function createWorkflow(name: string): Promise<FormState> {
  await assertRole("ADMIN");
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required." };
  const count = await prisma.bookingWorkflow.count();
  await prisma.bookingWorkflow.create({
    // The first workflow becomes the default so new bookings pick it up.
    data: { name: trimmed, sortOrder: count, isDefault: count === 0 },
  });
  revalidateAll();
  return { ok: true, message: `Created ${trimmed}.` };
}

export async function saveWorkflow(
  id: string,
  input: BookingWorkflowInput,
): Promise<FormState> {
  await assertRole("ADMIN");
  const parsed = bookingWorkflowSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const { name, isDefault, steps } = parsed.data;

  const existing = await prisma.bookingWorkflow.findUnique({
    where: { id },
    select: { steps: { select: { id: true } } },
  });
  if (!existing) return { error: "Workflow not found." };
  const own = new Set(existing.steps.map((s) => s.id));
  if (steps.some((s) => s.id && !own.has(s.id))) {
    return { error: "Workflow out of date. Reload and try again." };
  }
  const kept = new Set(steps.flatMap((s) => (s.id ? [s.id] : [])));

  await prisma.$transaction(async (tx) => {
    // At most one global default.
    if (isDefault) {
      await tx.bookingWorkflow.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    await tx.bookingWorkflow.update({ where: { id }, data: { name, isDefault } });
    // Dropped steps take their completions with them (cascade).
    await tx.bookingWorkflowStep.deleteMany({
      where: { workflowId: id, id: { notIn: [...kept] } },
    });
    for (const [i, s] of steps.entries()) {
      const data = { label: s.label, status: s.status, actor: s.actor, sortOrder: i };
      if (s.id) {
        await tx.bookingWorkflowStep.update({ where: { id: s.id }, data });
      } else {
        await tx.bookingWorkflowStep.create({ data: { ...data, workflowId: id } });
      }
    }
    await recomputeWorkflowBookings(id, tx);
  });

  revalidateAll();
  return { ok: true, message: "Saved." };
}

// Bookings on a deleted workflow keep their current status and drop to hand-set
// status (the FK is SetNull); their stage goes with the steps.
export async function deleteWorkflow(id: string): Promise<FormState> {
  await assertRole("ADMIN");
  await prisma.$transaction(async (tx) => {
    const bookings = await tx.booking.findMany({
      where: { workflowId: id },
      select: { id: true },
    });
    await tx.bookingWorkflow.delete({ where: { id } });
    await tx.booking.updateMany({
      where: { id: { in: bookings.map((b) => b.id) } },
      data: { stageLabel: null, stageOn: null },
    });
  });
  revalidateAll();
  return { ok: true, message: "Workflow deleted." };
}
