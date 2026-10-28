"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  Prisma,
  TripStatus,
  BookingStatus,
  MealKind,
  MealProvision,
  ShareAudience,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { foldSessionBookings } from "@/lib/session-booking-fold";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { sourceTripIdSchema, tripSchema, type TripInput } from "@/lib/validators/trip";
import { daySchema, plannedLocationSchema } from "@/lib/validators/day";
import { scheduleItemSchema } from "@/lib/validators/scheduleItem";
import {
  bookingSchema,
  paymentSchema,
  paymentScheduleSchema,
  installmentRows,
  priceLineRows,
} from "@/lib/validators/booking";
import { staySchema } from "@/lib/validators/stay";
import { parseDateInput, computeDayDate, todayUtc } from "@/lib/dates";
import {
  applyStartDateChange,
  assertBookable,
  deleteItineraryDay,
  ensureVenueEngagement,
  seedScheduleFromLocation,
  toScheduleSeed,
  type LocationScheduleSeed,
} from "@/lib/trip-mutations";
import {
  copyStays,
  describeDayFit,
  fitDaysToRange,
  instantiateDays,
  instantiateVenueBookings,
  templatizeStays,
  type InstantiatedVenueBooking,
} from "@/lib/templates";
import { timedInsertIndex } from "@/lib/schedule-order";
import {
  moveItemToDay,
  movePlannedLocationTo,
  previewDayReorder,
  reorderDayItems,
  reorderTripDays,
  reslotEditedItem,
  type StayFollowLine,
} from "@/lib/itinerary-mutations";
import { travelLegCreateData } from "@/lib/travel";
import {
  cascadeFromEdit,
  describeShifts,
  fixedTimeOverlaps,
  shiftDayItems,
} from "@/lib/schedule-shift";
import { getTodoistAuth } from "@/lib/todoist-sync";
import { engagementLocationIdFor } from "@/lib/booked-via.server";
import { tripDefaultCurrencyFor } from "@/lib/trip-mutations";
import { bookedViaMap, engagementLocationId } from "@/lib/booked-via";
import {
  seedWorkflowFor,
  setBookingStage,
  setBookingStatusDirect,
  setBookingStep,
  setBookingWorkflow,
} from "@/lib/booking-workflow-sync";
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
    currencies: formData.getAll("currencies"),
    defaultCurrency: formData.get("defaultCurrency") ?? "",
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
    currencies: d.currencies,
    defaultCurrency: d.defaultCurrency,
    notes: d.notes || null,
  };
}

