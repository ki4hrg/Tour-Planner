"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { parseDateInput } from "@/lib/dates";
import { zodErrorMessage, type FormState } from "@/lib/forms";
import {
  noteSchema,
  type NoteInput,
  type NoteTarget,
} from "@/lib/validators/note";

// Map a polymorphic target to its FK column.
function targetColumn(target: NoteTarget): "locationId" | "bookingId" | "tripId" | "stayId" {
  return `${target}Id` as const;
}

// Revalidate the page(s) that show a note, given its target.
async function revalidateForTarget(
  target: NoteTarget,
  targetId: string,
): Promise<void> {
  if (target === "location") {
    revalidatePath(`/locations/${targetId}`);
    return;
  }
  if (target === "trip") {
    revalidatePath(`/trips/${targetId}`);
    revalidatePath(`/trips/${targetId}/booking`);
    return;
  }
  // booking | stay — resolve the owning trip, then revalidate its booking page.
  let tripId: string | null | undefined;
  if (target === "stay") {
    tripId = (
      await prisma.stay.findUnique({
        where: { id: targetId },
        select: { tripId: true },
      })
    )?.tripId;
  } else {
    const b = await prisma.booking.findUnique({
      where: { id: targetId },
      select: {
        tripId: true,
        scheduleItem: { select: { day: { select: { tripId: true } } } },
      },
    });
    tripId = b?.tripId ?? b?.scheduleItem?.day.tripId;
  }
  if (tripId) revalidatePath(`/trips/${tripId}/booking`);
}

function toNoteScalars(d: NoteInput) {
  return {
    body: d.body,
    method: d.method,
    contactId: d.contactId || null,
    contactedOn: parseDateInput(d.contactedOn)!,
    followUp: d.followUp,
    dueDate: d.dueDate ? parseDateInput(d.dueDate) : null,
  };
}

export async function addNote(
  target: NoteTarget,
  targetId: string,
  input: NoteInput,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.note.create({
    data: {
      ...toNoteScalars(parsed.data),
      [targetColumn(target)]: targetId,
      createdById: user.id,
    },
  });

  await revalidateForTarget(target, targetId);
  return { ok: true, message: "Note added." };
}

export async function updateNote(
  noteId: string,
  input: NoteInput,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const note = await prisma.note.update({
    where: { id: noteId },
    data: toNoteScalars(parsed.data),
    select: { locationId: true, bookingId: true, tripId: true, stayId: true },
  });

  await revalidateAfterMutation(note);
  return { ok: true, message: "Note saved." };
}

export async function deleteNote(noteId: string): Promise<FormState> {
  await assertRole("PLANNER");
  const note = await prisma.note.delete({
    where: { id: noteId },
    select: { locationId: true, bookingId: true, tripId: true, stayId: true },
  });
  await revalidateAfterMutation(note);
  return { ok: true, message: "Note removed." };
}

// Resolve the target from a note's FK columns and revalidate.
async function revalidateAfterMutation(note: {
  locationId: string | null;
  bookingId: string | null;
  tripId: string | null;
  stayId: string | null;
}): Promise<void> {
  if (note.locationId) return revalidateForTarget("location", note.locationId);
  if (note.tripId) return revalidateForTarget("trip", note.tripId);
  if (note.bookingId) return revalidateForTarget("booking", note.bookingId);
  if (note.stayId) return revalidateForTarget("stay", note.stayId);
}
