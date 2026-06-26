"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { presentationSchema, type PresentationInput } from "@/lib/validators/presentation";

function parse(formData: FormData) {
  return presentationSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    notes: formData.get("notes") || undefined,
    durationMinutes: formData.get("durationMinutes") ?? "",
    defaultPresenterIds: formData.getAll("defaultPresenterIds").map(String),
  });
}

function toData(d: PresentationInput) {
  return {
    title: d.title,
    description: d.description || null,
    notes: d.notes || null,
    durationMinutes: d.durationMinutes ?? null,
  };
}

export async function createPresentation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = parse(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const presentation = await prisma.presentation.create({
    data: {
      ...toData(parsed.data),
      defaultPresenters: {
        connect: (parsed.data.defaultPresenterIds ?? []).map((id) => ({ id })),
      },
    },
  });

  revalidatePath("/presentations");
  redirect(`/presentations/${presentation.id}`);
}

export async function updatePresentation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing presentation." };

  const parsed = parse(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.presentation.update({
    where: { id },
    data: {
      ...toData(parsed.data),
      defaultPresenters: {
        set: (parsed.data.defaultPresenterIds ?? []).map((pid) => ({ id: pid })),
      },
    },
  });

  revalidatePath("/presentations");
  revalidatePath(`/presentations/${id}`);
  return { ok: true, message: "Saved." };
}

export async function deletePresentation(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Archive if any ScheduleItem references this presentation (preserve trip history);
  // hard-delete only when unreferenced.
  const refCount = await prisma.scheduleItem.count({
    where: { presentationId: id },
  });
  if (refCount > 0) {
    await prisma.presentation.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    revalidatePath("/presentations");
    revalidatePath(`/presentations/${id}`);
    return;
  }

  await prisma.presentation.delete({ where: { id } });
  revalidatePath("/presentations");
  redirect("/presentations");
}

export async function unarchivePresentation(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.presentation.update({
    where: { id },
    data: { archivedAt: null },
  });
  revalidatePath("/presentations");
  revalidatePath(`/presentations/${id}`);
}
