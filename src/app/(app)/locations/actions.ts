"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseDateInput } from "@/lib/dates";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { locationSchema, type LocationInput } from "@/lib/validators/location";
import { costSchema, type CostInput } from "@/lib/validators/cost";
import {
  locationEventSchema,
  type LocationEventInput,
} from "@/lib/validators/location-event";
import { hostSiteSchema } from "@/lib/validators/hostSite";
import { paymentScheduleSchema, installmentRows } from "@/lib/validators/booking";
import type { PaymentScheduleInputData } from "../trips/actions";
import {
  MergeError,
  mergeLocations,
  previewLocationMerge,
  type LocationMergePreview,
} from "@/lib/location-merge";
import { setBookedVia } from "@/lib/booked-via.server";

function parseLocation(formData: FormData) {
  return locationSchema.safeParse({
    name: formData.get("name"),
    regionId: formData.get("regionId") || undefined,
    address: formData.get("address") || undefined,
    description: formData.get("description") || undefined,
    notes: formData.get("notes") || undefined,
    website: formData.get("website") ?? "",
    mapUrl: formData.get("mapUrl") ?? "",
    googlePlaceId: formData.get("googlePlaceId") || undefined,
    lat: formData.get("lat") ?? "",
    lng: formData.get("lng") ?? "",
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
    googlePlaceId: d.googlePlaceId || null,
    lat: d.lat ?? null,
    lng: d.lng ?? null,
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
      placeIdCheckedAt: parsed.data.googlePlaceId ? new Date() : null,
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

  const existing = await prisma.location.findUnique({
    where: { id },
    select: { googlePlaceId: true },
  });
  if (!existing) return { error: "Location not found." };
  const placeId = parsed.data.googlePlaceId || null;

  await prisma.location.update({
    where: { id },
    data: {
      ...toLocationData(parsed.data),
      // A newly linked (or cleared) place restarts the yearly refresh clock and
      // settles any "Google dropped this place" review flag.
      ...(placeId !== existing.googlePlaceId
        ? {
            placeIdCheckedAt: placeId ? new Date() : null,
            placeIdNeedsReview: false,
          }
        : {}),
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

  // Archive if any itinerary item OR rough-plan day assignment (GH #9) references
  // this location (preserve trip history); hard-delete only when unreferenced.
  const [itemRefs, plannedRefs] = await Promise.all([
    prisma.scheduleItemSite.count({ where: { locationId: id } }),
    prisma.itineraryDayLocation.count({ where: { locationId: id } }),
  ]);
  if (itemRefs + plannedRefs > 0) {
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
    validFrom: formData.get("validFrom") ?? "",
    validTo: formData.get("validTo") ?? "",
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
    validFrom: parseDateInput(d.validFrom),
    validTo: parseDateInput(d.validTo),
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
  // Unlinking the primary contact also clears its designation — the primary
  // must always be one of the linked contacts.
  const current = await prisma.location.findUnique({
    where: { id: locationId },
    select: { primaryContactId: true },
  });
  await prisma.location.update({
    where: { id: locationId },
    data: {
      contacts: { disconnect: { id: contactId } },
      ...(current?.primaryContactId === contactId
        ? { primaryContact: { disconnect: true } }
        : {}),
    },
  });
  revalidatePath(`/locations/${locationId}`);
}

// Designate (or clear) the go-to contact for a venue. Passing no/blank
// contactId clears it; otherwise the contact is linked (if it isn't already)
// and set as primary.
export async function setPrimaryContact(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const locationId = String(formData.get("locationId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!locationId) return;
  await prisma.location.update({
    where: { id: locationId },
    data: contactId
      ? {
          contacts: { connect: { id: contactId } },
          primaryContact: { connect: { id: contactId } },
        }
      : { primaryContact: { disconnect: true } },
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
  return { ok: true, message: "Host site removed." };
}

// --- Standing payment terms (GH #86): the venue's default schedule ---

// Replace the location's whole default schedule in one go — same REPLACE
// semantics as setPaymentSchedule on a booking. These installments are
// date-relative (days before trip start), so they seed a new engagement's
// PaymentScheduleItem set verbatim; resolution only happens once they land on a
// dated trip's booking. Editing here never touches existing engagements.
export async function setLocationPaymentSchedule(
  locationId: string,
  input: PaymentScheduleInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  if (!locationId) return { error: "Missing location." };
  const parsed = paymentScheduleSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.$transaction([
    prisma.locationPaymentScheduleItem.deleteMany({ where: { locationId } }),
    prisma.locationPaymentScheduleItem.createMany({
      data: installmentRows(parsed.data.installments).map((r) => ({
        locationId,
        ...r,
      })),
    }),
  ]);

  revalidatePath("/locations");
  revalidatePath(`/locations/${locationId}`);
  return { ok: true, message: "Payment terms saved." };
}

// --- Merge a duplicate into another location ---

// What folding `sourceId` into `targetId` would move — shown in the confirm step.
export async function previewMergeLocation(
  sourceId: string,
  targetId: string,
): Promise<{ preview?: LocationMergePreview; error?: string }> {
  await assertRole("PLANNER");
  try {
    return { preview: await previewLocationMerge(sourceId, targetId) };
  } catch (err) {
    if (err instanceof MergeError) return { error: err.message };
    throw err;
  }
}

export async function mergeLocation(
  sourceId: string,
  targetId: string,
): Promise<FormState> {
  await assertRole("PLANNER");
  try {
    const { source, target } = await mergeLocations(sourceId, targetId);
    // The merge repoints trips, bookings, stays and notes app-wide.
    revalidatePath("/", "layout");
    return { ok: true, message: `Merged “${source.name}” into “${target.name}”.` };
  } catch (err) {
    if (err instanceof MergeError) return { error: err.message };
    throw err;
  }
}

// The workflow new engagements at this venue start on (null = the global
// default). Existing bookings keep theirs.
export async function setLocationDefaultWorkflow(
  locationId: string,
  workflowId: string | null,
): Promise<FormState> {
  await assertRole("PLANNER");
  if (workflowId) {
    const wf = await prisma.bookingWorkflow.findUnique({
      where: { id: workflowId },
      select: { id: true },
    });
    if (!wf) return { error: "Workflow not found." };
  }
  await prisma.location.update({
    where: { id: locationId },
    data: { defaultWorkflowId: workflowId },
  });
  revalidatePath(`/locations/${locationId}`);
  return { ok: true, message: "Saved." };
}

// Set (or clear) the parent venue this location is booked via. Gaining a
// parent hands this location's own engagements to the parent's (see
// setBookedVia); the confirm in the UI names the trips first.
export async function setLocationBookedVia(
  locationId: string,
  parentId: string | null,
): Promise<FormState> {
  await assertRole("PLANNER");
  const before = await prisma.location.findUnique({
    where: { id: locationId },
    select: { bookedViaId: true },
  });
  if (!before) return { error: "Location not found." };
  const res = await setBookedVia(locationId, parentId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/locations");
  for (const id of [locationId, parentId, before.bookedViaId]) {
    if (id) revalidatePath(`/locations/${id}`);
  }
  // Engagement rows moved between venues on every trip that had one.
  if (res.folded > 0) revalidatePath("/trips", "layout");
  return {
    ok: true,
    message:
      res.folded > 0
        ? `Saved. Moved ${res.folded} booking${res.folded === 1 ? "" : "s"}.`
        : "Saved.",
  };
}

// --- Standing venue events (LocationEvent) ---
// Direct-call actions (typed args → FormState) for the Location page's events
// card. Deleting an event never touches schedule items already added from it.

export type LocationEventInputData = {
  title: string;
  startTime: string;
  endTime?: string;
  categoryId?: string;
  notes?: string;
};

function toEventData(d: LocationEventInput) {
  return {
    title: d.title,
    startTime: d.startTime,
    endTime: d.endTime ?? null,
    categoryId: d.categoryId ?? null,
    notes: d.notes || null,
  };
}

export async function addLocationEvent(
  locationId: string,
  input: LocationEventInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = locationEventSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  await prisma.locationEvent.create({
    data: { locationId, ...toEventData(parsed.data) },
  });
  revalidatePath(`/locations/${locationId}`);
  return { ok: true, message: "Event added." };
}

export async function updateLocationEvent(
  id: string,
  input: LocationEventInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = locationEventSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const event = await prisma.locationEvent.update({
    where: { id },
    data: toEventData(parsed.data),
    select: { locationId: true },
  });
  revalidatePath(`/locations/${event.locationId}`);
  return { ok: true, message: "Saved." };
}

export async function deleteLocationEvent(id: string): Promise<FormState> {
  await assertRole("PLANNER");
  const event = await prisma.locationEvent.delete({
    where: { id },
    select: { locationId: true },
  });
  revalidatePath(`/locations/${event.locationId}`);
  return { ok: true, message: "Event removed." };
}
