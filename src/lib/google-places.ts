// Thin client for Google Places API (New) (https://developers.google.com/maps/documentation/places/web-service/op-overview).
// Pure HTTP — no Prisma. Every call is made server-side with GOOGLE_MAPS_API_KEY
// (restrict it by API to "Places API (New)" in Cloud Console); the key never
// reaches the browser. Field masks are kept minimal to stay on the cheap SKUs:
//   - Autocomplete: free when the session ends in a Place Details call.
//   - Place Details for a picked place: id,location,formattedAddress (Essentials).
//     displayName is deliberately left out — it is a Pro field, and the
//     autocomplete suggestion already carries the name.
//   - ID refresh: id only (the free "IDs Only" SKU).
//   - Backfill Text Search: id,location,displayName,formattedAddress. A human has
//     to recognize the candidate, so the name and address are worth paying for.

const BASE = "https://places.googleapis.com/v1";

export class PlacesError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PlacesError";
  }
}

export function placesApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

export function placesEnabled(): boolean {
  return placesApiKey() != null;
}

export type PlaceSuggestion = {
  placeId: string;
  name: string;
  secondary: string | null;
};

export type PlaceDetails = {
  placeId: string;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
};

async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; fieldMask?: string } = {},
): Promise<T> {
  const key = placesApiKey();
  if (!key) throw new PlacesError("Google Places is not configured.", 0);
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "X-Goog-Api-Key": key,
      ...(init.fieldMask ? { "X-Goog-FieldMask": init.fieldMask } : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PlacesError(
      `Places ${init.method ?? "GET"} ${path.split("?")[0]} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      res.status,
    );
  }
  return (await res.json()) as T;
}

export function toPlaceDetails(raw: RawPlace): PlaceDetails | null {
  if (!raw.id) return null;
  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;
  const hasCoords = typeof lat === "number" && typeof lng === "number";
  return {
    placeId: raw.id,
    name: raw.displayName?.text ?? null,
    address: raw.formattedAddress ?? null,
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
  };
}

// Autocomplete (New). `sessionToken` groups keystrokes with the final Details
// call so Google bills the session once.
export async function autocompletePlaces(
  input: string,
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  const data = await api<{
    suggestions?: {
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
      };
    }[];
  }>("/places:autocomplete", {
    method: "POST",
    body: { input, sessionToken },
    fieldMask:
      "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
  });
  const out: PlaceSuggestion[] = [];
  for (const s of data.suggestions ?? []) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    out.push({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? p.placeId,
      secondary: p.structuredFormat?.secondaryText?.text ?? null,
    });
  }
  return out;
}

// Place Details (New) for a picked suggestion.
export async function getPlaceDetails(
  placeId: string,
  sessionToken?: string,
): Promise<PlaceDetails | null> {
  const qs = sessionToken
    ? `?sessionToken=${encodeURIComponent(sessionToken)}`
    : "";
  const raw = await api<RawPlace>(
    `/places/${encodeURIComponent(placeId)}${qs}`,
    { fieldMask: "id,location,formattedAddress" },
  );
  return toPlaceDetails(raw);
}

// Text Search (New) candidates for the backfill. Never auto-accepted.
export async function searchPlaceCandidates(
  textQuery: string,
  pageSize = 5,
): Promise<PlaceDetails[]> {
  const data = await api<{ places?: RawPlace[] }>("/places:searchText", {
    method: "POST",
    body: { textQuery, pageSize },
    fieldMask:
      "places.id,places.location,places.displayName,places.formattedAddress",
  });
  return (data.places ?? [])
    .map(toPlaceDetails)
    .filter((p): p is PlaceDetails => p != null);
}

export type PlaceIdRefresh =
  | { status: "ok"; placeId: string }
  | { status: "not_found" };

// Re-resolve a stored place ID with the id-only field mask. Google returns the
// current ID for a place whose ID has changed, and 404 NOT_FOUND once a place is
// gone. Anything else (quota, network) throws — the caller retries next run.
export async function refreshPlaceId(placeId: string): Promise<PlaceIdRefresh> {
  try {
    const raw = await api<RawPlace>(`/places/${encodeURIComponent(placeId)}`, {
      fieldMask: "id",
    });
    if (!raw.id) return { status: "not_found" };
    return { status: "ok", placeId: raw.id };
  } catch (err) {
    if (err instanceof PlacesError && err.status === 404) {
      return { status: "not_found" };
    }
    throw err;
  }
}
