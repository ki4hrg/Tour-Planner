"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ContactChannels } from "@/components/contact-channels";

interface ContactLocation {
  id: string;
  name: string;
}

interface Contact {
  id: string;
  name: string;
  role?: string | null;
  organization?: string | null;
  email?: string | null;
  phone?: string | null;
  locations: ContactLocation[];
  _count: {
    locations: number;
  };
}

interface ContactsListProps {
  contacts: Contact[];
  isGrouped: boolean;
}

function ContactRow({
  contact,
  inCard = false,
}: {
  contact: Contact;
  // Grouped rows sit inside a bordered card and keep their padding on all
  // sides; flat rows are bare divide-y entries that trim the outer edges.
  inCard?: boolean;
}) {
  return (
    <div
      className={
        inCard
          ? "flex items-center justify-between gap-3 px-4 py-3"
          : "flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
      }
    >
      <div className="min-w-0">
        <Link
          href={`/contacts/${contact.id}`}
          className="font-medium hover:underline"
        >
          {contact.name}
        </Link>
        <div className="truncate text-sm text-muted-foreground">
          {[contact.role, contact.organization].filter(Boolean).join(" · ")}
          {contact.email ? ` · ${contact.email}` : ""}
          {contact.phone ? ` · ${contact.phone}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ContactChannels phone={contact.phone} email={contact.email} />
        <Badge variant="outline">{contact._count.locations} locations</Badge>
      </div>
    </div>
  );
}

export function ContactsList({ contacts, isGrouped }: ContactsListProps) {
  if (contacts.length === 0) {
    return (
      <p className="py-3 text-sm text-muted-foreground">No contacts yet.</p>
    );
  }

  if (!isGrouped) {
    // Flat view: A–Z order (already sorted by the server)
    return (
      <div className="divide-y">
        {contacts.map((c) => (
          <ContactRow key={c.id} contact={c} />
        ))}
      </div>
    );
  }

  // Grouped view: by location
  // Build groups: one per location, plus "No location" if any exist
  const groupedByLocation: Map<string, Contact[]> = new Map();
  const contactsWithoutLocation: Contact[] = [];

  contacts.forEach((contact) => {
    if (contact.locations.length === 0) {
      contactsWithoutLocation.push(contact);
    } else {
      contact.locations.forEach((loc) => {
        if (!groupedByLocation.has(loc.id)) {
          groupedByLocation.set(loc.id, []);
        }
        groupedByLocation.get(loc.id)!.push(contact);
      });
    }
  });

  // Sort groups by their own location's name (resolved from any member's link).
  const locationName = (id: string, members: Contact[]) =>
    members[0]?.locations.find((l) => l.id === id)?.name ?? "";
  const sortedLocations = Array.from(groupedByLocation.entries()).sort(
    ([idA, a], [idB, b]) =>
      locationName(idA, a).localeCompare(locationName(idB, b)),
  );

  return (
    <div className="space-y-6">
      {sortedLocations.map(([locationId, contactsInLocation]) => {
        const groupName = locationName(locationId, contactsInLocation);

        return (
          <div key={locationId}>
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              {groupName}
            </h3>
            <div className="divide-y rounded-lg border">
              {contactsInLocation.map((contact) => (
                <ContactRow key={contact.id} contact={contact} inCard />
              ))}
            </div>
          </div>
        );
      })}

      {contactsWithoutLocation.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            No location
          </h3>
          <div className="divide-y rounded-lg border">
            {contactsWithoutLocation.map((contact) => (
              <ContactRow key={contact.id} contact={contact} inCard />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
