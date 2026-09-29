const SEARCH = "https://www.google.com/maps/search/?api=1&query=";

// One-tap "open in maps" targets, most precise first:
//   1. the curated mapUrl (often a pinned Google Maps share link);
//   2. the linked Google place — a search that resolves to that exact place;
//   3. the stored coordinates;
//   4. a search on name + address, so any addressed location is navigable.
// Derived links (2–4) all keep the `…/search/?api=1&query=` form: the WordPress
// plugin treats that prefix as "derived" and uses its own place data instead.
// Returns null when there's nothing to link.
export function mapHref(location: {
  name?: string | null;
  address?: string | null;
  mapUrl?: string | null;
  googlePlaceId?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string | null {
  if (location.mapUrl) return location.mapUrl;
  const query = [location.name, location.address].filter(Boolean).join(", ");
  if (location.googlePlaceId) {
    // `query` is required alongside query_place_id; Google falls back to it only
    // if the ID can't be resolved.
    return `${SEARCH}${encodeURIComponent(location.name || query || location.googlePlaceId)}&query_place_id=${encodeURIComponent(location.googlePlaceId)}`;
  }
  if (location.lat != null && location.lng != null) {
    return `${SEARCH}${location.lat},${location.lng}`;
  }
  if (!query) return null;
  return `${SEARCH}${encodeURIComponent(query)}`;
}

// The Google Maps page for a linked place, for the "Linked to Google place"
// indicator. Same URL shape as mapHref's place-ID branch, minus the mapUrl
// override, so it always opens the linked place itself.
export function googlePlaceHref(name: string | null | undefined, placeId: string): string {
  return mapHref({ name, googlePlaceId: placeId })!;
}
