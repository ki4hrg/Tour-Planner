import type { NoteMethod } from "@prisma/client";
import { toDateInput } from "./dates";

export type SerializedNote = {
  id: string;
  body: string;
  method: NoteMethod;
  contact: { id: string; name: string } | null;
  contactedOn: string; // "yyyy-mm-dd"
  followUp: boolean;
  dueDate: string | null; // "yyyy-mm-dd"
  createdBy: { id: string; name: string } | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
};

type NoteRow = {
  id: string;
  body: string;
  method: NoteMethod;
  contactedOn: Date;
  followUp: boolean;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contact: { id: string; name: string } | null;
  createdBy: { id: string; name: string | null } | null;
};

// Dates/Decimals never cross to a Client Component raw — flatten here.
export function serializeNote(note: NoteRow): SerializedNote {
  return {
    id: note.id,
    body: note.body,
    method: note.method,
    contact: note.contact
      ? { id: note.contact.id, name: note.contact.name }
      : null,
    contactedOn: toDateInput(note.contactedOn),
    followUp: note.followUp,
    dueDate: note.dueDate ? toDateInput(note.dueDate) : null,
    createdBy: note.createdBy
      ? { id: note.createdBy.id, name: note.createdBy.name ?? "Unknown" }
      : null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

// The relations a note row needs loaded to resolve its target link below.
export type NoteTargetRow = {
  location: { id: string; name: string } | null;
  booking: {
    tripId: string | null;
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
 * Where a note "lives": a human label plus the page that shows its thread.
 * A note targets exactly one of location / booking / trip / stay (DB CHECK), so
 * the first match wins. Booking notes land on the trip's booking dashboard;
 * stay notes on the trip page (its Lodging panel).
 */
export function noteTarget(note: NoteTargetRow): { label: string; href: string } {
  if (note.location) {
    return {
      label: note.location.name,
      href: `/locations/${note.location.id}`,
    };
  }
  if (note.booking) {
    const trip = note.booking.trip ?? note.booking.scheduleItem?.day.trip ?? null;
    const what = note.booking.location?.name ?? note.booking.label ?? "Booking";
    return {
      label: trip ? `${what} — ${trip.name}` : what,
      href: trip ? `/trips/${trip.id}/booking` : "/trips",
    };
  }
  if (note.trip) {
    return { label: note.trip.name, href: `/trips/${note.trip.id}` };
  }
  if (note.stay) {
    return {
      label: `${note.stay.location.name} — ${note.stay.trip.name}`,
      href: `/trips/${note.stay.trip.id}`,
    };
  }
  return { label: "Note", href: "/" };
}