// Field selection for deep-copying a trip's itinerary (template ⇄ trip). The
// shapes feed instantiateDays, which renumbers/derives dates and resets bookings.
const TEMPLATE_DAYS_SELECT = {
  dayIndex: true,
  title: true,
  logisticalNotes: true,
  cityRegionId: true,
  plannedLocations: {
    select: { locationId: true, order: true, note: true },
  },
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
      fixedTime: true,
      room: true,
      mealKind: true,
      mealProvision: true,
      presentationId: true,
      presenters: { select: { id: true } },
      sites: { select: { locationId: true, order: true } },
      bookings: {
        select: { locationId: true, label: true, notes: true, workflowId: true },
      },
      travel: {
        select: {
          method: true,
          fromLocationId: true,
          fromLabel: true,
          toLocationId: true,
          toLabel: true,
          stops: {
            select: {
              locationId: true,
              label: true,
              dwellMinutes: true,
              order: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ItineraryDaySelect;

// Field selection for deep-copying a trip's venue-engagement bookings (template
// ⇄ trip). The payment schedule (GH #51) is date-relative, so it carries over;
// instance actuals (status, contact, ref, agreed price) are reset by
// instantiateVenueBookings.
const TEMPLATE_VENUE_BOOKING_SELECT = {
  locationId: true,
  label: true,
  notes: true,
  workflowId: true,
  paymentSchedule: {
    select: {
      label: true,
      percent: true,
      fixedAmount: true,
      anchor: true,
      offsetValue: true,
      offsetUnit: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.BookingSelect;

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

// The create form returns the new trip's id instead of redirecting so the form
// can toast what happened (day count / moved end date) and then navigate.
export type CreateTripState = FormState & { tripId?: string };

export async function createTrip(
  _prev: FormState,
  formData: FormData,
): Promise<CreateTripState> {
  const user = await assertRole("PLANNER");
  const parsed = parseTrip(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const parsedSource = sourceTripIdSchema.safeParse(formData.get("sourceTripId"));
  if (!parsedSource.success) return { error: "Invalid source trip." };
  const sourceTripId = parsedSource.data;

  const data = toTripData(parsed.data);
  const isTemplate = parsed.data.isTemplate ?? false;
  // Templates are date-less skeletons — never persist calendar dates on one, even
  // if the form somehow submitted them.
  if (isTemplate) {
    data.startDate = null;
    data.endDate = null;
  }

  // Optionally start from a source trip: a template OR any ordinary trip of the
  // same type (incl. archived — "same as last year, shifted a week"). Either
  // way the days/items are deep-copied with dates derived from the new
  // startDate and stays re-anchored to the new dates. Copies are snapshots.
  let daysCreate;
  let venueBookingsCreate: ReturnType<typeof instantiateVenueBookings> = [];
  let staysCreate: ReturnType<typeof copyStays> = [];
  let message = "Created.";
  if (sourceTripId) {
    const source = await prisma.trip.findUnique({
      where: { id: sourceTripId },
      select: {
        isTemplate: true,
        tripTypeId: true,
        startDate: true,
        days: { orderBy: { dayIndex: "asc" }, select: TEMPLATE_DAYS_SELECT },
        bookings: { select: TEMPLATE_VENUE_BOOKING_SELECT },
        stays: { select: TEMPLATE_STAYS_SELECT },
      },
    });
    if (!source) return { error: "Source trip not found." };
    if (source.tripTypeId !== data.tripTypeId) {
      return { error: "Source trip is a different type." };
    }
    if (source.isTemplate) {
      daysCreate = instantiateDays(source.days, data.startDate);
      // Template schedule wins; where a copied engagement carries none, fall back
      // to the venue's standing terms (GH #86). Both beat an empty schedule.
      venueBookingsCreate = await applyLocationWorkflowDefaults(
        await applyLocationScheduleDefaults(
          instantiateVenueBookings(
            source.bookings,
            await engagementVenueResolver(source.bookings),
          ),
        ),
      );
    } else {
      // A past trip is this year's plan, not this year's paperwork: its
      // bookings (venue engagements AND item bookings), payments, notes and
      // documents stay behind. Each item's speakers come along.
      daysCreate = instantiateDays(source.days, data.startDate, {
        bookings: false,
        presenters: true,
      });
    }
    // Day-relative stays resolve to dates against the new startDate (a dated
    // source is first measured from its own startDate); a new date-less
    // template keeps them day-relative.
    staysCreate = copyStays(source.stays, source, data.startDate);
    // The typed range and the copied day count rarely agree: pad empty days
    // out to endDate, or keep every day and move endDate — never drop days.
    if (!isTemplate) {
      const fit = fitDaysToRange(daysCreate, data.startDate, data.endDate);
      daysCreate = fit.days;
      data.endDate = fit.endDate;
      message = describeDayFit(fit);
    }
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
  return { ok: true, message, tripId: trip.id };
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
    const before = await tx.trip.findUnique({
      where: { id },
      select: { startDate: true },
    });
    await tx.trip.update({ where: { id }, data });
    // startDate drives every derived day date — recompute on each save — and
    // dated stays move by the same delta so lodging stays on the same nights.
    await applyStartDateChange(
      tx,
      id,
      before?.startDate ?? null,
      data.startDate,
    );
  });

  revalidatePath("/trips");
  revalidatePath(`/trips/${id}`);
  revalidatePath(`/trips/${id}/itinerary`);
  return { ok: true, message: "Saved." };
}

// Snapshot an existing trip as a reusable template: deep-copy its itinerary
// (bookings reset to PENDING, calendar dates dropped — a template has none) and
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
      currencies: true,
      defaultCurrency: true,
      notes: true,
      days: { orderBy: { dayIndex: "asc" }, select: TEMPLATE_DAYS_SELECT },
      bookings: { select: TEMPLATE_VENUE_BOOKING_SELECT },
      stays: { select: TEMPLATE_STAYS_SELECT },
    },
  });
  if (!source) return;

  const venueBookingsCreate = instantiateVenueBookings(
    source.bookings,
    await engagementVenueResolver(source.bookings),
  );
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
      currencies: source.currencies,
      defaultCurrency: source.defaultCurrency,
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
  // Cross-trip surfaces that roll bookings up: the Bookings page and the
  // dashboard's "needs action" card.
  revalidatePath("/bookings");
  revalidatePath("/");
}

// --- ItineraryDay CRUD + reorder ---

export async function addDay(tripId: string): Promise<FormState> {
  await assertRole("PLANNER");
  if (!tripId) return { error: "Missing trip." };

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { startDate: true },
  });
  if (!trip) return { error: "Trip not found." };

  // Count + create in one txn so two concurrent adds can't both claim n+1.
  // dayIndex has no unique constraint to catch a race, so lock the trip row
  // first: a second addDay waits here until this one commits, then counts it.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Trip" WHERE "id" = ${tripId} FOR UPDATE`;
    const count = await tx.itineraryDay.count({ where: { tripId } });
    const dayIndex = count + 1;
    await tx.itineraryDay.create({
      data: {
        tripId,
        dayIndex,
        date: computeDayDate(trip.startDate, dayIndex),
      },
    });
  });

  revalidateTrip(tripId);
  return { ok: true, message: "Day added." };
}

export async function updateDay(
  dayId: string,
  input: {
    title?: string;
    logisticalNotes?: string;
    participantNotes?: string;
    primaryLocationId?: string;
    cityRegionId?: string;
  },
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
      primaryLocationId: parsed.data.primaryLocationId || null,
      cityRegionId: parsed.data.cityRegionId || null,
    },
  });

  const tripId = await tripIdForDay(dayId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Day saved." };
}

