"use server";

import { assertRole } from "@/lib/authz";
import {
  autocompletePlaces,
  getPlaceDetails,
  placesEnabled,
  type PlaceDetails,
  type PlaceSuggestion,
} from "@/lib/google-places";

// Server-side proxy for the location form's Google place picker, so the API key
// never reaches the browser. Direct-call actions (typed args); failures come
// back as `error` rather than throwing, since a Places outage must never break
// the form.

export async function searchGooglePlaces(
  input: string,
  sessionToken: string,
): Promise<{ suggestions?: PlaceSuggestion[]; error?: string }> {
  await assertRole("PLANNER");
  if (!placesEnabled()) return { error: "Google Places is not configured." };
  const q = input.trim();
  if (q.length < 2) return { suggestions: [] };
  try {
    return { suggestions: await autocompletePlaces(q.slice(0, 200), sessionToken) };
  } catch (err) {
    console.error("[places] autocomplete failed:", err);
    return { error: "Google place search failed." };
  }
}

export async function getGooglePlace(
  placeId: string,
  sessionToken: string,
): Promise<{ place?: PlaceDetails; error?: string }> {
  await assertRole("PLANNER");
  if (!placesEnabled()) return { error: "Google Places is not configured." };
  try {
    const place = await getPlaceDetails(placeId, sessionToken);
    return place ? { place } : { error: "Google returned no details for that place." };
  } catch (err) {
    console.error("[places] details failed:", err);
    return { error: "Couldn't load that Google place." };
  }
}
