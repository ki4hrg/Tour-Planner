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