export async function deleteDay(dayId: string): Promise<FormState> {
  await assertRole("PLANNER");
  const res = await deleteItineraryDay(dayId);
  if ("error" in res) return { error: res.error };

  revalidateTrip(res.tripId);
  const collapsed = res.collapsedStays;
  return {
    ok: true,
    message: collapsed
      ? `Day removed. ${collapsed} stay${collapsed === 1 ? "" : "s"} now empty.`
      : "Day removed.",
  };
}

// Reorder a trip's days. `moveStays` also shifts lodging whose nights moved
// together (the editor asks first — previewDayReorder lists what would move).
export async function reorderDays(
  tripId: string,
  orderedDayIds: string[],
  opts: { moveStays?: boolean } = {},
): Promise<FormState> {
  await assertRole("PLANNER");
  const res = await reorderTripDays(tripId, orderedDayIds, opts);
  if ("error" in res) return { error: res.error };
  revalidateTrip(tripId);
  if (!opts.moveStays) return { ok: true };
  const { movedStays: n, splitStays: k } = res;
  return {
    ok: true,
    message: [
      n ? `Moved ${n} stay${n === 1 ? "" : "s"} with ${n === 1 ? "its" : "their"} days.` : null,
      k ? `${k} stay${k === 1 ? "" : "s"} left in place.` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined,
  };
}

// The lodging a proposed day order would affect — feeds the editor's
// "move lodging too?" prompt before anything is written.
export async function previewDayReorderAction(
  tripId: string,
  orderedDayIds: string[],
): Promise<{ error: string } | { ok: true; stays: StayFollowLine[] }> {
  await assertRole("PLANNER");
  return previewDayReorder(tripId, orderedDayIds);
}

// --- Rough-plan day locations (GH #9) ---
//
// A day-level set of intended locations with no times — "we'll be in this city
// seeing A, B, C" — distinct from the timed ScheduleItem route. A planner adds/
// removes them freely and later promotes one into a real schedule item.

export async function addPlannedLocation(
  dayId: string,
  input: { locationId: string; note?: string },
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = plannedLocationSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  // Idempotent per (day, location): re-adding an existing planned location just
  // updates its note. New rows append to the end of the loose cluster.
  const count = await prisma.itineraryDayLocation.count({ where: { dayId } });
  await prisma.itineraryDayLocation.upsert({
    where: { dayId_locationId: { dayId, locationId: parsed.data.locationId } },
    update: { note: parsed.data.note || null },
    create: {
      dayId,
      locationId: parsed.data.locationId,
      note: parsed.data.note || null,
      order: count,
    },
  });

  const tripId = await tripIdForDay(dayId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Planned location added." };
}

// Move a rough-plan location to another day of the same trip (a duplicate on
// the target day collapses into it — see movePlannedLocationTo).
export async function movePlannedLocation(
  id: string,
  toDayId: string,
): Promise<FormState> {
  await assertRole("PLANNER");
  const res = await movePlannedLocationTo(id, toDayId);
  if ("error" in res) return { error: res.error };
  revalidateTrip(res.tripId);
  return { ok: true };
}

export async function removePlannedLocation(id: string): Promise<FormState> {
  await assertRole("PLANNER");
  const planned = await prisma.itineraryDayLocation.findUnique({
    where: { id },
    select: { dayId: true },
  });
  if (!planned) return { error: "Planned location not found." };

  await prisma.itineraryDayLocation.delete({ where: { id } });

  const tripId = await tripIdForDay(planned.dayId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Planned location removed." };
}

// Promote a rough assignment into a real, time-less schedule item at the end of
// the day, then drop the rough row. The location identifies the item (no title/
// times needed), matching how addScheduleItem builds a located stop. Any note on
// the rough row carries over to the item's notes so the planner's context survives.
export async function promotePlannedLocation(id: string): Promise<FormState> {
  await assertRole("PLANNER");
  const planned = await prisma.itineraryDayLocation.findUnique({
    where: { id },
    select: { dayId: true, locationId: true, note: true },
  });
  if (!planned) return { error: "Planned location not found." };

  await prisma.$transaction(async (tx) => {
    const count = await tx.scheduleItem.count({ where: { dayId: planned.dayId } });
    await tx.scheduleItem.create({
      data: {
        dayId: planned.dayId,
        order: count + 1,
        notes: planned.note || null,
        sites: { create: [{ locationId: planned.locationId, order: 0 }] },
      },
    });
    await tx.itineraryDayLocation.delete({ where: { id } });
  });

  const tripId = await tripIdForDay(planned.dayId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Added to schedule." };
}

// --- ScheduleItem CRUD + reorder ---

export type TravelLegInputData = {
  method: string;
  fromLocationId?: string;
  fromLabel?: string;
  toLocationId?: string;
  toLabel?: string;
  stops: { locationId?: string; label?: string; dwellMinutes?: number | string }[];
};

export type ScheduleItemInputData = {
  categoryId?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  isBlock?: boolean;
  fixedTime?: boolean;
  // Where within the venue; omitted ⇒ untouched on update, "" clears.
  room?: string;
  // Set ⇒ a meal; null clears. Omitted ⇒ untouched on update.
  mealKind?: MealKind | null;
  mealProvision?: MealProvision | null;
  presentationId?: string;
  presenterIds: string[];
  locationIds: string[];
  // A travel span (GH #80). On update: null removes the leg, undefined leaves
  // an existing leg untouched.
  travel?: TravelLegInputData | null;
};

// A schedule item must be identifiable: it needs a title or at least one
// location — unless its category is a self-describing built-in (Free time /
// Break), which legitimately carries only times + notes, or it's a travel
// span (its identity is the route). `hasExistingLeg` covers updates that
// leave an item's persisted leg untouched (travel undefined). Returns an
// error message when the item is under-specified, else null.
async function identityError(
  d: ReturnType<typeof scheduleItemSchema.parse>,
  hasExistingLeg = false,
): Promise<string | null> {
  if (d.title || d.locationIds.length > 0 || d.travel || hasExistingLeg)
    return null;
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
    : "Location or title required.";
}

function toItemScalars(d: ReturnType<typeof scheduleItemSchema.parse>) {
  return {
    categoryId: d.categoryId || null,
    // Omitted ⇒ untouched on update (a travel edit or quick time fix doesn't
    // round-trip it); "" clears. Nullable on create, so undefined is fine there.
    title: d.title === undefined ? undefined : d.title || null,
    startTime: d.startTime || null,
    endTime: d.endTime || null,
    notes: d.notes || null,
    isBlock: d.isBlock ?? false,
    // Omitted ⇒ untouched on update (quick edits don't round-trip it); the
    // column defaults to false on create.
    fixedTime: d.fixedTime,
    room: d.room === undefined ? undefined : d.room || null,
    // A meal's provision only means something on a meal.
    mealKind: d.mealKind,
    mealProvision: d.mealKind === null ? null : d.mealProvision,
    presentationId: d.presentationId || null,
  };
}

// A travel item's "where" is its leg (origin/destination), never ScheduleItemSite
// rows — that keeps it out of venue-run grouping and venue engagements. Force
// the site list empty whenever a leg is being set — or (on update) kept: an
// existing leg the input leaves untouched wins over stray locationIds.
function effectiveLocationIds(
  d: ReturnType<typeof scheduleItemSchema.parse>,
  hasExistingLeg = false,
): string[] {
  const isTravel = d.travel !== undefined ? !!d.travel : hasExistingLeg;
  return isTravel ? [] : d.locationIds;
}

export async function addScheduleItem(
  dayId: string,
  input: ScheduleItemInputData,
  // `order` (1-based) puts the item at that exact slot instead of its
  // chronological one — the editor's Undo re-creates a removed item where it
  // was. Clamped to the day's length.
  opts: { order?: number } = {},
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
    const insertAt =
      opts.order != null && Number.isInteger(opts.order)
        ? Math.max(0, Math.min(opts.order - 1, items.length))
        : timedInsertIndex(items, parsed.data.startTime);
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
          create: effectiveLocationIds(parsed.data).map((locationId, i) => ({
            locationId,
            order: i,
          })),
        },
        ...(parsed.data.travel
          ? { travel: { create: travelLegCreateData(parsed.data.travel) } }
          : {}),
      },
    });
  });

  const tripId = await tripIdForDay(dayId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: opts.order != null ? "Item restored." : "Item added." };
}

