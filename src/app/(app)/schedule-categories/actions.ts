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
      return { error: "Name already in use." };
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

  const existing = await prisma.scheduleItemCategory.findUnique({
    where: { id },
    select: { system: true },
  });
  if (existing?.system) {
    return { error: "Built-in categories can't be edited." };
  }

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
      return { error: "Name already in use." };
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
  // Built-ins (Free time / Break) are protected from deletion.
  const existing = await prisma.scheduleItemCategory.findUnique({
    where: { id },
    select: { system: true },
  });
  if (existing?.system) return;
  // Items keep their other fields; their categoryId is set null (schema onDelete).
  await prisma.scheduleItemCategory.delete({ where: { id } });
  revalidatePath("/schedule-categories");
}

// Manual override: persist an explicit order (sortOrder 1..n).
export async function reorderCategories(
  orderedIds: string[],
): Promise<FormState> {
  await assertRole("ADMIN");
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.scheduleItemCategory.update({
        where: { id },
        data: { sortOrder: i + 1 },
      }),
    ),
  );
  revalidatePath("/schedule-categories");
  return { ok: true };
}

// Reset to alphabetical order (renumbers sortOrder by name).
export async function sortCategoriesAlphabetically(): Promise<FormState> {
  await assertRole("ADMIN");
  const cats = await prisma.scheduleItemCategory.findMany({
    orderBy: { name: "asc" },
    select: { id: true },
  });
  await prisma.$transaction(
    cats.map((c, i) =>
      prisma.scheduleItemCategory.update({
        where: { id: c.id },
        data: { sortOrder: i + 1 },
      }),
    ),
  );
  revalidatePath("/schedule-categories");
  return { ok: true, message: "Sorted A–Z." };
}
