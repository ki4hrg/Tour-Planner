"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { zodErrorMessage, type FormState } from "@/lib/forms";
import { formatFileSize, resolveContentType, sanitizeFilename } from "@/lib/documents";
import { ensureVenueEngagement } from "@/lib/trip-mutations";
import {
  documentMetaSchema,
  MAX_DOCUMENT_BYTES,
  type DocumentMetaInput,
  type DocumentTarget,
} from "@/lib/validators/document";

// Map a polymorphic target to its FK column (mirrors the notes actions).
function targetColumn(
  target: DocumentTarget,
): "locationId" | "bookingId" | "tripId" | "stayId" {
  return `${target}Id` as const;
}

// Revalidate the page(s) that show a document, given its target.
async function revalidateForTarget(
  target: DocumentTarget,
  targetId: string,
): Promise<void> {
  revalidatePath("/documents");
  if (target === "location") {
    revalidatePath(`/locations/${targetId}`);
    return;
  }
  if (target === "trip") {
    revalidatePath(`/trips/${targetId}`);
    return;
  }
  // booking | stay — resolve the owning trip, then revalidate where it shows.
  let tripId: string | null | undefined;
  if (target === "stay") {
    tripId = (
      await prisma.stay.findUnique({
        where: { id: targetId },
        select: { tripId: true },
      })
    )?.tripId;
  } else {
    const b = await prisma.booking.findUnique({
      where: { id: targetId },
      select: {
        tripId: true,
        scheduleItem: { select: { day: { select: { tripId: true } } } },
      },
    });
    tripId = b?.tripId ?? b?.scheduleItem?.day.tripId;
  }
  if (tripId) {
    revalidatePath(`/trips/${tripId}`);
    revalidatePath(`/trips/${tripId}/booking`);
  }
}

// Resolve a document's target from its FK columns and revalidate.
async function revalidateAfterMutation(doc: {
  locationId: string | null;
  bookingId: string | null;
  tripId: string | null;
  stayId: string | null;
}): Promise<void> {
  if (doc.locationId) return revalidateForTarget("location", doc.locationId);
  if (doc.tripId) return revalidateForTarget("trip", doc.tripId);
  if (doc.bookingId) return revalidateForTarget("booking", doc.bookingId);
  if (doc.stayId) return revalidateForTarget("stay", doc.stayId);
}

// A validated upload, ready to store. Parsing is split from storing so a caller
// that must create the target first (a venue engagement) can reject a bad file
// before touching anything.
type ParsedUpload = {
  meta: DocumentMetaInput;
  filename: string;
  contentType: string;
  bytes: Buffer<ArrayBuffer>;
};

async function parseUpload(
  formData: FormData,
): Promise<{ upload: ParsedUpload } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No file chosen." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      error: `File too large (${formatFileSize(file.size)}; max ${formatFileSize(MAX_DOCUMENT_BYTES)}).`,
    };
  }

  const filename = sanitizeFilename(file.name);
  const contentType = resolveContentType(file.type, filename);
  if (!contentType) {
    return {
      error: "File type not allowed. Use PDF, image, Office or text.",
    };
  }

  const parsed = documentMetaSchema.safeParse({
    // An empty title falls back to the filename — the common case is "just
    // stash this PDF", and making people retype the name earns nothing.
    title: (formData.get("title") as string)?.trim() || filename,
    description: formData.get("description"),
    kind: formData.get("kind") ?? "OTHER",
    shareAudiences: formData.getAll("shareAudiences"),
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return { error: "File too large." };
  }
  return { upload: { meta: parsed.data, filename, contentType, bytes } };
}

async function storeUpload(
  target: DocumentTarget,
  targetId: string,
  upload: ParsedUpload,
  userId: string,
): Promise<FormState> {
  const { meta, filename, contentType, bytes } = upload;
  await prisma.document.create({
    data: {
      ...meta,
      description: meta.description ?? null,
      filename,
      contentType,
      size: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      [targetColumn(target)]: targetId,
      uploadedById: userId,
      blob: { create: { bytes } },
    },
  });

  await revalidateForTarget(target, targetId);
  return { ok: true, message: `Uploaded ${filename}.` };
}

/**
 * Store an uploaded file against a trip / booking / location / stay.
 *
 * Takes FormData (not a typed arg) because a File only survives the Server
 * Action boundary inside one. The bytes ride through the action body, so
 * `serverActions.bodySizeLimit` in next.config.ts caps the request a little
 * above MAX_DOCUMENT_BYTES; we re-check the real length here because that limit
 * covers the whole multipart envelope, not the file.
 */
export async function uploadDocument(
  target: DocumentTarget,
  targetId: string,
  formData: FormData,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  const res = await parseUpload(formData);
  if ("error" in res) return { error: res.error };
  return storeUpload(target, targetId, res.upload, user.id);
}

/**
 * File a document against a trip's engagement with a venue, creating the
 * `(trip, location)` booking first if the trip hasn't got one yet — so a
 * contract can be attached before anyone has touched the booking dashboard.
 *
 * Creation goes through `ensureVenueEngagement` rather than a bare
 * `prisma.booking.create`, so the new engagement gets the same bookable check
 * and standing-payment-terms seeding (GH #86) as the dashboard's own create
 * path, refuses a missing trip or an archived location, and tolerates a
 * concurrent first create (P2002 → re-read). It is create-only, so it never
 * touches an existing booking.
 */
export async function uploadVenueEngagementDocument(
  tripId: string,
  locationId: string,
  formData: FormData,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  // Validate the file before creating anything, so a rejected upload never
  // leaves an empty engagement behind.
  const res = await parseUpload(formData);
  if ("error" in res) return { error: res.error };

  const booking = await ensureVenueEngagement(tripId, locationId);
  if ("error" in booking) return booking;

  // A booking target revalidates the trip page, its booking dashboard and the
  // library.
  return storeUpload("booking", booking.bookingId, res.upload, user.id);
}

/** Edit a document's metadata. The bytes are immutable — re-upload to replace. */
export async function updateDocument(
  documentId: string,
  input: DocumentMetaInput,
): Promise<FormState> {
  await assertRole("PLANNER");
  const parsed = documentMetaSchema.safeParse(input);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const doc = await prisma.document.update({
    where: { id: documentId },
    data: { ...parsed.data, description: parsed.data.description ?? null },
    select: {
      locationId: true,
      bookingId: true,
      tripId: true,
      stayId: true,
    },
  });

  await revalidateAfterMutation(doc);
  return { ok: true, message: "Document saved." };
}

/** Delete a document. The blob cascades with it. */
export async function deleteDocument(documentId: string): Promise<FormState> {
  await assertRole("PLANNER");
  const doc = await prisma.document.delete({
    where: { id: documentId },
    select: {
      filename: true,
      locationId: true,
      bookingId: true,
      tripId: true,
      stayId: true,
    },
  });
  await revalidateAfterMutation(doc);
  return { ok: true, message: `Deleted ${doc.filename}.` };
}
