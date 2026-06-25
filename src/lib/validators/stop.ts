import { z } from "zod";
import { BOOKING_STATUSES } from "../trips";

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

export const stopSchema = z
  .object({
    siteId: optionalId,
    title: z.string().trim().optional(),
    startTime: optionalTime,
    endTime: optionalTime,
    scheduleNotes: z.string().trim().optional(),
    bookingStatus: z.enum(BOOKING_STATUSES as [string, ...string[]]),
    bookingNotes: z.string().trim().optional(),
    bookedContactId: optionalId,
    confirmationRef: z.string().trim().optional(),
  })
  .refine((d) => d.siteId || (d.title && d.title.length > 0), {
    message: "Pick a site or give the stop a title.",
    path: ["title"],
  })
  .refine(
    (d) => !d.startTime || !d.endTime || d.endTime >= d.startTime,
    { message: "End time cannot be before start time.", path: ["endTime"] },
  );

export type StopInput = z.infer<typeof stopSchema>;
