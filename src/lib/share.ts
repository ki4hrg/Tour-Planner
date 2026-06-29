import type { ShareAudience } from "@prisma/client";
import type { SerializedDay } from "@/lib/trips";

// What each share audience is allowed to see. The trip overview, booking and
// cost views stay staff-only (authed app); a share link only ever exposes the
// itinerary, narrowed by audience.
export type AudienceView = {
  // Booking pills (status / who / ref) on each item.
  showBookings: boolean;
  // Day-level *logistical* notes — internal staff logistics. (Participant notes
  // are always shown; they're written for the group.)
  showLogisticalNotes: boolean;
  // Where the group sleeps each night.
  showLodging: boolean;
  // Restrict the itinerary to a single host site's items (set on the link).
  scopeToLocation: boolean;
};

export const SHARE_AUDIENCE_LABELS: Record<ShareAudience, string> = {
  STAFF: "Staff",
  PARTICIPANT: "Participant",
  HOST_SITE: "Host site",
};

// One-line description of what each audience link reveals — shown in the manager.
export const SHARE_AUDIENCE_BLURBS: Record<ShareAudience, string> = {
  STAFF: "Full itinerary: bookings, lodging, and internal logistics.",
  PARTICIPANT: "Day-by-day schedule and lodging. No bookings or internal notes.",
  HOST_SITE: "Only this host site's items and their booking status.",
};

export const SHARE_AUDIENCES = Object.keys(
  SHARE_AUDIENCE_LABELS,
) as ShareAudience[];

/** The visibility preset for an audience. Per-link `fieldOverrides` (future) tweak
 * this; today it's a pure function of the audience. */
export function audienceView(audience: ShareAudience): AudienceView {
  switch (audience) {
    case "STAFF":
      return {
        showBookings: true,
        showLogisticalNotes: true,
        showLodging: true,
        scopeToLocation: false,
      };
    case "HOST_SITE":
      return {
        showBookings: true,
        showLogisticalNotes: false,
        showLodging: true,
        scopeToLocation: true,
      };
    case "PARTICIPANT":
    default:
      return {
        showBookings: false,
        showLogisticalNotes: false,
        showLodging: true,
        scopeToLocation: false,
      };
  }
}

/** Keep only items that visit `locationId`, dropping days left with none. Scopes
 * a HOST_SITE link to one site's schedule. */
export function scopeDaysToLocation(
  days: SerializedDay[],
  locationId: string,
): SerializedDay[] {
  return days
    .map((d) => ({
      ...d,
      items: d.items.filter((i) =>
        i.sites.some((s) => s.locationId === locationId),
      ),
    }))
    .filter((d) => d.items.length > 0);
}

/** Strip data the audience must not receive *before* it reaches the client — not
 * just hide it at render. Booking rows ride along in the RSC payload (and would be
 * view-source visible on a public link) unless removed here. Drops bookings for
 * audiences that don't see them; for a host-site link, keeps only bookings tied to
 * that site (or unscoped). */
export function redactDaysForShare(
  days: SerializedDay[],
  view: AudienceView,
  locationId: string | null,
): SerializedDay[] {
  if (view.showBookings && !view.scopeToLocation) return days;
  return days.map((d) => ({
    ...d,
    items: d.items.map((it) => {
      let bookings = it.bookings;
      if (!view.showBookings) {
        bookings = [];
      } else if (view.scopeToLocation && locationId) {
        bookings = bookings.filter(
          (b) => b.locationId == null || b.locationId === locationId,
        );
      }
      return bookings === it.bookings ? it : { ...it, bookings };
    }),
  }));
}

/** Whether a share link is currently usable (enabled and not past its expiry).
 * Expiry is date-granular: a link stays valid *through* its expiry date, so pass
 * `todayUtc()` as `now`. Injected so render stays pure. */
export function isShareLinkActive(
  link: { enabled: boolean; expiresAt: Date | null },
  now: Date,
): boolean {
  if (!link.enabled) return false;
  if (link.expiresAt && now.getTime() > link.expiresAt.getTime()) return false;
  return true;
}
