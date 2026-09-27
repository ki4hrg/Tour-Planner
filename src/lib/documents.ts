import type { DocumentKind, ShareAudience } from "@prisma/client";
import {
  ALLOWED_CONTENT_TYPES,
  EXTENSION_CONTENT_TYPES,
  type DocumentKindValue,
  type DocumentShareAudience,
} from "./validators/document";

export type SerializedDocument = {
  id: string;
  title: string;
  description: string | null;
  kind: DocumentKind;
  filename: string;
  contentType: string;
  size: number;
  shareAudiences: DocumentShareAudience[];
  uploadedBy: { id: string; name: string } | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
};

type DocumentRow = {
  id: string;
  title: string;
  description: string | null;
  kind: DocumentKind;
  filename: string;
  contentType: string;
  size: number;
  shareAudiences: ShareAudience[];
  createdAt: Date;
  updatedAt: Date;
  uploadedBy?: { id: string; name: string | null } | null;
};

/** Everything a document listing needs — and pointedly NOT `blob`. */
export const DOCUMENT_SELECT = {
  id: true,
  title: true,
  description: true,
  kind: true,
  filename: true,
  contentType: true,
  size: true,
  shareAudiences: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;

// Dates never cross to a Client Component raw — flatten here (see the Decimal /
// Date boundary rule in CLAUDE.md).
export function serializeDocument(doc: DocumentRow): SerializedDocument {
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    kind: doc.kind,
    filename: doc.filename,
    contentType: doc.contentType,
    size: doc.size,
    // STAFF is never stored (a staff link sees everything), so this narrowing
    // is total in practice; filter defensively rather than cast.
    shareAudiences: doc.shareAudiences.filter(
      (a): a is DocumentShareAudience => a !== "STAFF",
    ),
    uploadedBy: doc.uploadedBy
      ? { id: doc.uploadedBy.id, name: doc.uploadedBy.name ?? "Unknown" }
      : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Reduce an uploaded name to something safe to echo back in a
 * `Content-Disposition` header and to show in a list: no directory components,
 * no control characters, no leading dots, bounded length.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\x00-\x1f\x7f"]/g, "")
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned) return "file";
  return cleaned.length > 200 ? cleaned.slice(-200) : cleaned;
}

/** The lowercased extension of a filename, without the dot. */
export function fileExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Decide what content type to store. Browsers lie by omission — dragging a .docx
 * in some browsers yields `application/octet-stream` — so fall back to the
 * extension before giving up. Returns null when we don't accept the file.
 */
export function resolveContentType(
  reported: string | null | undefined,
  filename: string,
): string | null {
  const normalized = (reported ?? "").split(";")[0].trim().toLowerCase();
  const allowed: readonly string[] = ALLOWED_CONTENT_TYPES;
  if (allowed.includes(normalized)) return normalized;
  const byExtension = EXTENSION_CONTENT_TYPES[fileExtension(filename)];
  return byExtension ?? null;
}

/** "1.4 MB" — sized for a list row, not an audit. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Which files a browser may render in place rather than download. Kept to
 * formats that are inert without scripting; everything else is an attachment.
 * Inline responses are additionally sandboxed by the download route.
 */
export function isInlineViewable(contentType: string): boolean {
  return (
    contentType === "application/pdf" ||
    contentType === "text/plain" ||
    (contentType.startsWith("image/") && contentType !== "image/svg+xml")
  );
}

/**
 * A `Content-Disposition` value that survives non-ASCII names: a stripped
 * `filename` for old clients plus the RFC 5987 `filename*` everyone else reads.
 */
export function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * May this document be downloaded through a share link for `audience`?
 * A STAFF link is the authenticated view in disguise and sees everything on its
 * trip; PARTICIPANT / HOST_SITE see only what was explicitly released to them.
 */