export async function updateScheduleItem(
  itemId: string,
  input: ScheduleItemInputData,
  // When `cascade` is set, ripple a start/end change through the rest of the day:
  // every later timed item shifts by the delta this item's trailing edge moved,
  // preserving downstream gaps, stopping at the next fixed-time item (see
  // cascadeFromEdit). Opt-in so a planner can still decline it per edit.
  options?: { cascade?: boolean },
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = scheduleItemSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  // Pre-edit times + day are needed to compute the ripple delta before we
  // overwrite; the leg presence feeds the identity check and the travel-wins
  // site handling when the input leaves the leg untouched.
  const existing = await prisma.scheduleItem.findUnique({
    where: { id: itemId },
    select: { dayId: true, travel: { select: { id: true } } },
  });
  if (!existing) return { error: "Item not found." };

  const hasExistingLeg =
    parsed.data.travel === undefined && existing.travel != null;
  const idErr = await identityError(parsed.data, hasExistingLeg);
  if (idErr) return { error: idErr };

  // Replace the location links wholesale (simple + transactional). Reconcile
  // stale item-targeted bookings: null out locationId if the site is unlinked.
  // The toast reports what else moved (the ripple) and which fixed-time item,
  // if any, the save now collides with.
  let shiftNote: string | null = null;
  let overlapNote: string | null = null;
  const item = await prisma.$transaction(async (tx) => {
    // Snapshot the day (with the edited item's OLD times) before mutating, so the
    // ripple measures against pre-edit spacing. Loaded even without a cascade:
    // the edited item's own new times can run into the next anchor.
    const cascade = options?.cascade ?? false;
    const siblings = await tx.scheduleItem.findMany({
      where: { dayId: existing.dayId },
      select: {
        id: true,
        order: true,
        startTime: true,
        endTime: true,
        fixedTime: true,
        title: true,
        category: { select: { name: true } },
        sites: {
          orderBy: { order: "asc" },
          take: 1,
          select: { location: { select: { name: true } } },
        },
      },
    });

    const updated = await tx.scheduleItem.update({
      where: { id: itemId },
      data: {
        ...toItemScalars(parsed.data),
        // Wholesale-replace the per-occurrence speaker override (set semantics).
        presenters: { set: parsed.data.presenterIds.map((id) => ({ id })) },
      },
      select: { day: { select: { tripId: true } } },
    });

    const shifts = cascade
      ? cascadeFromEdit(
          siblings,
          itemId,
          parsed.data.startTime ?? null,
          parsed.data.endTime ?? null,
        )
      : [];
    for (const s of shifts) {
      await tx.scheduleItem.update({
        where: { id: s.id },
        data: { startTime: s.startTime, endTime: s.endTime },
      });
    }
    shiftNote = describeShifts(siblings, shifts);
    // The edited item's own new times count too — it can run into the anchor.
    const hit = fixedTimeOverlaps(siblings, [
      ...shifts,
      {
        id: itemId,
        startTime: parsed.data.startTime ?? null,
        endTime: parsed.data.endTime ?? null,
      },
    ])[0];
    const anchor = hit ? siblings.find((s) => s.id === hit) : null;
    if (anchor) {
      const label =
        anchor.title ||
        anchor.category?.name ||
        anchor.sites[0]?.location.name ||
        "a fixed-time item";
      overlapNote = `Overlaps ${label} ${anchor.startTime}.`;
    }

    // A changed start can leave the item out of sequence; slot it back in.
    await reslotEditedItem(tx, existing.dayId, itemId);

    // Travel leg (GH #80): an object replaces the leg wholesale, null removes
    // it, undefined leaves an existing leg untouched.
    if (parsed.data.travel !== undefined) {
      await tx.travelLeg.deleteMany({ where: { scheduleItemId: itemId } });
      if (parsed.data.travel) {
        await tx.travelLeg.create({
          data: {
            scheduleItemId: itemId,
            ...travelLegCreateData(parsed.data.travel),
          },
        });
      }
    }

    const locationIds = effectiveLocationIds(parsed.data, hasExistingLeg);
    await tx.scheduleItemSite.deleteMany({ where: { scheduleItemId: itemId } });
    if (locationIds.length > 0) {
      await tx.scheduleItemSite.createMany({
        data: locationIds.map((locationId, i) => ({
          scheduleItemId: itemId,
          locationId,
          order: i,
        })),
      });
      // A venue item is covered by its venue engagement: an item booking
      // on it (a site-less booking whose item just gained a venue) folds in.
      await foldSessionBookings(tx, { scheduleItemId: itemId });
    } else {
      // No locations: null all item-targeted bookings' locationId
      await tx.booking.updateMany({
        where: { scheduleItemId: itemId },
        data: { locationId: null },
      });
    }
    return updated;
  });

  revalidateTrip(item.day.tripId);
  return {
    ok: true,
    message: ["Saved.", shiftNote, overlapNote].filter(Boolean).join(" "),
  };
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
  const res = await reorderDayItems(dayId, orderedItemIds);
  if ("error" in res) return { error: res.error };
  revalidateTrip(res.tripId);
  return { ok: true };
}

