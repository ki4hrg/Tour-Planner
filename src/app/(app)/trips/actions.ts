"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma, TripStatus, BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { tripSchema, type TripInput } from "@/lib/validators/trip";
import { daySchema } from "@/lib/validators/day";
import { stopSchema } from "@/lib/validators/stop";
import { parseDateInput, computeDayDate } from "@/lib/dates";
import { instantiateDays } from "@/lib/templates";

// --- Trip CRUD ---

function parseTrip(formData: FormData) {
  return tripSchema.safeParse({
    name: formData.get("name"),
    tripTypeId: formData.get("tripTypeId"),
    startDate: formData.get("startDate") ?? "",
    endDate: formData.get("endDate") ?? "",
    capacity: formData.get("capacity") ?? "",
    participantCount: formData.get("participantCount") ?? "",
    status: formData.get("status"),
    notes: formData.get("notes") || undefined,
    isTemplate: formData.get("isTemplate") === "on",
  });
}

function toTripData(d: TripInput) {
  return {
    name: d.name,
    tripTypeId: d.tripTypeId,
    startDate: parseDateInput(d.startDate),
    endDate: parseDateInput(d.endDate),
    capacity: d.capacity ?? null,
    participantCount: d.participantCount ?? null,
    status: d.status as TripStatus,
    notes: d.notes || null,
  };
}

