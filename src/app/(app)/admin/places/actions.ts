"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import type { FormState } from "@/lib/forms";
import {
  placesEnabled,
  searchPlaceCandidates,
  type PlaceDetails,
} from "@/lib/google-places";
import { refreshStalePlaceIds } from "@/lib/place-refresh";

// Backfill: propose Google place candidates for a location. Never auto-accepts —
// a wrong place someone waves through is worse than no place, so a human picks.
export async function findPlaceCandidates(
  locationId: string,
): Promise<{ candidates?: PlaceDetails[]; error?: string }> {
  await assertRole("ADMIN");
  if (!placesEnabled()) return { error: "Google Places is not configured." };
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { name: true, address: true },
  });
  if (!location) return { error: "Location not found." };
  const query = [location.name, location.address].filter(Boolean).join(", ");
  try {
    return { candidates: await searchPlaceCandidates(query) };
  } catch (err) {
    console.error("[places] text search failed:", err);
    return { error: "Google place search failed." };
  }
}

const acceptSchema = z.object({
  locationId: z.string().min(1),
  placeId: z.string().trim().min(1),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  address: z.string().trim().nullable(),
  fillAddress: z.boolean(),
});

// Link a location to the candidate a human confirmed. The address is only ever
// filled when the location has none — never overwritten.
export async function acceptPlaceCandidate(
  input: z.input<typeof acceptSchema>,
): Promise<FormState> {
  await assertRole("ADMIN");
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid place." };
  const d = parsed.data;
  const hasCoords = d.lat != null && d.lng != null;

  const location = await prisma.location.findUnique({
    where: { id: d.locationId },
    select: { address: true },
  });
  if (!location) return { error: "Location not found." };

  await prisma.location.update({
    where: { id: d.locationId },
    data: {
      googlePlaceId: d.placeId,
      ...(hasCoords ? { lat: d.lat, lng: d.lng } : {}),
      ...(d.fillAddress && !location.address && d.address
        ? { address: d.address }
        : {}),
      placeIdCheckedAt: new Date(),
      placeIdNeedsReview: false,
    },
  });
  revalidatePath("/admin/places");
  revalidatePath(`/locations/${d.locationId}`);
  return { ok: true, message: "Linked to Google place." };
}

// Settle a "Google dropped this place" flag without re-linking (e.g. the venue
// closed, or the coordinates alone are good enough).
export async function dismissPlaceReview(locationId: string): Promise<FormState> {
  await assertRole("ADMIN");
  await prisma.location.update({
    where: { id: locationId },
    data: { placeIdNeedsReview: false },
  });
  revalidatePath("/admin/places");
  return { ok: true, message: "Review cleared." };
}

// Run the yearly place-ID refresh now instead of waiting for the daily timer.
export async function refreshPlaceIdsNow(): Promise<FormState> {
  await assertRole("ADMIN");
  if (!placesEnabled()) return { error: "Google Places is not configured." };
  const s = await refreshStalePlaceIds();
  revalidatePath("/admin/places");
  if (s.checked === 0 && s.failed === 0) {
    return { ok: true, message: "No place IDs due for refresh." };
  }
  return {
    ok: s.failed === 0,
    ...(s.failed ? { error: `${s.failed} refresh call(s) failed; see server logs.` } : {}),
    message: `Checked ${s.checked}: ${s.changed} changed, ${s.notFound} no longer on Google.`,
  };
}
