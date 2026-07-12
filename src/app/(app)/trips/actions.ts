"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  Prisma,
  TripStatus,
  BookingStatus,
  ShareAudience,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { tripSchema, type TripInput } from "@/lib/validators/trip";
import { daySchema } from "@/lib/validators/day";
import { scheduleItemSchema } from "@/lib/validators/scheduleItem";
import { bookingSchema, paymentSchema } from "@/lib/validators/booking";
import { staySchema } from "@/lib/validators/stay";
import { parseDateInput, computeDayDate } from "@/lib/dates";
import {
  instantiateDays,
  instantiateVenueBookings,
  instantiateStays,
  templatizeStays,
} from "@/lib/templates";
import { timedInsertIndex } from "@/lib/schedule-order";
import { getTodoistAuth } from "@/lib/todoist-sync";
import { createProject } from "@/lib/todoist";

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

// Field selection for deep-copying a trip's itinerary (template ⇄ trip). The
// shapes feed instantiateDays, which renumbers/derives dates and resets bookings.
const TEMPLATE_DAYS_SELECT = {
  dayIndex: true,
  title: true,
  logisticalNotes: true,
  scheduleItems: {
    orderBy: { order: "asc" },
    select: {
      categoryId: true,
      title: true,
      order: true,
      startTime: true,
      endTime: true,
      notes: true,
      isBlock: true,
      presentationId: true,
      presenters: { select: { id: true } },
      sites: { select: { locationId: true, order: true } },
      bookings: { select: { locationId: true, label: true, notes: true } },
    },
  },
} satisfies Prisma.ItineraryDaySelect;

// Field selection for deep-copying a trip's lodging (template ⇄ trip). Feeds
// templatizeStays / instantiateStays, which convert the anchor (dates ⇄ day
// indices). The venue-engagement booking is copied via the bookings path, so
// booking state is intentionally omitted here.
const TEMPLATE_STAYS_SELECT = {
  locationId: true,
  checkIn: true,
  checkOut: true,
  checkInDayIndex: true,
  checkOutDayIndex: true,
  arrivalTime: true,
  departureTime: true,
  headcount: true,
  costPerPersonPerNight: true,
  currency: true,
  priority: true,
  notes: true,
} satisfies Prisma.StaySelect;

