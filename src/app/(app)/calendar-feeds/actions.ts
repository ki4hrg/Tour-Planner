"use server";

import { revalidatePath } from "next/cache";
import type { CalendarFeedScope } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState } from "@/lib/forms";

// Revalidate the page the feed's manager lives on, so a new/changed feed shows up.
function revalidateForScope(scope: CalendarFeedScope, ids: { tripId?: string | null; tripTypeId?: string | null }) {
  if (scope === "TRIP" && ids.tripId) revalidatePath(`/trips/${ids.tripId}`);
  else if (scope === "TRIP_TYPE" && ids.tripTypeId)
    revalidatePath(`/trip-types/${ids.tripTypeId}`);
  else if (scope === "ALL") revalidatePath("/settings");
}

export async function createCalendarFeed(input: {
  scope: CalendarFeedScope;
  tripId?: string;
  tripTypeId?: string;
  label?: string;
}): Promise<FormState> {
  const user = await assertRole("PLANNER");

  // Enforce the scope ↔ target agreement the DB CHECK also guards.
  const tripId = input.scope === "TRIP" ? input.tripId : undefined;
  const tripTypeId = input.scope === "TRIP_TYPE" ? input.tripTypeId : undefined;
  if (input.scope === "TRIP" && !tripId) return { error: "Missing trip." };
  if (input.scope === "TRIP_TYPE" && !tripTypeId)
    return { error: "Missing trip type." };

  await prisma.calendarFeed.create({
    data: {
      scope: input.scope,
      tripId: tripId ?? null,
      tripTypeId: tripTypeId ?? null,
      label: input.label?.trim() || null,
      createdById: user.id,
    },
  });

  revalidateForScope(input.scope, { tripId, tripTypeId });
  return { ok: true, message: "Feed created." };
}

export async function setCalendarFeedEnabled(
  id: string,
  enabled: boolean,
): Promise<FormState> {
  await assertRole("PLANNER");
  const feed = await prisma.calendarFeed.update({
    where: { id },
    data: { enabled },
    select: { scope: true, tripId: true, tripTypeId: true },
  });
  revalidateForScope(feed.scope, feed);
  return { ok: true, message: enabled ? "Feed enabled." : "Feed disabled." };
}

export async function deleteCalendarFeed(id: string): Promise<FormState> {
  await assertRole("PLANNER");
  const feed = await prisma.calendarFeed.findUnique({
    where: { id },
    select: { scope: true, tripId: true, tripTypeId: true },
  });
  if (!feed) return { error: "Feed not found." };
  await prisma.calendarFeed.delete({ where: { id } });
  revalidateForScope(feed.scope, feed);
  return { ok: true, message: "Feed deleted." };
}
