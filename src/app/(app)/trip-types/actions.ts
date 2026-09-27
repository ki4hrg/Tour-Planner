"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { tripTypeSchema } from "@/lib/validators/tripType";

function parse(formData: FormData) {
  return tripTypeSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    color: formData.get("color") || undefined,
    defaultCurrency: formData.get("defaultCurrency"),
  });
}

export async function createTripType(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("ADMIN");
  const parsed = parse(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const { name, description, color, defaultCurrency } = parsed.data;
  try {
    await prisma.tripType.create({
      data: {
        name,
        description: description || null,
        color: color || null,
        defaultCurrency,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "Name already in use." };
    }
    throw e;
  }

  revalidatePath("/trip-types");
  return { ok: true, message: `Created ${name}.` };
}

export async function updateTripType(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing trip type." };

  const parsed = parse(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const { name, description, color, defaultCurrency } = parsed.data;
  try {
    await prisma.tripType.update({
      where: { id },
      data: {
        name,
        description: description || null,
        color: color || null,
        defaultCurrency,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "Name already in use." };
    }
    throw e;
  }

  revalidatePath("/trip-types");
  revalidatePath(`/trip-types/${id}`);
  return { ok: true, message: "Saved." };
}

export async function deleteTripType(formData: FormData): Promise<void> {
  await assertRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const tripCount = await prisma.trip.count({ where: { tripTypeId: id } });
  if (tripCount > 0) {
    // Trips require a trip type — block deletion while any reference it.
    throw new Error(
      `Cannot delete: in use by ${tripCount} trip(s).`,
    );
  }

  await prisma.tripType.delete({ where: { id } });
  revalidatePath("/trip-types");
  redirect("/trip-types");
}