// Move an item to another day or position (the itinerary's drag, or "Move to
// day…"). `toIndex` is 0-based among the target day's other items; see
// moveItemToDay for how times behave.
export async function moveScheduleItem(
  itemId: string,
  toDayId: string,
  toIndex: number,
): Promise<FormState> {
  await assertRole("PLANNER");
  const res = await moveItemToDay(itemId, toDayId, toIndex);
  if ("error" in res) return { error: res.error };
  revalidateTrip(res.tripId);
  return { ok: true };
}

// Day reflow — "we're running behind": slide a run of timed items by a fixed
// number of minutes (negative = earlier). `fromItemId` scopes it to that item and
// everything ordered after it; omit it to shift the whole day. Untimed items and
// items before the anchor are left alone, and the run stops at the next
// fixed-time item (see shiftDayItems).
export async function shiftDaySchedule(
  dayId: string,
  deltaMinutes: number,
  fromItemId?: string,
): Promise<FormState> {
  await assertRole("PLANNER");
  return slideDayRun(dayId, deltaMinutes, fromItemId, "Shifted");
}

// "Site closed, move on": after an item is removed, pull the next item and
// everything ordered after it earlier by the hole it left (the day view
// offers this from the remove toast; the gap comes from gapAfterRemoval).
// The same slide as shiftDaySchedule — it stops at the next fixed-time item —
// worded as a pull.
export async function pullScheduleForward(
  dayId: string,
  fromItemId: string,
  minutes: number,
): Promise<FormState> {
  await assertRole("PLANNER");
  if (!Number.isInteger(minutes) || minutes <= 0) {
    return { error: "Minutes must be positive." };
  }
  return slideDayRun(dayId, -minutes, fromItemId, "Pulled");
}

