import { z } from "zod";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// "HH:MM" or empty → undefined.
const optionalTime = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().regex(TIME, "Use HH:MM (24-hour).").optional(),
);
const optionalId = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().trim().min(1).optional(),
);

// A standing event at a venue (LocationEvent): what it is and when it runs.
export const locationEventSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(120),
    startTime: z.string().regex(TIME, "Use HH:MM (24-hour)."),
    endTime: optionalTime,
    categoryId: optionalId,
    notes: z.string().trim().max(500).optional(),
  })
  .refine((d) => !d.endTime || d.endTime >= d.startTime, {
    message: "End time cannot be before start time.",
    path: ["endTime"],
  });

export type LocationEventInput = z.infer<typeof locationEventSchema>;
