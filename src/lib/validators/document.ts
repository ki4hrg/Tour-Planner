import { z } from "zod";

// Document targets mirror Note's: a file attaches to exactly one of these.
export const DOCUMENT_TARGETS = ["location", "booking", "trip", "stay"] as const;
export type DocumentTarget = (typeof DOCUMENT_TARGETS)[number];

// Mirrors the Prisma DocumentKind enum.
export const DOCUMENT_KINDS = [
  "CONTRACT",
  "INVOICE",
  "RECEIPT",
  "ITINERARY",
  "ROSTER",
  "CONFIRMATION",
  "PERMIT",
  "MAP",
  "OTHER",
] as const;
export type DocumentKindValue = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKindValue, string> = {
  CONTRACT: "Contract",
  INVOICE: "Invoice",
  RECEIPT: "Receipt",
  ITINERARY: "Itinerary",
  ROSTER: "Roster",
  CONFIRMATION: "Confirmation",
  PERMIT: "Permit",
  MAP: "Map / plan",
  OTHER: "Other",
};

// Audiences a document may be released to through a share link. STAFF is absent
// deliberately: a STAFF link already sees every document on its trip, so making
// it selectable would only invite the illusion that unticking it hides something.
export const DOCUMENT_SHARE_AUDIENCES = ["PARTICIPANT", "HOST_SITE"] as const;
export type DocumentShareAudience = (typeof DOCUMENT_SHARE_AUDIENCES)[number];

/**
 * Hard ceiling on one upload. Bytes ride through a Server Action, so
 * `serverActions.bodySizeLimit` in next.config.ts must stay comfortably above
 * this (the multipart envelope adds overhead on top of the file itself).
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * What may be stored. An allowlist, not a blocklist: everything here is inert
 * data that browsers won't execute in our origin. Notably absent are `text/html`
 * and `image/svg+xml` — both can carry script, and we serve downloads from the
 * app's own origin.
 */
export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/tiff",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/calendar",
  "application/rtf",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
] as const;

// Fallback when a browser sends nothing useful for a known extension.
export const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  ics: "text/calendar",
  rtf: "application/rtf",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
};

// The editable metadata of a document — everything about a file except its bytes.
export const documentMetaSchema = z.object({
  title: z.string().trim().min(1, "Give the document a title."),
  // An omitted, null, or blank description all mean "no description" — the
  // upload form sends a FormData field that may be any of the three.
  description: z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    z.string().trim().optional(),
  ),
  kind: z.enum(DOCUMENT_KINDS).default("OTHER"),
  shareAudiences: z.array(z.enum(DOCUMENT_SHARE_AUDIENCES)).default([]),
});

export type DocumentMetaInput = z.infer<typeof documentMetaSchema>;
