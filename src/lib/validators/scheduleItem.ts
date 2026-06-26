import { z } from "zod";

// "HH:MM" 24-hour time, or empty → undefined.
const optionalTime = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).")
    .optional(),
);

const optionalId = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().optional(),
);

export const scheduleItemSchema = z
  .object({
    categoryId: optionalId,
    title: z.string().trim().optional(),
    startTime: optionalTime,
    endTime: optionalTime,
    notes: z.string().trim().optional(),
    isBlock: z.boolean().optional(),
    // The catalogued talk this item delivers (optional).
    presentationId: optionalId,
    // Per-occurrence speaker override; empty ⇒ use the talk's default presenters.
    presenterIds: z.array(z.string().min(1)).default([]),
    // The locations this item visits (0 = informational line, 1 = stop, many = block).
    locationIds: z.array(z.string().min(1)).default([]),
  })
  // The "needs a title or a location" rule is enforced in the server actions,
  // which can see whether the chosen category is a self-describing built-in
  // (Free time / Break) that legitimately needs neither.
  .refine((d) => !d.startTime || !d.endTime || d.endTime >= d.startTime, {
    message: "End time cannot be before start time.",
    path: ["endTime"],
  });

export type ScheduleItemInput = z.infer<typeof scheduleItemSchema>;