// The slide shared by shiftDaySchedule and pullScheduleForward: load the day,
// resolve the start of the run, write the shifts, and report what moved and
// whether a fixed-time item stopped the run or is now overlapped.
async function slideDayRun(
  dayId: string,
  deltaMinutes: number,
  fromItemId: string | undefined,
  verb: "Shifted" | "Pulled",
): Promise<FormState> {
  if (!Number.isInteger(deltaMinutes) || deltaMinutes === 0) {
    return { error: "Minutes must be non-zero." };
  }

  const items = await prisma.scheduleItem.findMany({
    where: { dayId },
    select: {
      id: true,
      order: true,
      startTime: true,
      endTime: true,
      fixedTime: true,
    },
  });
  // The whole day starts at its lowest order (a renumbering race can leave
  // it above 1); a from-item that isn't on this day is a stale reference.
  let fromOrder = items.reduce((min, it) => Math.min(min, it.order), Infinity);
  if (fromItemId) {
    const from = items.find((it) => it.id === fromItemId);
    if (!from) return { error: "Item not on this day." };
    fromOrder = from.order;
  }

  const shifts = shiftDayItems(items, deltaMinutes, fromOrder);
  if (shifts.length === 0) {
    return { error: "No movable timed items to shift." };
  }

  await prisma.$transaction(
    shifts.map((s) =>
      prisma.scheduleItem.update({
        where: { id: s.id },
        data: { startTime: s.startTime, endTime: s.endTime },
      }),
    ),
  );

  const tripId = await tripIdForDay(dayId);
  if (tripId) revalidateTrip(tripId);

  const n = shifts.length;
  const dir = deltaMinutes > 0 ? "later" : "earlier";
  const stopped = items.some(
    (it) => it.fixedTime && it.order > fromOrder,
  );
  const overlaps = fixedTimeOverlaps(items, shifts).length > 0;
  return {
    ok: true,
    message:
      `${verb} ${n} item${n === 1 ? "" : "s"} ${Math.abs(deltaMinutes)} min ${dir}.` +
      (overlaps
        ? " It now overlaps a fixed-time item."
        : stopped
          ? " Stopped at a fixed-time item."
          : ""),
  };
}

// --- Booking CRUD (attached to a schedule item) ---

export type BookingInputData = {
  locationId?: string;
  label?: string;
  // Ignored — the status control / workflow steps own a booking's status.
  status?: string;
  bookedContactId?: string;
  confirmationRef?: string;
  notes?: string;
  bookedOn?: string; // "yyyy-mm-dd"
  agreedCurrency?: string;
  // The itemized agreed price; REPLACES the set when given, omitted = untouched.
  priceLines?: { label?: string; amount: number | string; unit: string }[];
};

function toBookingScalars(d: ReturnType<typeof bookingSchema.parse>) {
  return {
    locationId: d.locationId || null,
    label: d.label || null,
    bookedContactId: d.bookedContactId || null,
    confirmationRef: d.confirmationRef || null,
    notes: d.notes || null,
    bookedOn: d.bookedOn ? parseDateInput(d.bookedOn) : null,
    // Omitted currency keeps the stored one (DB default USD on create).
    ...(d.agreedCurrency ? { agreedCurrency: d.agreedCurrency } : {}),
  };
}

// Nested price-line writes. Create: the lines as given. Update: replace the
// whole set (deleteMany + create run in the update's own transaction), or leave
// it untouched when the input carries no `priceLines` (e.g. the itinerary's
// booking form, which doesn't edit the price).
function priceLinesCreate(d: ReturnType<typeof bookingSchema.parse>) {
  return d.priceLines?.length
    ? { priceLines: { create: priceLineRows(d.priceLines) } }
    : {};
}
function priceLinesReplace(d: ReturnType<typeof bookingSchema.parse>) {
  return d.priceLines
    ? { priceLines: { deleteMany: {}, create: priceLineRows(d.priceLines) } }
    : {};
}

export async function addBooking(
  itemId: string,
  input: BookingInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  // Item bookings are for SITE-LESS items only (a coach, a label-only
  // reservation, a travel leg). A venue item is covered by its (trip, location)
  // engagement — a per-item booking there would double-count the venue.
  const item = await prisma.scheduleItem.findUnique({
    where: { id: itemId },
    select: { _count: { select: { sites: true } } },
  });
  if (!item) return { error: "Item not found." };
  if (item._count.sites > 0) {
    return {
      error:
        "Venue items are booked per venue.",
    };
  }

  await prisma.booking.create({
    data: {
      scheduleItemId: itemId,
      // A new booking starts in the trip's default currency unless told otherwise.
      agreedCurrency: await tripDefaultCurrencyFor({ scheduleItemId: itemId }),
      ...toBookingScalars(parsed.data),
      ...priceLinesCreate(parsed.data),
      ...(await seedWorkflowFor(null)),
    },
  });

  const tripId = await tripIdForItem(itemId);
  if (tripId) revalidateTrip(tripId);
  return { ok: true, message: "Booking added." };
}

// Child site → parent resolver for the engagements being copied (one query):
// an engagement still sitting on a since-reparented child lands on the parent.
async function engagementVenueResolver(
  bookings: { locationId: string | null }[],
): Promise<(locationId: string) => string> {
  const ids = [
    ...new Set(bookings.flatMap((b) => (b.locationId ? [b.locationId] : []))),
  ];
  const locs = ids.length
    ? await prisma.location.findMany({
        where: { id: { in: ids }, bookedViaId: { not: null } },
        select: { id: true, bookedViaId: true },
      })
    : [];
  const map = bookedViaMap(locs);
  return (id) => engagementLocationId(id, map);
}

