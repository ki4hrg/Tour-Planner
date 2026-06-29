"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { locationSchema, type LocationInput } from "@/lib/validators/location";
import { costSchema, type CostInput } from "@/lib/validators/cost";
import { hostSiteSchema } from "@/lib/validators/hostSite";

function parseLocation(formData: FormData) {
  return locationSchema.safeParse({
    name: formData.get("name"),
    regionId: formData.get("regionId") || undefined,
    address: formData.get("address") || undefined,
    description: formData.get("description") || undefined,
    notes: formData.get("notes") || undefined,
    website: formData.get("website") ?? "",
    mapUrl: formData.get("mapUrl") ?? "",
    bookable: formData.get("bookable") != null,
    bookingOpensLeadDays: formData.get("bookingOpensLeadDays") ?? "",
    bookingNotes: formData.get("bookingNotes") || undefined,
    scheduleLimitations: formData.get("scheduleLimitations") || undefined,
    tripTypeIds: formData.getAll("tripTypeIds").map(String),
  });
}

function toLocationData(d: LocationInput) {
  return {
    name: d.name,
    address: d.address || null,
    description: d.description || null,
    notes: d.notes || null,
    website: d.website || null,
    mapUrl: d.mapUrl || null,
    bookable: d.bookable,
    bookingOpensLeadDays: d.bookingOpensLeadDays ?? null,
    bookingNotes: d.bookingNotes || null,
    scheduleLimitations: d.scheduleLimitations || null,
  };
}

export async function createLocation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = parseLocation(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const location = await prisma.location.create({
    data: {
      ...toLocationData(parsed.data),
      ...(parsed.data.regionId
        ? { region: { connect: { id: parsed.data.regionId } } }
        : {}),
      tripTypes: {
        connect: (parsed.data.tripTypeIds ?? []).map((id) => ({ id })),
      },
    },
  });

  revalidatePath("/locations");
  redirect(`/locations/${location.id}`);
}

export async function updateLocation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing location." };

  const parsed = parseLocation(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.location.update({
    where: { id },
    data: {
      ...toLocationData(parsed.data),
      region: parsed.data.regionId
        ? { connect: { id: parsed.data.regionId } }
        : { disconnect: true },
      tripTypes: {
        set: (parsed.data.tripTypeIds ?? []).map((tid) => ({ id: tid })),
      },
    },
  });

  revalidatePath("/locations");
  revalidatePath(`/locations/${id}`);
  return { ok: true, message: "Saved." };
}

export async function deleteLocation(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Archive if any itinerary item references this location (preserve trip history);
  // hard-delete only when unreferenced.
  const refCount = await prisma.scheduleItemSite.count({
    where: { locationId: id },
  });
  if (refCount > 0) {
    await prisma.location.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    revalidatePath("/locations");
    revalidatePath(`/locations/${id}`);
    return;
  }

  await prisma.location.delete({ where: { id } });
  revalidatePath("/locations");
  redirect("/locations");
}

export async function unarchiveLocation(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.location.update({ where: { id }, data: { archivedAt: null } });
  revalidatePath("/locations");
  revalidatePath(`/locations/${id}`);
}

// --- Costs (nested under a location) ---

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
  const locationId = String(formData.get("locationId") ?? "");
  if (!locationId) return { error: "Missing location." };

  const parsed = parseCost(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.cost.create({ data: { locationId, ...toCostData(parsed.data) } });
  revalidatePath(`/locations/${locationId}`);
  return { ok: true, message: "Cost added." };
}

export async function updateCost(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  if (!id) return { error: "Missing cost." };

  const parsed = parseCost(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.cost.update({ where: { id }, data: toCostData(parsed.data) });
  if (locationId) revalidatePath(`/locations/${locationId}`);
  return { ok: true, message: "Cost saved." };
}

export async function deleteCost(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  if (!id) return;
  await prisma.cost.delete({ where: { id } });
  if (locationId) revalidatePath(`/locations/${locationId}`);
}

// --- Location ⇄ Contact links ---

export async function linkContactToLocation(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const locationId = String(formData.get("locationId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!locationId || !contactId) return;
  await prisma.location.update({
    where: { id: locationId },
    data: { contacts: { connect: { id: contactId } } },
  });
  revalidatePath(`/locations/${locationId}`);
}

export async function unlinkContactFromLocation(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const locationId = String(formData.get("locationId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!locationId || !contactId) return;
  await prisma.location.update({
    where: { id: locationId },
    data: { contacts: { disconnect: { id: contactId } } },
  });
  revalidatePath(`/locations/${locationId}`);
}

// --- Host Site ---

export async function markAsHostSite(locationId: string): Promise<FormState> {
  await assertRole("PLANNER");
  if (!locationId) return { error: "Missing location." };

  await prisma.hostSite.upsert({
    where: { locationId },
    update: {},
    create: {
      locationId,
      providesLodging: false,
      providesMeals: false,
      providesMeetingSpace: false,
    },
  });

  revalidatePath("/locations");
  revalidatePath(`/locations/${locationId}`);
  return { ok: true, message: "Marked as host site." };
}

export async function updateHostSite(
  locationId: string,
  input: Record<string, unknown>,
): Promise<FormState> {
  await assertRole("PLANNER");
  if (!locationId) return { error: "Missing location." };

  const parsed = hostSiteSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.hostSite.upsert({
    where: { locationId },
    update: {
      providesLodging: parsed.data.providesLodging ?? false,
      providesMeals: parsed.data.providesMeals ?? false,
      providesMeetingSpace: parsed.data.providesMeetingSpace ?? false,
      staffNotes: parsed.data.staffNotes || null,
      logisticsNotes: parsed.data.logisticsNotes || null,
    },
    create: {
      locationId,
      providesLodging: parsed.data.providesLodging ?? false,
      providesMeals: parsed.data.providesMeals ?? false,
      providesMeetingSpace: parsed.data.providesMeetingSpace ?? false,
      staffNotes: parsed.data.staffNotes || null,
      logisticsNotes: parsed.data.logisticsNotes || null,
    },
  });

  revalidatePath("/locations");
  revalidatePath(`/locations/${locationId}`);
  return { ok: true, message: "Host site updated." };
}

export async function unmarkHostSite(locationId: string): Promise<FormState> {
  await assertRole("PLANNER");
  if (!locationId) return { error: "Missing location." };

  await prisma.hostSite.deleteMany({
    where: { locationId },
  });

  revalidatePath("/locations");
  revalidatePath(`/locations/${locationId}`);
  return { ok: true, message: "Host site status removed." };
}
