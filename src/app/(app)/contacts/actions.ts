"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { contactSchema, type ContactInput } from "@/lib/validators/contact";

function parse(formData: FormData) {
  return contactSchema.safeParse({
    name: formData.get("name"),
    organization: formData.get("organization") || undefined,
    role: formData.get("role") || undefined,
    email: formData.get("email") ?? "",
    phone: formData.get("phone") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

function toData(d: ContactInput) {
  return {
    name: d.name,
    organization: d.organization || null,
    role: d.role || null,
    email: d.email || null,
    phone: d.phone || null,
    notes: d.notes || null,
  };
}

export async function createContact(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = parse(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  // Optionally link to a location when created from a location page.
  const locationId = formData.get("locationId");
  await prisma.contact.create({
    data: {
      ...toData(parsed.data),
      ...(typeof locationId === "string" && locationId
        ? { locations: { connect: { id: locationId } } }
        : {}),
    },
  });

  revalidatePath("/contacts");
  if (typeof locationId === "string" && locationId) revalidatePath(`/locations/${locationId}`);
  return { ok: true, message: `Added ${parsed.data.name}.` };
}

export async function updateContact(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing contact." };

  const parsed = parse(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.contact.update({ where: { id }, data: toData(parsed.data) });
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
  return { ok: true, message: "Saved." };
}

export async function deleteContact(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // m2m location links drop; bookings' bookedContactId and items' presenterContactId
  // are set null automatically (schema onDelete: SetNull).
  await prisma.contact.delete({ where: { id } });
  revalidatePath("/contacts");
  redirect("/contacts");
}
