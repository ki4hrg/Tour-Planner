"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { scheduleItemCategorySchema } from "@/lib/validators/scheduleItemCategory";

function parse(formData: FormData) {
  return scheduleItemCategorySchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color") || undefined,
    sortOrder: formData.get("sortOrder") ?? "",
  });
}

export async function createCategory(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("ADMIN");
  const parsed = parse(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const { name, color, sortOrder } = parsed.data;
  try {
    await prisma.scheduleItemCategory.create({
      data: { name, color: color || null, sortOrder: sortOrder ?? 0 },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "A category with that name already exists." };
    }
    throw e;
  }

  revalidatePath("/schedule-categories");
  return { ok: true, message: `Created ${name}.` };
}

export async function updateCategory(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing category." };

  const parsed = parse(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const { name, color, sortOrder } = parsed.data;
  try {
    await prisma.scheduleItemCategory.update({
      where: { id },
      data: { name, color: color || null, sortOrder: sortOrder ?? 0 },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "A category with that name already exists." };
    }
    throw e;
  }

  revalidatePath("/schedule-categories");
  return { ok: true, message: "Saved." };
}

export async function deleteCategory(formData: FormData): Promise<void> {
  await assertRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Items keep their other fields; their categoryId is set null (schema onDelete).
  await prisma.scheduleItemCategory.delete({ where: { id } });
  revalidatePath("/schedule-categories");
}