export function visibleToShareAudience(
  doc: { shareAudiences: readonly ShareAudience[] },
  audience: ShareAudience,
): boolean {
  if (audience === "STAFF") return true;
  return doc.shareAudiences.includes(audience);
}

export function filterDocumentsForShare<
  T extends { shareAudiences: readonly ShareAudience[] },
>(docs: readonly T[], audience: ShareAudience): T[] {
  return docs.filter((d) => visibleToShareAudience(d, audience));
}

// The relations a document row needs loaded to resolve its target link below.
export type DocumentTargetRow = {
  location: { id: string; name: string } | null;
  booking: {
    label: string | null;
    // `locationId` lets an engagement document deep-link to its venue row on
    // the booking dashboard; optional so a caller that doesn't select it still
    // gets the plain dashboard link.
    locationId?: string | null;
    location: { name: string } | null;
    trip: { id: string; name: string } | null;
    scheduleItem: { day: { trip: { id: string; name: string } } } | null;
  } | null;
  trip: { id: string; name: string } | null;
  stay: {
    // Optional for the same reason — without it the link lands on the trip page
    // rather than the stay's anchor in the Lodging panel.
    id?: string;
    trip: { id: string; name: string };
    location: { name: string };
  } | null;
};

/**
 * Where a document "lives": a human label plus the page that shows it. A
 * document targets exactly one of location / booking / trip / stay (DB CHECK),
 * so the first match wins. Mirrors `noteTarget` — booking documents land on the
 * trip's booking dashboard (scrolled to the venue for an engagement), stay
 * documents on the stay's anchor in the trip page's Lodging panel.
 */
export function documentTarget(doc: DocumentTargetRow): {
  label: string;
  href: string;
} {
  if (doc.location) {
    return { label: doc.location.name, href: `/locations/${doc.location.id}` };
  }
  if (doc.booking) {
    const trip = doc.booking.trip ?? doc.booking.scheduleItem?.day.trip ?? null;
    const what = doc.booking.location?.name ?? doc.booking.label ?? "Booking";
    const venue = doc.booking.trip ? doc.booking.locationId : null;
    return {
      label: trip ? `${what} — ${trip.name}` : what,
      href: trip ? bookingDashboardHref(trip.id, venue) : "/trips",
    };
  }
  if (doc.trip) {
    return { label: doc.trip.name, href: `/trips/${doc.trip.id}` };
  }
  if (doc.stay) {
    return {
      label: `${doc.stay.location.name} — ${doc.stay.trip.name}`,
      href: doc.stay.id
        ? stayHref(doc.stay.trip.id, doc.stay.id)
        : `/trips/${doc.stay.trip.id}`,
    };
  }
  return { label: "Document", href: "/" };
}

/** The booking dashboard, optionally focused on one venue engagement's row. */
export function bookingDashboardHref(
  tripId: string,
  venueLocationId?: string | null,
): string {
  return venueLocationId
    ? `/trips/${tripId}/booking?venue=${encodeURIComponent(venueLocationId)}`
    : `/trips/${tripId}/booking`;
}

/** A stay's anchor in the trip page's Lodging panel. */
export function stayHref(tripId: string, stayId: string): string {
  return `/trips/${tripId}#stay-${stayId}`;
}

// --- Where a file belongs, and who a release actually reaches ---------------

/**
 * What an upload is being filed against, as far as the UI needs to know. The
 * venue name distinguishes a venue engagement (named) from a site-less item
 * booking (`null`); `undefined` means the caller didn't say, and the copy falls
 * back to wording that is true of both.
 */
export type DocumentShareContext =
  | { target: "trip" }
  | { target: "location"; venueName?: string }
  | { target: "booking"; venueName?: string | null }
  | { target: "stay"; venueName?: string };