export async function createTrip(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  const parsed = parseTrip(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const data = toTripData(parsed.data);
  const isTemplate = parsed.data.isTemplate ?? false;
  // Templates are date-less skeletons — never persist calendar dates on one, even
  // if the form somehow submitted them.
  if (isTemplate) {
    data.startDate = null;
    data.endDate = null;
  }
  const templateId = String(formData.get("templateId") ?? "");

  // Optionally instantiate from a template: deep-copy its days/items (dates
  // derived from the new startDate, bookings reset). Templates are snapshots.
  let daysCreate;
  let venueBookingsCreate: ReturnType<typeof instantiateVenueBookings> = [];
  let staysCreate: ReturnType<typeof instantiateStays> = [];
  if (templateId) {
    const template = await prisma.trip.findUnique({
      where: { id: templateId },
      select: {
        days: { orderBy: { dayIndex: "asc" }, select: TEMPLATE_DAYS_SELECT },
        bookings: { select: { locationId: true, label: true, notes: true } },
        stays: { select: TEMPLATE_STAYS_SELECT },
      },
    });
    if (!template) return { error: "Selected template no longer exists." };
    daysCreate = instantiateDays(template.days, data.startDate);
    venueBookingsCreate = instantiateVenueBookings(template.bookings);
    // Day-relative template stays resolve to dates against the new startDate (or
    // stay day-relative when the new trip is itself a date-less template).
    staysCreate = instantiateStays(template.stays, data.startDate);
  }

  const trip = await prisma.trip.create({
    data: {
      ...data,
      isTemplate,
      createdById: user.id,
      ...(daysCreate ? { days: { create: daysCreate } } : {}),
      ...(venueBookingsCreate.length
        ? { bookings: { create: venueBookingsCreate } }
        : {}),
      ...(staysCreate.length ? { stays: { create: staysCreate } } : {}),
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

// Snapshot an existing trip as a reusable template: deep-copy its itinerary
// (bookings reset to NOT_BOOKED, calendar dates dropped — a template has none) and
// drop the planner into the new template's editor.
// One-click close-out from the wrap-up card. Status only — everything else on
// the trip is left alone. (Complete is derived from dates; Archived is the
// manual "done and dusted" override.)
export async function archiveTrip(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.trip.update({ where: { id }, data: { status: "ARCHIVED" } });
  revalidateTrip(id);
  revalidatePath("/");
  revalidatePath("/trips");
}

export async function saveTripAsTemplate(formData: FormData): Promise<void> {
  const user = await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const source = await prisma.trip.findUnique({
    where: { id },
    select: {
      name: true,
      tripTypeId: true,
      startDate: true,
      endDate: true,
      capacity: true,
      participantCount: true,
      notes: true,
      days: { orderBy: { dayIndex: "asc" }, select: TEMPLATE_DAYS_SELECT },
      bookings: { select: { locationId: true, label: true, notes: true } },
      stays: { select: TEMPLATE_STAYS_SELECT },
    },
  });
  if (!source) return;

  const venueBookingsCreate = instantiateVenueBookings(source.bookings);
  // Capture lodging as day-relative anchors (dates → day indices, measured from
  // this trip's startDate). Stays that can't be anchored — the source trip is
  // itself date-less — are dropped; a template stay must carry day indices.
  const staysCreate = templatizeStays(source.stays, source.startDate);
  const template = await prisma.trip.create({
    data: {
      name: `${source.name} (template)`,
      tripTypeId: source.tripTypeId,
      // Templates are date-less: drop start/end and derive day dates from null
      // (day skeletons keep their dayIndex, dates fill in when instantiated).
      startDate: null,
      endDate: null,
      capacity: source.capacity,
      participantCount: source.participantCount,
      notes: source.notes,
      status: "ACTIVE",
      isTemplate: true,
      createdById: user.id,
      days: { create: instantiateDays(source.days, null) },
      ...(venueBookingsCreate.length
        ? { bookings: { create: venueBookingsCreate } }
        : {}),
      ...(staysCreate.length ? { stays: { create: staysCreate } } : {}),
    },
  });

  revalidatePath("/trips");
  redirect(`/trips/${template.id}`);
}

export async function deleteTrip(formData: FormData): Promise<void> {
  await assertRole("PLANNER");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.trip.delete({ where: { id } }); // cascades to days → items
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

async function tripIdForItem(itemId: string): Promise<string | null> {
  const item = await prisma.scheduleItem.findUnique({
    where: { id: itemId },
    select: { day: { select: { tripId: true } } },
  });
  return item?.day.tripId ?? null;
}

async function tripIdForStay(stayId: string): Promise<string | null> {
  const stay = await prisma.stay.findUnique({
    where: { id: stayId },
    select: { tripId: true },
  });
  return stay?.tripId ?? null;
}

function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/itinerary`);
  revalidatePath(`/trips/${tripId}/booking`);
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
  input: { title?: string; logisticalNotes?: string; participantNotes?: string },
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = daySchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.itineraryDay.update({
    where: { id: dayId },
    data: {
      title: parsed.data.title || null,
      logisticalNotes: parsed.data.logisticalNotes || null,
      participantNotes: parsed.data.participantNotes || null,
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
    await tx.itineraryDay.delete({ where: { id: dayId } }); // cascades to items
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

// --- ScheduleItem CRUD + reorder ---

export type ScheduleItemInputData = {
  categoryId?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  isBlock?: boolean;
  presentationId?: string;
  presenterIds: string[];
  locationIds: string[];
};

// A schedule item must be identifiable: it needs a title or at least one
// location — unless its category is a self-describing built-in (Free time /
// Break), which legitimately carries only times + notes. Returns an error
// message when the item is under-specified, else null.
async function identityError(
  d: ReturnType<typeof scheduleItemSchema.parse>,
): Promise<string | null> {
  if (d.title || d.locationIds.length > 0) return null;
  const selfDescribing = d.categoryId
    ? (
        await prisma.scheduleItemCategory.findUnique({
          where: { id: d.categoryId },
          select: { system: true },
        })
      )?.system
    : false;
  return selfDescribing
    ? null
    : "Pick at least one location or give the item a title.";
}

function toItemScalars(d: ReturnType<typeof scheduleItemSchema.parse>) {
  return {
    categoryId: d.categoryId || null,
    title: d.title || null,
    startTime: d.startTime || null,
    endTime: d.endTime || null,
    notes: d.notes || null,
    isBlock: d.isBlock ?? false,
    presentationId: d.presentationId || null,
  };
}

export async function addScheduleItem(
  dayId: string,
  input: ScheduleItemInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = scheduleItemSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const idErr = await identityError(parsed.data);
  if (idErr) return { error: idErr };

  // Slot the item into its chronological position rather than always appending —
  // items are ordered by an explicit (drag-reorderable) `order`, not by time.
  await prisma.$transaction(async (tx) => {
    const items = await tx.scheduleItem.findMany({
      where: { dayId },
      select: { order: true, startTime: true },
    });
    const insertAt = timedInsertIndex(items, parsed.data.startTime);
    await tx.scheduleItem.updateMany({
      where: { dayId, order: { gt: insertAt } },
      data: { order: { increment: 1 } },
    });
    await tx.scheduleItem.create({
      data: {
        dayId,
        order: insertAt + 1,
        ...toItemScalars(parsed.data),
        presenters: { connect: parsed.data.presenterIds.map((id) => ({ id })) },
        sites: {
          create: parsed.data.locationIds.map((locationId, i) => ({
            locationId,
            order: i,
          })),
        },
      },
    });
  });

  const tripId = await tripIdForDay(dayId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Item added." };
}

export async function updateScheduleItem(
  itemId: string,
  input: ScheduleItemInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = scheduleItemSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const idErr = await identityError(parsed.data);
  if (idErr) return { error: idErr };

  // Replace the location links wholesale (simple + transactional). Bookings are
  // untouched — they reference Location directly, not the join row.
  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.scheduleItem.update({
      where: { id: itemId },
      data: {
        ...toItemScalars(parsed.data),
        // Wholesale-replace the per-occurrence speaker override (set semantics).
        presenters: { set: parsed.data.presenterIds.map((id) => ({ id })) },
      },
      select: { day: { select: { tripId: true } } },
    });
    await tx.scheduleItemSite.deleteMany({ where: { scheduleItemId: itemId } });
    if (parsed.data.locationIds.length > 0) {
      await tx.scheduleItemSite.createMany({
        data: parsed.data.locationIds.map((locationId, i) => ({
          scheduleItemId: itemId,
          locationId,
          order: i,
        })),
      });
    }
    return updated;
  });

  revalidateTrip(item.day.tripId);
  return { ok: true, message: "Item saved." };
}

export async function deleteScheduleItem(itemId: string): Promise<FormState> {
  await assertRole("PLANNER");
  const item = await prisma.scheduleItem.findUnique({
    where: { id: itemId },
    select: { dayId: true, day: { select: { tripId: true } } },
  });
  if (!item) return { error: "Item not found." };

  await prisma.$transaction(async (tx) => {
    await tx.scheduleItem.delete({ where: { id: itemId } });
    const remaining = await tx.scheduleItem.findMany({
      where: { dayId: item.dayId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    for (let i = 0; i < remaining.length; i++) {
      await tx.scheduleItem.update({
        where: { id: remaining[i].id },
        data: { order: i + 1 },
      });
    }
  });

  revalidateTrip(item.day.tripId);
  return { ok: true, message: "Item removed." };
}

export async function reorderScheduleItems(
  dayId: string,
  orderedItemIds: string[],
): Promise<FormState> {
  await assertRole("PLANNER");
  await prisma.$transaction(
    orderedItemIds.map((id, i) =>
      prisma.scheduleItem.update({ where: { id }, data: { order: i + 1 } }),
    ),
  );
  const tripId = await tripIdForDay(dayId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true };
}

// --- Booking CRUD (attached to a schedule item) ---

export type BookingInputData = {
  locationId?: string;
  label?: string;
  status: string;
  bookedContactId?: string;
  confirmationRef?: string;
  notes?: string;
  agreedAmount?: number | string;
  agreedCurrency?: string;
  agreedUnit?: string;
};

function toBookingScalars(d: ReturnType<typeof bookingSchema.parse>) {
  return {
    locationId: d.locationId || null,
    label: d.label || null,
    status: d.status as BookingStatus,
    bookedContactId: d.bookedContactId || null,
    confirmationRef: d.confirmationRef || null,
    notes: d.notes || null,
    agreedAmount: d.agreedAmount ?? null,
    agreedCurrency: d.agreedCurrency || "USD",
    agreedUnit: d.agreedUnit ?? null,
  };
}

export async function addBooking(
  itemId: string,
  input: BookingInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.booking.create({
    data: { scheduleItemId: itemId, ...toBookingScalars(parsed.data) },
  });

  const tripId = await tripIdForItem(itemId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Booking added." };
}

// Create or update the single venue-engagement booking for a (trip, location).
// The engagement auto-covers every schedule item in the trip that visits this
// location plus any stay there — so the booking dashboard upserts by venue rather
// than per session. `locationId` is the engaged venue (forced from the arg, not the
// input). Idempotent on (tripId, locationId) via the @@unique.
// A location flagged not-bookable (a walk-by stop) can never hold a booking.
async function assertBookable(locationId: string): Promise<string | null> {
  const loc = await prisma.location.findUnique({
    where: { id: locationId },
    select: { bookable: true },
  });
  if (!loc) return "Location not found.";
  if (!loc.bookable) return "This site is marked not bookable.";
  return null;
}

export async function upsertVenueBooking(
  tripId: string,
  locationId: string,
  input: BookingInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const notBookable = await assertBookable(locationId);
  if (notBookable) return { error: notBookable };

  const scalars = { ...toBookingScalars(parsed.data), locationId };
  await prisma.booking.upsert({
    where: { tripId_locationId: { tripId, locationId } },
    create: { tripId, ...scalars },
    update: scalars,
  });

  revalidateTrip(tripId);
  return { ok: true, message: "Booking saved." };
}

// The one-click status control on the dashboard — upsert the engagement with just a
// status (defaults the rest on first create). Other fields are managed via the
// expandable row (upsertVenueBooking) so a quick status change never clears them.
export async function setVenueBookingStatus(
  tripId: string,
  locationId: string,
  status: BookingStatus,
): Promise<FormState> {
  await assertRole("PLANNER");
  const notBookable = await assertBookable(locationId);
  if (notBookable) return { error: notBookable };
  await prisma.booking.upsert({
    where: { tripId_locationId: { tripId, locationId } },
    create: { tripId, locationId, status },
    update: { status },
  });

  revalidateTrip(tripId);
  return { ok: true, message: "Status updated." };
}

// Quick status set for an existing booking by id (the dashboard's one-click control
// on a site-less item booking, which always already exists).
export async function setBookingStatus(
  bookingId: string,
  status: BookingStatus,
): Promise<FormState> {
  await assertRole("PLANNER");
  await prisma.booking.update({ where: { id: bookingId }, data: { status } });
  const tripId = await tripIdForBooking(bookingId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Status updated." };
}

// Resolve the owning trip whether the booking is a venue engagement or a site-less
// item booking.
async function tripIdForBooking(bookingId: string): Promise<string | null> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      tripId: true,
      scheduleItem: { select: { day: { select: { tripId: true } } } },
    },
  });
  if (!b) return null;
  return b.tripId ?? b.scheduleItem?.day.tripId ?? null;
}

// --- Todoist project link for a trip (per-user routing) ---

export async function linkTripTodoistProject(
  tripId: string,
  projectId: string | null,
  // Display name, denormalized onto the link (GH #50). The picker passes it
  // from its loaded options; when absent the summary falls back to a generic
  // label until the next load self-heals it.
  projectName?: string | null,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  if (projectId) {
    await prisma.tripTodoistLink.upsert({
      where: { userId_tripId: { userId: user.id, tripId } },
      create: {
        userId: user.id,
        tripId,
        todoistProjectId: projectId,
        todoistProjectName: projectName ?? null,
      },
      update: {
        todoistProjectId: projectId,
        ...(projectName !== undefined
          ? { todoistProjectName: projectName }
          : {}),
      },
    });
  } else {
    await prisma.tripTodoistLink.deleteMany({
      where: { userId: user.id, tripId },
    });
  }
  revalidatePath(`/trips/${tripId}`);
  return { ok: true, message: projectId ? "Project linked." : "Project unlinked." };
}

export async function createTripTodoistProject(
  tripId: string,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  const auth = await getTodoistAuth(user.id);
  if (!auth) return { error: "Connect Todoist in Settings first." };

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { name: true },
  });
  if (!trip) return { error: "Trip not found." };

  try {
    const project = await createProject(auth.token, trip.name);
    await prisma.tripTodoistLink.upsert({
      where: { userId_tripId: { userId: user.id, tripId } },
      create: {
        userId: user.id,
        tripId,
        todoistProjectId: project.id,
        todoistProjectName: project.name,
      },
      update: {
        todoistProjectId: project.id,
        todoistProjectName: project.name,
      },
    });
  } catch {
    return { error: "Todoist could not be reached — try again." };
  }

  revalidatePath(`/trips/${tripId}`);
  return { ok: true, message: `Created Todoist project “${trip.name}”.` };
}

// --- Payment log (against a booking's agreed price) ---

export type PaymentInputData = {
  amount: number | string;
  currency: string;
  paidOn: string; // "yyyy-mm-dd"
  method?: string;
  note?: string;
};

export async function addPayment(
  bookingId: string,
  input: PaymentInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const paidOn = parseDateInput(parsed.data.paidOn);
  if (!paidOn) return { error: "Invalid payment date." };

  await prisma.payment.create({
    data: {
      bookingId,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      paidOn,
      method: parsed.data.method || null,
      note: parsed.data.note || null,
    },
  });

  const tripId = await tripIdForBooking(bookingId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Payment logged." };
}

export async function deletePayment(paymentId: string): Promise<FormState> {
  await assertRole("PLANNER");
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { bookingId: true },
  });
  if (!payment) return { error: "Payment not found." };

  await prisma.payment.delete({ where: { id: paymentId } });
  const tripId = await tripIdForBooking(payment.bookingId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Payment removed." };
}

export async function updateBooking(
  bookingId: string,
  input: BookingInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  await prisma.booking.update({
    where: { id: bookingId },
    data: toBookingScalars(parsed.data),
  });

  const tripId = await tripIdForBooking(bookingId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Booking saved." };
}

export async function deleteBooking(bookingId: string): Promise<FormState> {
  await assertRole("PLANNER");
  const tripId = await tripIdForBooking(bookingId);
  if (!tripId) return { error: "Booking not found." };

  await prisma.booking.delete({ where: { id: bookingId } });
  revalidateTrip(tripId);
  return { ok: true, message: "Booking removed." };
}

// --- Inline location creation from the item picker ---

export type CreatedLocation = { id: string; name: string };

// Inline-created locations carry no region — region is an admin-managed catalog
// now, assigned later on the location's own page.
export async function createTripLocation(
  tripId: string,
  name: string,
): Promise<
  { ok: true; location: CreatedLocation } | { ok: false; error: string }
> {
  await assertRole("PLANNER");
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { tripTypeId: true },
  });
  if (!trip) return { ok: false, error: "Trip not found." };

  const location = await prisma.location.create({
    data: {
      name: trimmed,
      // Tag with the trip's type so it shows in the default (filtered) picker.
      tripTypes: { connect: { id: trip.tripTypeId } },
    },
    select: { id: true, name: true },
  });

  revalidatePath("/locations");
  revalidateTrip(tripId);
  return { ok: true, location };
}

// --- Inline contact creation (e.g. a presenter) from the item editor ---

export type CreatedContact = { id: string; name: string };

export async function createContactInline(
  name: string,
  organization?: string,
): Promise<
  { ok: true; contact: CreatedContact } | { ok: false; error: string }
> {
  await assertRole("PLANNER");
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };

  const contact = await prisma.contact.create({
    data: { name: trimmed, organization: organization?.trim() || null },
    select: { id: true, name: true },
  });

  revalidatePath("/contacts");
  return { ok: true, contact };
}

// --- Inline presentation (talk) creation from the item editor ---

export type CreatedPresentation = { id: string; title: string };

export async function createPresentationInline(
  title: string,
  description?: string,
): Promise<
  { ok: true; presentation: CreatedPresentation } | { ok: false; error: string }
> {
  await assertRole("PLANNER");
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, error: "Title is required." };

  const presentation = await prisma.presentation.create({
    data: { title: trimmed, description: description?.trim() || null },
    select: { id: true, title: true },
  });

  revalidatePath("/presentations");
  return { ok: true, presentation };
}

// --- Stay CRUD (per-trip lodging) ---

export type StayInputData = {
  locationId: string;
  checkIn?: string;
  checkOut?: string;
  checkInDayIndex?: string;
  checkOutDayIndex?: string;
  arrivalTime?: string;
  departureTime?: string;
  headcount?: string;
  costPerPersonPerNight?: string;
  currency?: string;
  priority?: string;
  notes?: string;
};

// Translate validated input into a Stay row, resolving the anchor mode. Exactly
// one of (dates) / (day indices) is populated — the DB CHECK `stay_anchor_mode`
// enforces the same invariant. Day indices are the template mode.
function toStayData(d: ReturnType<typeof staySchema.parse>) {
  const dayRelative = d.checkInDayIndex != null;
  return {
    locationId: d.locationId,
    checkIn: dayRelative ? null : parseDateInput(d.checkIn ?? "")!,
    checkOut: dayRelative ? null : parseDateInput(d.checkOut ?? "")!,
    checkInDayIndex: dayRelative ? d.checkInDayIndex! : null,
    checkOutDayIndex: dayRelative ? d.checkOutDayIndex! : null,
    arrivalTime: d.arrivalTime || null,
    departureTime: d.departureTime || null,
    headcount: d.headcount ?? null,
    costPerPersonPerNight: d.costPerPersonPerNight ?? null,
    currency: d.currency,
    priority: d.priority ?? 0,
    notes: d.notes || null,
  };
}

// A stay's anchor mode must match its trip: templates (date-less) take day
// indices, dated trips take calendar dates. Returns an error message on mismatch.
function anchorModeError(
  data: ReturnType<typeof toStayData>,
  isTemplate: boolean,
): string | null {
  const dayRelative = data.checkInDayIndex != null;
  if (isTemplate && !dayRelative)
    return "Templates use day numbers for lodging, not calendar dates.";
  if (!isTemplate && dayRelative)
    return "This trip has dates — use calendar dates for lodging, not day numbers.";
  return null;
}

export async function addStay(
  tripId: string,
  input: StayInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = staySchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { isTemplate: true },
  });
  if (!trip) return { error: "Trip not found." };

  const data = toStayData(parsed.data);
  const modeError = anchorModeError(data, trip.isTemplate);
  if (modeError) return { error: modeError };

  await prisma.stay.create({ data: { tripId, ...data } });
  revalidateTrip(tripId);
  return { ok: true, message: "Stay added." };
}

export async function updateStay(
  stayId: string,
  input: StayInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = staySchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const stay = await prisma.stay.findUnique({
    where: { id: stayId },
    select: { tripId: true, trip: { select: { isTemplate: true } } },
  });
  if (!stay) return { error: "Stay not found." };

  const data = toStayData(parsed.data);
  const modeError = anchorModeError(data, stay.trip.isTemplate);
  if (modeError) return { error: modeError };

  await prisma.stay.update({ where: { id: stayId }, data });
  revalidateTrip(stay.tripId);
  return { ok: true, message: "Stay saved." };
}

export async function deleteStay(stayId: string): Promise<FormState> {
  await assertRole("PLANNER");
  const tripId = await tripIdForStay(stayId);
  if (!tripId) return { error: "Stay not found." };

  await prisma.stay.delete({ where: { id: stayId } }); // cascades to its booking
  revalidateTrip(tripId);
  return { ok: true, message: "Stay removed." };
}

// --- Share links (public audience-scoped itinerary URLs) ---

const SHARE_AUDIENCE_SET = new Set<ShareAudience>([
  "STAFF",
  "PARTICIPANT",
  "HOST_SITE",
]);

export async function createShareLink(input: {
  tripId: string;
  audience: ShareAudience;
  label?: string | null;
  locationId?: string | null;
  expiresAt?: string | null; // "yyyy-mm-dd"
}): Promise<FormState> {
  await assertRole("PLANNER");
  if (!input.tripId) return { error: "Missing trip." };
  if (!SHARE_AUDIENCE_SET.has(input.audience)) {
    return { error: "Unknown audience." };
  }

  const trip = await prisma.trip.findUnique({
    where: { id: input.tripId },
    select: { id: true },
  });
  if (!trip) return { error: "Trip not found." };

  // A host-site link must target a host site; other audiences span the trip.
  let locationId: string | null = null;
  if (input.audience === "HOST_SITE") {
    if (!input.locationId) {
      return { error: "Pick a host site for a host-site link." };
    }
    const host = await prisma.location.findFirst({
      where: { id: input.locationId, hostSite: { isNot: null } },
      select: { id: true },
    });
    if (!host) return { error: "That location isn't a host site." };
    locationId = host.id;
  }

  const expiresAt = parseDateInput(input.expiresAt ?? undefined);

  await prisma.shareLink.create({
    data: {
      tripId: input.tripId,
      audience: input.audience,
      label: input.label?.trim() || null,
      locationId,
      expiresAt,
    },
  });
  revalidateTrip(input.tripId);
  return { ok: true, message: "Share link created." };
}

export async function setShareLinkEnabled(
  id: string,
  enabled: boolean,
): Promise<FormState> {
  await assertRole("PLANNER");
  const link = await prisma.shareLink.findUnique({
    where: { id },
    select: { tripId: true },
  });
  if (!link) return { error: "Link not found." };

  await prisma.shareLink.update({ where: { id }, data: { enabled } });
  revalidateTrip(link.tripId);
  return { ok: true, message: enabled ? "Link enabled." : "Link disabled." };
}

export async function deleteShareLink(id: string): Promise<FormState> {
  await assertRole("PLANNER");
  const link = await prisma.shareLink.findUnique({
    where: { id },
    select: { tripId: true },
  });
  if (!link) return { error: "Link not found." };

  await prisma.shareLink.delete({ where: { id } });
  revalidateTrip(link.tripId);
  return { ok: true, message: "Link deleted." };
}
