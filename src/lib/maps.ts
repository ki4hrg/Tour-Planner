// One-tap "open in maps" targets. Prefers the curated mapUrl (often a pinned
// Google Maps share link); falls back to a maps search on name + address so any
// addressed location is navigable. Returns null when there's nothing to link.
export function mapHref(location: {
  name?: string | null;
  address?: string | null;
  mapUrl?: string | null;
}): string | null {
  if (location.mapUrl) return location.mapUrl;
  const query = [location.name, location.address].filter(Boolean).join(", ");
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
