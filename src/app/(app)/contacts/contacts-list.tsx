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

function ContactRow({ contact }: { contact: Contact }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
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

  // Sort groups by location name
  const sortedLocations = Array.from(groupedByLocation.entries()).sort(
    ([, a], [, b]) => {
      const nameA = a[0]?.locations.find((l) => l.id === a[0].locations[0]?.id)
        ?.name;
      const nameB = b[0]?.locations.find((l) => l.id === b[0].locations[0]?.id)
        ?.name;
      return (nameA || "").localeCompare(nameB || "");
    }
  );

  return (
    <div className="space-y-6">
      {sortedLocations.map(([locationId, contactsInLocation]) => {
        // Find the location name from the first contact's location list
        const locationName = contactsInLocation[0]?.locations.find(
          (l) => l.id === locationId
        )?.name;

        return (
          <div key={locationId}>
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {locationName}
            </h3>
            <div className="divide-y rounded-lg border">
              {contactsInLocation.map((contact) => (
                <ContactRow key={contact.id} contact={contact} />
              ))}
            </div>
          </div>
        );
      })}

      {contactsWithoutLocation.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            No location
          </h3>
          <div className="divide-y rounded-lg border">
            {contactsWithoutLocation.map((contact) => (
              <ContactRow key={contact.id} contact={contact} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
