import type { DocumentKind, ShareAudience } from "@prisma/client";
import {
  ALLOWED_CONTENT_TYPES,
  EXTENSION_CONTENT_TYPES,
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
    location: { name: string } | null;
    trip: { id: string; name: string } | null;
    scheduleItem: { day: { trip: { id: string; name: string } } } | null;
  } | null;
  trip: { id: string; name: string } | null;
  stay: {
    trip: { id: string; name: string };
    location: { name: string };
  } | null;
};

/**
 * Where a document "lives": a human label plus the page that shows it. A
 * document targets exactly one of location / booking / trip / stay (DB CHECK),
 * so the first match wins. Mirrors `noteTarget` — booking documents land on the
 * trip's booking dashboard, stay documents on the trip page's Lodging panel.
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
    return {
      label: trip ? `${what} — ${trip.name}` : what,
      href: trip ? `/trips/${trip.id}/booking` : "/trips",
    };
  }
  if (doc.trip) {
    return { label: doc.trip.name, href: `/trips/${doc.trip.id}` };
  }
  if (doc.stay) {
    return {
      label: `${doc.stay.location.name} — ${doc.stay.trip.name}`,
      href: `/trips/${doc.stay.trip.id}`,
    };
  }
  return { label: "Document", href: "/" };
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
