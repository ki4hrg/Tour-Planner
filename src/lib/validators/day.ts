import { z } from "zod";

// Optional id: empty string / null → undefined (a form clearing the select).
const optionalId = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().optional(),
);

export const daySchema = z.object({
  title: z.string().trim().optional(),
  logisticalNotes: z.string().trim().optional(),
  participantNotes: z.string().trim().optional(),
  // Default venue for the day; new schedule items pre-fill their picker with it.
  primaryLocationId: optionalId,
});

export type DayInput = z.infer<typeof daySchema>;
