import { z } from "zod";

// Note targets and contact methods. NOTE_METHODS mirrors the Prisma NoteMethod enum.
export const NOTE_METHODS = ["CALL", "EMAIL", "IN_PERSON", "OTHER"] as const;
export type NoteMethodValue = (typeof NOTE_METHODS)[number];

export const NOTE_METHOD_LABELS: Record<NoteMethodValue, string> = {
  CALL: "Call",
  EMAIL: "Email",
  IN_PERSON: "In person",
  OTHER: "Other",
};

export const NOTE_TARGETS = ["location", "booking", "trip", "stay"] as const;
export type NoteTarget = (typeof NOTE_TARGETS)[number];

const optionalId = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().optional(),
);

// Empty date input → undefined so optional dates clear cleanly.
const optionalDate = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().optional(),
);

export const noteSchema = z.object({
  body: z.string().trim().min(1, "Note can't be empty."),
  method: z.enum(NOTE_METHODS),
  contactId: optionalId,
  contactedOn: z.string().min(1, "Pick the date you made contact."),
  followUp: z.boolean().default(false),
  dueDate: optionalDate,
  // Explicit Todoist destination for a follow-up on a location-only note
  // (trip-context notes route by trip/trip-type links automatically).
  todoistProjectId: optionalId,
});

export type NoteInput = z.infer<typeof noteSchema>;
