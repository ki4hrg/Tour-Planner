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
    presenterContactId: optionalId,
    // The sites this item visits (0 = informational line, 1 = stop, many = block).
    siteIds: z.array(z.string().min(1)).default([]),
  })
  .refine((d) => d.siteIds.length > 0 || (d.title && d.title.length > 0), {
    message: "Pick at least one site or give the item a title.",
    path: ["title"],
  })
  .refine((d) => !d.startTime || !d.endTime || d.endTime >= d.startTime, {
    message: "End time cannot be before start time.",
    path: ["endTime"],
  });

export type ScheduleItemInput = z.infer<typeof scheduleItemSchema>;