// Engagements copied without a workflow fall back to the venue's default
// workflow (else the global default) — the template's own choice wins.
async function applyLocationWorkflowDefaults(
  bookings: InstantiatedVenueBooking[],
): Promise<InstantiatedVenueBooking[]> {
  return Promise.all(
    bookings.map(async (b) =>
      b.workflowId ? b : { ...b, ...(await seedWorkflowFor(b.locationId)) },
    ),
  );
}

// Fill each instantiated engagement that carries NO schedule with its location's
// standing terms (GH #86). One batched query for all locations that need one;
// engagements the template already scheduled are left as-is (template wins).
async function applyLocationScheduleDefaults(
  bookings: InstantiatedVenueBooking[],
): Promise<InstantiatedVenueBooking[]> {
  const needing = bookings.filter((b) => !b.paymentSchedule);
  if (!needing.length) return bookings;
  const defaults = await prisma.locationPaymentScheduleItem.findMany({
    where: { locationId: { in: [...new Set(needing.map((b) => b.locationId))] } },
    orderBy: { sortOrder: "asc" },
  });
  if (!defaults.length) return bookings;
  const byLoc = new Map<string, LocationScheduleSeed[]>();
  for (const d of defaults) {
    const arr = byLoc.get(d.locationId) ?? [];
    arr.push(toScheduleSeed(d));
    byLoc.set(d.locationId, arr);
  }
  return bookings.map((b) => {
    if (b.paymentSchedule) return b;
    const seed = byLoc.get(b.locationId);
    return seed ? { ...b, paymentSchedule: { create: seed } } : b;
  });
}

// Create or update the single venue-engagement booking for a (trip, location).
// The engagement auto-covers every schedule item in the trip that visits this
// location plus any stay there — so the booking dashboard upserts by venue rather
// than per session. `locationId` is the engaged venue (forced from the arg, not the
// input). Idempotent on (tripId, locationId) via the @@unique.
// A not-bookable location (walk-by stop) is refused (`assertBookable`).
export async function upsertVenueBooking(
  tripId: string,
  siteId: string,
  input: BookingInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  // A site booked via a parent is covered by the parent's engagement.
  const locationId = await engagementLocationIdFor(siteId);
  const notBookable = await assertBookable(locationId);
  if (notBookable) return { error: notBookable };

  // Status is owned by the status control / workflow steps, never the details
  // form (its rendered status could be stale by save time).
  const detailScalars = { ...toBookingScalars(parsed.data), locationId };
  // Nested create only fires on the create branch of the upsert (an existing
  // engagement's schedule is left untouched), so seeding the location defaults
  // here is safe even when this call ends up updating.
  const schedule = await seedScheduleFromLocation(locationId);
  const workflow = await seedWorkflowFor(locationId);
  await prisma.booking.upsert({
    where: { tripId_locationId: { tripId, locationId } },
    create: {
      tripId,
      agreedCurrency: await tripDefaultCurrencyFor({ tripId }),
      ...detailScalars,
      ...priceLinesCreate(parsed.data),
      ...workflow,
      ...(schedule ? { paymentSchedule: schedule } : {}),
    },
    update: { ...detailScalars, ...priceLinesReplace(parsed.data) },
  });

  revalidateTrip(tripId);
  return { ok: true, message: "Booking saved." };
}

// What a status/workflow control acts on: a venue engagement by (trip,
// location) — created on first touch, seeded like every other create — or an
// existing booking by id (a site-less item booking).
export type BookingTarget =
  | { tripId: string; locationId: string }
  | { bookingId: string };

async function resolveBookingTarget(
  target: BookingTarget,
): Promise<{ error: string } | { bookingId: string; tripId: string | null }> {
  if ("bookingId" in target) {
    return {
      bookingId: target.bookingId,
      tripId: await tripIdForBooking(target.bookingId),
    };
  }
  // An existing engagement is used as-is (even at a since-archived venue);
  // only a first touch goes through the create-time checks + seeding. A site
  // booked via a parent acts on the parent's engagement.
  const locationId = await engagementLocationIdFor(target.locationId);
  const existing = await prisma.booking.findUnique({
    where: {
      tripId_locationId: { tripId: target.tripId, locationId },
    },
    select: { id: true },
  });
  if (existing) return { bookingId: existing.id, tripId: target.tripId };
  const res = await ensureVenueEngagement(target.tripId, locationId);
  if ("error" in res) return res;
  return { bookingId: res.bookingId, tripId: target.tripId };
}

// Set the coarse status directly. On a workflow booking only "Not needed" (and
// leaving it) is manual — the steps own the rest (setBookingStepAction).
export async function setVenueBookingStatus(
  tripId: string,
  locationId: string,
  status: BookingStatus,
): Promise<FormState> {
  return setTargetStatus({ tripId, locationId }, status);
}

export async function setBookingStatus(
  bookingId: string,
  status: BookingStatus,
): Promise<FormState> {
  return setTargetStatus({ bookingId }, status);
}

async function setTargetStatus(
  target: BookingTarget,
  status: BookingStatus,
): Promise<FormState> {
  await assertRole("PLANNER");
  const t = await resolveBookingTarget(target);
  if ("error" in t) return { error: t.error };
  const res = await setBookingStatusDirect(t.bookingId, status);
  if ("error" in res) return { error: res.error };
  if (t.tripId) revalidateTrip(t.tripId);
  return { ok: true, message: "Status updated." };
}

