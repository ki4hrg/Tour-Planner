// Merge a duplicate Contact (the SOURCE) into the one being kept (the TARGET).
// Every reference to the source is repointed at the target, then the source is
// deleted — all in one transaction. The target's own values win; the source
// only fills gaps (`mergeContactFields`, pure + unit-tested).
//
// References (every relation on `model Contact`):
// - locations (implicit m2m "ContactToLocation") — unioned; a venue both were
//   linked to ends with one link.
// - primaryForLocations (Location.primaryContactId) — repointed. The source's
//   venues are linked to the target first, so "the primary is one of the
//   linked contacts" still holds.
// - bookings "BookedBy" (Booking.bookedContactId) — repointed.
// - presentedItems (implicit m2m "Presenting") — unioned.
// - presentationDefaults (implicit m2m "PresentationDefaults") — unioned.
// - noteEntries (Note.contactId) — repointed.
// When a new relation to Contact is added, repoint it here or the delete's
// SetNull / m2m cascade silently drops it.
//
// No revalidatePath here — MCP-safe; web callers revalidate themselves.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { joinText } from "./location-merge";

export type MergeableContactFields = {
  name: string;
  organization: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

// Target wins; the source fills empty fields; notes concatenate. A source
// email/phone that differs from the target's (and so can't fill a gap) is
// kept as an "Also:" line in the notes rather than dropped.
export function mergeContactFields(
  target: MergeableContactFields,
  source: MergeableContactFields,
): MergeableContactFields {
  const email = target.email?.trim() || source.email?.trim() || null;
  const phone = target.phone?.trim() || source.phone?.trim() || null;
  const alternates = [
    source.email?.trim() && email && !same(source.email, email)
      ? source.email.trim()
      : null,
    source.phone?.trim() && phone && !same(source.phone, phone)
      ? source.phone.trim()
      : null,
  ].filter((v): v is string => !!v);
  const notes = joinText(
    joinText(target.notes, source.notes),
    alternates.length ? `Also: ${alternates.join(", ")}` : null,
  );
  return {
    name: target.name,
    organization: target.organization?.trim() || source.organization?.trim() || null,
    role: target.role?.trim() || source.role?.trim() || null,
    email,
    phone,
    notes,
  };
}

// What a merge would move — shown before confirming (UI, MCP dryRun).
export type ContactMergePreview = {
  source: { id: string; name: string };
  target: { id: string; name: string };
  // Venues linked to the source but not yet the target (new links).
  locations: number;
  // Venues where the source is the primary contact.
  primaryFor: number;
  bookings: number;
  notes: number;
  // Itinerary items the source presents at that the target doesn't yet.
  presentedItems: number;
  // Presentations the source is a default speaker for that the target isn't.
  presentationDefaults: number;
};

export class ContactMergeError extends Error {}

type Db = Prisma.TransactionClient | typeof prisma;

async function loadPair(db: Db, sourceId: string, targetId: string) {
  if (sourceId === targetId) {
    throw new ContactMergeError("Pick a different contact to merge into.");
  }
  const select = {
    id: true,
    name: true,
    organization: true,
    role: true,
    email: true,
    phone: true,
    notes: true,
    locations: { select: { id: true } },
    presentedItems: { select: { id: true } },
    presentationDefaults: { select: { id: true } },
  } satisfies Prisma.ContactSelect;
  const [source, target] = await Promise.all([
    db.contact.findUnique({ where: { id: sourceId }, select }),
    db.contact.findUnique({ where: { id: targetId }, select }),
  ]);
  if (!source) throw new ContactMergeError("Contact to merge away not found.");
  if (!target) throw new ContactMergeError("Contact to keep not found.");
  return { source, target };
}

const newIds = (from: { id: string }[], already: { id: string }[]) => {
  const have = new Set(already.map((r) => r.id));
  return from.filter((r) => !have.has(r.id));
};

export async function previewContactMerge(
  sourceId: string,
  targetId: string,
): Promise<ContactMergePreview> {
  const { source, target } = await loadPair(prisma, sourceId, targetId);
  const [primaryFor, bookings, notes] = await Promise.all([
    prisma.location.count({ where: { primaryContactId: sourceId } }),
    prisma.booking.count({ where: { bookedContactId: sourceId } }),
    prisma.note.count({ where: { contactId: sourceId } }),
  ]);
  return {
    source: { id: source.id, name: source.name },
    target: { id: target.id, name: target.name },
    locations: newIds(source.locations, target.locations).length,
    primaryFor,
    bookings,
    notes,
    presentedItems: newIds(source.presentedItems, target.presentedItems).length,
    presentationDefaults: newIds(
      source.presentationDefaults,
      target.presentationDefaults,
    ).length,
  };
}

// Fold `sourceId` into `targetId` and delete the source. Returns the preview
// computed just before the merge (what was moved).
export async function mergeContacts(
  sourceId: string,
  targetId: string,
): Promise<ContactMergePreview> {
  const preview = await previewContactMerge(sourceId, targetId);

  await prisma.$transaction(async (tx) => {
    const { source, target } = await loadPair(tx, sourceId, targetId);

    // Fields + the m2m unions (connect skips rows the target already has).
    // Locations connect before the primary repoint below.
    await tx.contact.update({
      where: { id: targetId },
      data: {
        ...mergeContactFields(target, source),
        locations: { connect: newIds(source.locations, target.locations) },
        presentedItems: {
          connect: newIds(source.presentedItems, target.presentedItems),
        },
        presentationDefaults: {
          connect: newIds(
            source.presentationDefaults,
            target.presentationDefaults,
          ),
        },
      },
    });

    await tx.location.updateMany({
      where: { primaryContactId: sourceId },
      data: { primaryContactId: targetId },
    });
    await tx.booking.updateMany({
      where: { bookedContactId: sourceId },
      data: { bookedContactId: targetId },
    });
    await tx.note.updateMany({
      where: { contactId: sourceId },
      data: { contactId: targetId },
    });

    // The source's own m2m rows cascade with it.
    await tx.contact.delete({ where: { id: sourceId } });
  });

  return preview;
}
