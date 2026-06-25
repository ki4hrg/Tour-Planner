"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { siteSchema, type SiteInput } from "@/lib/validators/site";
import { costSchema, type CostInput } from "@/lib/validators/cost";

function parseSite(formData: FormData) {
  return siteSchema.safeParse({
    name: formData.get("name"),
    region: formData.get("region") || undefined,
    address: formData.get("address") || undefined,
    description: formData.get("description") || undefined,
    notes: formData.get("notes") || undefined,
    website: formData.get("website") ?? "",
    mapUrl: formData.get("mapUrl") ?? "",
    bookingOpensLeadDays: formData.get("bookingOpensLeadDays") ?? "",
    bookingNotes: formData.get("bookingNotes") || undefined,
    scheduleLimitations: formData.get("scheduleLimitations") || undefined,
    tripTypeIds: formData.getAll("tripTypeIds").map(String),
  });
}

function toSiteData(d: SiteInput) {
  return {
    name: d.name,
    region: d.region || null,
    address: d.address || null,
    description: d.description || null,
    notes: d.notes || null,
    website: d.website || null,
    mapUrl: d.mapUrl || null,
    bookingOpensLeadDays: d.bookingOpensLeadDays ?? null,
    bookingNotes: d.bookingNotes || null,
    scheduleLimitations: d.scheduleLimitations || null,
  };
}

export async function createSite(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = parseSite(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const site = await prisma.site.create({
    data: {
      ...toSiteData(parsed.data),
      tripTypes: {
        connect: (parsed.data.tripTypeIds ?? []).map((id) => ({ id })),
      },
    },
  });

  revalidatePath("/sites");
  redirect(`/sites/${site.id}`);
}

export async function updateSite(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing site." };

  const parsed = parseSite(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.site.update({
    where: { id },
    data: {
      ...toSiteData(parsed.data),
      tripTypes: {
        set: (parsed.data.tripTypeIds ?? []).map((tid) => ({ id: tid })),
      },
    },
  });

  revalidatePath("/sites");
  revalidatePath(`/sites/${id}`);
  return { ok: true, message: "Saved." };
}

export async function deleteSite(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Archive if any itinerary stop references this site (preserve trip history);
  // hard-delete only when unreferenced.
  const stopCount = await prisma.stop.count({ where: { siteId: id } });
  if (stopCount > 0) {
    await prisma.site.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    revalidatePath("/sites");
    revalidatePath(`/sites/${id}`);
    return;
  }

  await prisma.site.delete({ where: { id } });
  revalidatePath("/sites");
  redirect("/sites");
}

export async function unarchiveSite(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.site.update({ where: { id }, data: { archivedAt: null } });
  revalidatePath("/sites");
  revalidatePath(`/sites/${id}`);
}

// --- Costs (nested under a site) ---

function parseCost(formData: FormData) {
  return costSchema.safeParse({
    label: formData.get("label"),
    amount: formData.get("amount"),
    currency: formData.get("currency"),
    unit: formData.get("unit"),
    confirmedAt: formData.get("confirmedAt") ?? "",
    notes: formData.get("notes") || undefined,
  });
}

function toCostData(d: CostInput) {
  return {
    label: d.label,
    amount: d.amount,
    currency: d.currency,
    unit: d.unit,
    confirmedAt: d.confirmedAt ? new Date(d.confirmedAt) : null,
    notes: d.notes || null,
  };
}

export async function addCost(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const siteId = String(formData.get("siteId") ?? "");
  if (!siteId) return { error: "Missing site." };

  const parsed = parseCost(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.cost.create({ data: { siteId, ...toCostData(parsed.data) } });
  revalidatePath(`/sites/${siteId}`);
  return { ok: true, message: "Cost added." };
}

export async function updateCost(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  if (!id) return { error: "Missing cost." };

  const parsed = parseCost(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.cost.update({ where: { id }, data: toCostData(parsed.data) });
  if (siteId) revalidatePath(`/sites/${siteId}`);
  return { ok: true, message: "Cost saved." };
}

export async function deleteCost(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  if (!id) return;
  await prisma.cost.delete({ where: { id } });
  if (siteId) revalidatePath(`/sites/${siteId}`);
}

// --- Site ⇄ Contact links ---

export async function linkContactToSite(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const siteId = String(formData.get("siteId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!siteId || !contactId) return;
  await prisma.site.update({
    where: { id: siteId },
    data: { contacts: { connect: { id: contactId } } },
  });
  revalidatePath(`/sites/${siteId}`);
}

export async function unlinkContactFromSite(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const siteId = String(formData.get("siteId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!siteId || !contactId) return;
  await prisma.site.update({
    where: { id: siteId },
    data: { contacts: { disconnect: { id: contactId } } },
  });
  revalidatePath(`/sites/${siteId}`);
}
