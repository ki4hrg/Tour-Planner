// Location ⇄ Contact links (the implicit "ContactToLocation" m2m), shared by
// the Location page and the Contact page. No revalidatePath — callers do that.

import { prisma } from "@/lib/db";

export async function linkContactLocation(
  contactId: string,
  locationId: string,
): Promise<void> {
  await prisma.location.update({
    where: { id: locationId },
    data: { contacts: { connect: { id: contactId } } },
  });
}

// Unlinking a venue's primary contact also clears that designation — the
// primary must always be one of the linked contacts.
export async function unlinkContactLocation(
  contactId: string,
  locationId: string,
): Promise<void> {
  const current = await prisma.location.findUnique({
    where: { id: locationId },
    select: { primaryContactId: true },
  });
  if (!current) return;
  await prisma.location.update({
    where: { id: locationId },
    data: {
      contacts: { disconnect: { id: contactId } },
      ...(current.primaryContactId === contactId
        ? { primaryContact: { disconnect: true } }
        : {}),
    },
  });
}