// Tick (or untick) one workflow step on a booking. `completedOn` back-dates it
// ("yyyy-mm-dd"; defaults to today); re-sending a done step just re-dates it.
export async function setBookingStepAction(
  target: BookingTarget,
  stepId: string,
  done: boolean,
  completedOn?: string,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  const on = completedOn ? parseDateInput(completedOn) : todayUtc();
  if (!on) return { error: "Use a real yyyy-mm-dd date." };
  const t = await resolveBookingTarget(target);
  if ("error" in t) return { error: t.error };
  const res = await setBookingStep({
    bookingId: t.bookingId,
    stepId,
    done,
    completedOn: on,
    userId: user.id,
  });
  if ("error" in res) return { error: res.error };
  if (t.tripId) revalidateTrip(t.tripId);
  return { ok: true };
}

// Tick (or untick) a step on several bookings at once — the progress view's
// bulk action ("booking forms went out for all three venues"). Each entry names
// its own step, since the bookings may follow different workflows. Applies what
// it can and reports the rest.
export async function setBookingStepsBulk(
  entries: { target: BookingTarget; stepId: string }[],
  done: boolean,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  const on = todayUtc();
  const tripIds = new Set<string>();
  let updated = 0;
  const failed: string[] = [];
  for (const { target, stepId } of entries) {
    const t = await resolveBookingTarget(target);
    if ("error" in t) {
      failed.push(t.error);
      continue;
    }
    const res = await setBookingStep({
      bookingId: t.bookingId,
      stepId,
      done,
      completedOn: on,
      userId: user.id,
    });
    if ("error" in res) {
      failed.push(res.error);
      continue;
    }
    updated++;
    if (t.tripId) tripIds.add(t.tripId);
  }
  for (const id of tripIds) revalidateTrip(id);
  const msg = `Updated ${updated} booking${updated === 1 ? "" : "s"}.`;
  if (failed.length) {
    return { error: `${msg} ${failed.length} failed: ${[...new Set(failed)].join(" ")}` };
  }
  return { ok: true, message: msg };
}

// Move a booking straight to a workflow stage (the board's drag between step
// columns): ticks `stepId` and clears every later step; null = not started.
export async function setBookingStageAction(
  target: BookingTarget,
  stepId: string | null,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  const t = await resolveBookingTarget(target);
  if ("error" in t) return { error: t.error };
  const res = await setBookingStage({
    bookingId: t.bookingId,
    stepId,
    completedOn: todayUtc(),
    userId: user.id,
  });
  if ("error" in res) return { error: res.error };
  if (t.tripId) revalidateTrip(t.tripId);
  return { ok: true };
}

// Put a booking on another workflow (null = none, status set by hand). Clears
// the old workflow's step completions.
export async function setBookingWorkflowAction(
  target: BookingTarget,
  workflowId: string | null,
): Promise<FormState> {
  await assertRole("PLANNER");
  const t = await resolveBookingTarget(target);
  if ("error" in t) return { error: t.error };
  const res = await setBookingWorkflow(t.bookingId, workflowId);
  if ("error" in res) return { error: res.error };
  if (t.tripId) revalidateTrip(t.tripId);
  return { ok: true, message: "Workflow changed." };
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
  if (!auth) return { error: "Todoist not connected." };

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
    return { error: "Todoist unreachable." };
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

// --- Payment schedule (installments due relative to a selectable anchor; GH #51/#86) ---

export type PaymentScheduleInputData = {
  installments: {
    label?: string;
    percent?: number | string;
    fixedAmount?: number | string;
    anchor?: "EVENT_START" | "BOOKING" | "NONE";
    offsetValue?: number | string;
    offsetUnit?: "DAY" | "WEEK" | "MONTH";
  }[];
};

// Replace the booking's whole schedule in one go (mirrors the REPLACE semantics
// of contact locationIds / presentation defaultPresenterIds): the editor and the
// MCP tool both submit the full installment list, so deletes need no own action.
export async function setPaymentSchedule(
  bookingId: string,
  input: PaymentScheduleInputData,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = paymentScheduleSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const tripId = await tripIdForBooking(bookingId);
  if (!tripId) return { error: "Booking not found." };

  await prisma.$transaction([
    prisma.paymentScheduleItem.deleteMany({ where: { bookingId } }),
    prisma.paymentScheduleItem.createMany({
      data: installmentRows(parsed.data.installments).map((r) => ({
        bookingId,
        ...r,
      })),
    }),
  ]);

  revalidateTrip(tripId);
  return { ok: true, message: "Payment schedule saved." };
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
    data: { ...toBookingScalars(parsed.data), ...priceLinesReplace(parsed.data) },
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
    return "Templates need day numbers, not dates.";
  if (!isTemplate && dayRelative)
    return "Dated trips need dates, not day numbers.";
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

  // A stay has no booking of its own (its booking state is the venue
  // engagement); deleting it cascades only its documents and notes.
  await prisma.stay.delete({ where: { id: stayId } });
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
      return { error: "Host site required." };
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
