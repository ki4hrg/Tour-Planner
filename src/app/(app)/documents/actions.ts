"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { zodErrorMessage, type FormState } from "@/lib/forms";
import { formatFileSize, resolveContentType, sanitizeFilename } from "@/lib/documents";
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

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      error: `That file is ${formatFileSize(file.size)} — the limit is ${formatFileSize(MAX_DOCUMENT_BYTES)}.`,
    };
  }

  const filename = sanitizeFilename(file.name);
  const contentType = resolveContentType(file.type, filename);
  if (!contentType) {
    return {
      error:
        "That file type isn't accepted. Upload a PDF, image, office document, or plain text file.",
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
    return { error: "That file is too large." };
  }

  await prisma.document.create({
    data: {
      ...parsed.data,
      description: parsed.data.description ?? null,
      filename,
      contentType,
      size: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      [targetColumn(target)]: targetId,
      uploadedById: user.id,
      blob: { create: { bytes } },
    },
  });

  await revalidateForTarget(target, targetId);
  return { ok: true, message: `Uploaded ${filename}.` };
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