export async function createTrip(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  const parsed = parseTrip(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const data = toTripData(parsed.data);
  const templateId = String(formData.get("templateId") ?? "");

  // Optionally instantiate from a template: deep-copy its days/stops (dates
  // derived from the new startDate, booking reset). Templates are snapshots.
  let daysCreate;
  if (templateId) {
    const template = await prisma.trip.findUnique({
      where: { id: templateId },
      select: {
        days: {
          orderBy: { dayIndex: "asc" },
          select: {
            dayIndex: true,
            title: true,
            logisticalNotes: true,
            stops: {
              orderBy: { order: "asc" },
              select: {
                siteId: true,
                title: true,
                order: true,
                startTime: true,
                endTime: true,
                scheduleNotes: true,
                bookingNotes: true,
              },
            },
          },
        },
      },
    });
    if (!template) return { error: "Selected template no longer exists." };
    daysCreate = instantiateDays(template.days, data.startDate);
  }

  const trip = await prisma.trip.create({
    data: {
      ...data,
      isTemplate: parsed.data.isTemplate ?? false,
      createdById: user.id,
      ...(daysCreate ? { days: { create: daysCreate } } : {}),
    },
  });

  revalidatePath("/trips");
  redirect(`/trips/${trip.id}`);
}

export async function updateTrip(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing trip." };

  const parsed = parseTrip(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const data = toTripData(parsed.data);

  await prisma.$transaction(async (tx) => {
    await tx.trip.update({ where: { id }, data });
    // startDate drives every derived day date — recompute on each save.
    await recomputeDayDates(tx, id, data.startDate);
  });

  revalidatePath("/trips");
  revalidatePath(`/trips/${id}`);
  revalidatePath(`/trips/${id}/itinerary`);
  return { ok: true, message: "Saved." };
}

export async function deleteTrip(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.trip.delete({ where: { id } }); // cascades to days → stops
  revalidatePath("/trips");
  redirect("/trips");
}

// --- Shared helpers ---

type Tx = Prisma.TransactionClient;

/** Renumber a trip's days 1..n by current dayIndex and recompute each date. */
async function recomputeDayDates(
  tx: Tx,
  tripId: string,
  startDate: Date | null,
) {
  const days = await tx.itineraryDay.findMany({
    where: { tripId },
    orderBy: { dayIndex: "asc" },
    select: { id: true },
  });
  for (let i = 0; i < days.length; i++) {
    await tx.itineraryDay.update({
      where: { id: days[i].id },
      data: { dayIndex: i + 1, date: computeDayDate(startDate, i + 1) },
    });
  }
}

async function tripIdForDay(dayId: string): Promise<string | null> {
  const day = await prisma.itineraryDay.findUnique({
    where: { id: dayId },
    select: { tripId: true },
  });
  return day?.tripId ?? null;
}

function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/itinerary`);
}

// --- ItineraryDay CRUD + reorder ---

export async function addDay(tripId: string): Promise<FormState> {
  await assertRole("PLANNER");
  if (!tripId) return { error: "Missing trip." };

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { startDate: true, _count: { select: { days: true } } },
  });
  if (!trip) return { error: "Trip not found." };

  const dayIndex = trip._count.days + 1;
  await prisma.itineraryDay.create({
    data: {
      tripId,
      dayIndex,
      date: computeDayDate(trip.startDate, dayIndex),
    },
  });

  revalidateTrip(tripId);
  return { ok: true, message: "Day added." };
}

export async function updateDay(
  dayId: string,
  input: { title?: string; logisticalNotes?: string },
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = daySchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.itineraryDay.update({
    where: { id: dayId },
    data: {
      title: parsed.data.title || null,
      logisticalNotes: parsed.data.logisticalNotes || null,
    },
  });

  const tripId = await tripIdForDay(dayId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Day saved." };
}

export async function deleteDay(dayId: string): Promise<FormState> {
  await assertRole("PLANNER");
  const day = await prisma.itineraryDay.findUnique({
    where: { id: dayId },
    select: { tripId: true, trip: { select: { startDate: true } } },
  });
  if (!day) return { error: "Day not found." };

  await prisma.$transaction(async (tx) => {
    await tx.itineraryDay.delete({ where: { id: dayId } }); // cascades to stops
    await recomputeDayDates(tx, day.tripId, day.trip.startDate);
  });

  revalidateTrip(day.tripId);
  return { ok: true, message: "Day removed." };
}

export async function reorderDays(
  tripId: string,
  orderedDayIds: string[],
): Promise<FormState> {
  await assertRole("PLANNER");
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { startDate: true },
  });
  if (!trip) return { error: "Trip not found." };

  await prisma.$transaction(
    orderedDayIds.map((id, i) =>
      prisma.itineraryDay.update({
        where: { id },
        data: { dayIndex: i + 1, date: computeDayDate(trip.startDate, i + 1) },
      }),
    ),
  );

  revalidateTrip(tripId);
  return { ok: true };
}

// --- Stop CRUD + reorder ---

export type StopInputData = {
  siteId?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  scheduleNotes?: string;
  bookingStatus: string;
  bookingNotes?: string;
  bookedContactId?: string;
  confirmationRef?: string;
};

function toStopData(d: ReturnType<typeof stopSchema.parse>) {
  return {
    siteId: d.siteId || null,
    title: d.title || null,
    startTime: d.startTime || null,
    endTime: d.endTime || null,
    scheduleNotes: d.scheduleNotes || null,
    bookingStatus: d.bookingStatus as BookingStatus,
    bookingNotes: d.bookingNotes || null,
    bookedContactId: d.bookedContactId || null,
    confirmationRef: d.confirmationRef || null,
  };
}

export async function addStop(
  dayId: string,
  input: StopInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = stopSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const count = await prisma.stop.count({ where: { dayId } });
  await prisma.stop.create({
    data: { dayId, order: count + 1, ...toStopData(parsed.data) },
  });

  const tripId = await tripIdForDay(dayId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Stop added." };
}

export async function updateStop(
  stopId: string,
  input: StopInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = stopSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const stop = await prisma.stop.update({
    where: { id: stopId },
    data: toStopData(parsed.data),
    select: { day: { select: { tripId: true } } },
  });

  revalidateTrip(stop.day.tripId);
  return { ok: true, message: "Stop saved." };
}

export async function deleteStop(stopId: string): Promise<FormState> {
  await assertRole("PLANNER");
  const stop = await prisma.stop.findUnique({
    where: { id: stopId },
    select: { dayId: true, day: { select: { tripId: true } } },
  });
  if (!stop) return { error: "Stop not found." };

  await prisma.$transaction(async (tx) => {
    await tx.stop.delete({ where: { id: stopId } });
    const remaining = await tx.stop.findMany({
      where: { dayId: stop.dayId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    for (let i = 0; i < remaining.length; i++) {
      await tx.stop.update({
        where: { id: remaining[i].id },
        data: { order: i + 1 },
      });
    }
  });

  revalidateTrip(stop.day.tripId);
  return { ok: true, message: "Stop removed." };
}

export async function reorderStops(
  dayId: string,
  orderedStopIds: string[],
): Promise<FormState> {
  await assertRole("PLANNER");
  await prisma.$transaction(
    orderedStopIds.map((id, i) =>
      prisma.stop.update({ where: { id }, data: { order: i + 1 } }),
    ),
  );
  const tripId = await tripIdForDay(dayId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true };
}

// --- Inline site creation from the stop picker ---

export type CreatedSite = { id: string; name: string; region: string | null };

export async function createTripSite(
  tripId: string,
  name: string,
  region?: string,
): Promise<{ ok: true; site: CreatedSite } | { ok: false; error: string }> {
  await assertRole("PLANNER");
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { tripTypeId: true },
  });
  if (!trip) return { ok: false, error: "Trip not found." };

  const site = await prisma.site.create({
    data: {
      name: trimmed,
      region: region?.trim() || null,
      // Tag with the trip's type so it shows in the default (filtered) picker.
      tripTypes: { connect: { id: trip.tripTypeId } },
    },
    select: { id: true, name: true, region: true },
  });

  revalidatePath("/sites");
  revalidateTrip(tripId);
  return { ok: true, site };
}
