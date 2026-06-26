import { z } from "zod";
import { BOOKING_STATUSES } from "../trips";

const optionalId = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().optional(),
);

export const bookingSchema = z.object({
  // Which member location this booking is for (empty = the item as a whole).
  locationId: optionalId,
  label: z.string().trim().optional(),
  status: z.enum(BOOKING_STATUSES as [string, ...string[]]),
  bookedContactId: optionalId,
  confirmationRef: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type BookingInput = z.infer<typeof bookingSchema>;