/** The kind a new upload starts as, by target — the planner can still change it. */
export function defaultKindForTarget(
  target: DocumentShareContext["target"],
): DocumentKindValue {
  switch (target) {
    case "booking":
      return "CONTRACT";
    case "trip":
      return "ITINERARY";
    case "stay":
      // Rooming lists and arrival sheets; the hotel's confirmation belongs on
      // the venue engagement, since a stay has no booking of its own.
      return "ROSTER";
    case "location":
      return "OTHER";
  }
}

export type ShareAudienceOption = {
  audience: DocumentShareAudience;
  label: string;
  // Who the release actually reaches — worded from `shareDocumentWhere`.
  hint: string;
};

/**
 * The release checkboxes that mean something for a target, labelled with who
 * they really reach. Mirrors the scope rules in `src/lib/share-documents.ts`:
 *
 *  - Participant links reach trip, booking and stay files on their trip, but
 *    never venue (location) files — those are global across trips.
 *  - A host-site link is scoped to one venue: it reaches that venue's own files
 *    (on any trip's link for it), the engagement + stays there, and EVERY
 *    trip-level file. It never reaches a site-less item booking.
 */
export function shareAudienceOptions(
  ctx: DocumentShareContext,
): ShareAudienceOption[] {
  const participants: ShareAudienceOption = {
    audience: "PARTICIPANT",
    label: "Participants",
    hint: "All participant links",
  };
  switch (ctx.target) {
    case "trip":
      return [
        participants,
        {
          audience: "HOST_SITE",
          label: "All host sites",
          hint: "Every venue's link",
        },
      ];
    case "location":
      return [
        {
          audience: "HOST_SITE",
          label: "This venue's host site",
          hint: "Any trip",
        },
      ];
    case "booking":
      if (ctx.venueName === null) return [participants];
      return [
        participants,
        {
          audience: "HOST_SITE",
          label: "This venue's host site",
          hint: "This trip",
        },
      ];
    case "stay":
      return [
        participants,
        {
          audience: "HOST_SITE",
          label: "This venue's host site",
          hint: "This trip",
        },
      ];
  }
}

/**
 * The compact per-row release badge. Only audiences that actually reach the file
 * count — a stale Participant tick on a venue file shows as "Staff only",
 * because that is what it is.
 */
export function shareBadgeLabel(
  audiences: readonly DocumentShareAudience[],
  ctx: DocumentShareContext,
): string {
  const reachable = new Set(shareAudienceOptions(ctx).map((o) => o.audience));
  const effective = audiences.filter((a) => reachable.has(a));
  if (effective.length === 0) return "Staff only";
  return effective
    .map((a) => (a === "PARTICIPANT" ? "Participants" : "Host sites"))
    .join(" + ");
}

/**
 * The response shape both download routes return.
 *
 * Uploads are user-supplied bytes served from the app's own origin, so they are
 * locked down: `nosniff` stops a browser second-guessing the declared type, and
 * the sandbox CSP neutralizes anything scriptable that slips past the upload
 * allowlist (a PDF with embedded JS, say) by denying it an origin to act in.
 */
export function documentResponse(
  bytes: Uint8Array,
  opts: { contentType: string; filename: string; inline: boolean },
): Response {
  // Copy into a standalone buffer — a Buffer view can be a window onto a larger
  // pooled allocation, which would leak neighbouring bytes into the response.
  const body = Uint8Array.from(bytes);
  return new Response(body, {
    headers: {
      "Content-Type": opts.contentType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": contentDisposition(opts.filename, opts.inline),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Private data: never let a shared cache hold on to it.
      "Cache-Control": "private, no-store",
    },
  });
}

/** The authenticated download URL for a document. */
export function documentHref(id: string, inline = false): string {
  return `/api/documents/${id}${inline ? "?inline=1" : ""}`;
}

/** The share-link download URL — the only way an outside audience reaches bytes. */
export function shareDocumentHref(
  token: string,
  id: string,
  inline = false,
): string {
  return `/api/share/${token}/documents/${id}${inline ? "?inline=1" : ""}`;
}
